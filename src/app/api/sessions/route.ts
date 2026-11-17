import { NextResponse } from "next/server"
import { appDb } from "@/lib/db/app"
import { env } from "@/lib/env"
import { createSessionSchema } from "@/lib/schemas/session"
import { initiateStkPush } from "@/lib/mpesa/client"
import { initiateMpesaCharge, buildPlaceholderEmail } from "@/lib/paystack/client"
import { checkRateLimit, getClientIp } from "@/lib/rate-limit"
import { provisionRadiusAccess } from "@/lib/radius/provision"

const TEN_MINUTES_MS = 10 * 60 * 1000
// Caps real-world retry UX (a subscriber re-trying a declined/timed-out payment a few times)
// while blocking the obvious abuse this endpoint is otherwise wide open to: anyone with the URL
// can fire a real STK Push at any phone number they type in, with no account or auth involved.
const MAX_REQUESTS_PER_PHONE = 5
const MAX_REQUESTS_PER_IP = 15

export async function POST(request: Request) {
  const body = createSessionSchema.safeParse(await request.json())
  if (!body.success) {
    return NextResponse.json({ error: body.error.flatten() }, { status: 400 })
  }
  const { packageId, phoneNumber, email, zoneId, clientIp, clientMac, redirectUrl } = body.data

  const ip = getClientIp(request)
  const withinIpLimit = checkRateLimit(`ip:${ip}`, {
    max: MAX_REQUESTS_PER_IP,
    windowMs: TEN_MINUTES_MS,
  })
  const withinPhoneLimit = checkRateLimit(`phone:${phoneNumber}`, {
    max: MAX_REQUESTS_PER_PHONE,
    windowMs: TEN_MINUTES_MS,
  })
  if (!withinIpLimit || !withinPhoneLimit) {
    return NextResponse.json(
      { error: "Too many payment attempts — please wait a few minutes and try again" },
      { status: 429 },
    )
  }

  // A subscriber with unexpired paid access who gets bounced back to the splash page (idle
  // timeout, OPNsense session cleared, new device) shouldn't be charged again for time they
  // already paid for — reconnect them on whatever's left of their current grant instead. See
  // docs/RADIUS-INTEGRATION.md#re-login-without-re-paying. Whichever package they clicked this
  // time is irrelevant to this path.
  const activeSession = await appDb.portalSession.findFirst({
    where: { phoneNumber, status: "PROVISIONED", expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    include: { package: true },
  })
  const remainingSeconds = activeSession?.expiresAt
    ? Math.floor((activeSession.expiresAt.getTime() - Date.now()) / 1000)
    : 0

  if (activeSession && remainingSeconds > 0) {
    try {
      const { username, password } = await provisionRadiusAccess(
        activeSession,
        activeSession.package,
        remainingSeconds,
      )
      await appDb.portalSession.update({
        where: { id: activeSession.id },
        data: { radiusUsername: username, radiusPasswordOneTime: password },
      })
      return NextResponse.json({ sessionId: activeSession.id, status: "PROVISIONED" })
    } catch (error) {
      console.error("[sessions] reconnecting an active session failed", error)
      // Fall through to a normal paid session rather than leaving the subscriber stuck.
    }
  }

  const pkg = await appDb.package.findUnique({ where: { id: packageId } })
  if (!pkg || !pkg.isActive) {
    return NextResponse.json({ error: "This package is no longer available" }, { status: 404 })
  }

  const session = await appDb.portalSession.create({
    data: {
      packageId,
      phoneNumber,
      email,
      zoneId,
      clientIp,
      clientMac,
      redirectUrl,
      status: "PENDING",
    },
  })

  try {
    if (env.PAYMENT_PROVIDER === "paystack") {
      const chargeResponse = await initiateMpesaCharge({
        phoneNumber,
        amountKes: pkg.priceKes,
        email: email ?? buildPlaceholderEmail(phoneNumber),
        accountReference: session.id,
      })

      await appDb.$transaction([
        appDb.paystackTransaction.create({
          data: {
            sessionId: session.id,
            reference: chargeResponse.data.reference,
            amount: pkg.priceKes,
            phoneNumber,
            status: "INITIATED",
          },
        }),
        appDb.portalSession.update({
          where: { id: session.id },
          data: { status: "AWAITING_PAYMENT" },
        }),
      ])
    } else {
      const stkResponse = await initiateStkPush({
        phoneNumber,
        amount: pkg.priceKes,
        accountReference: session.id,
        transactionDesc: `WiFi ${pkg.name}`,
      })

      await appDb.$transaction([
        appDb.mpesaTransaction.create({
          data: {
            sessionId: session.id,
            merchantRequestId: stkResponse.MerchantRequestID,
            checkoutRequestId: stkResponse.CheckoutRequestID,
            amount: pkg.priceKes,
            phoneNumber,
            status: "INITIATED",
          },
        }),
        appDb.portalSession.update({
          where: { id: session.id },
          data: { status: "AWAITING_PAYMENT" },
        }),
      ])
    }

    return NextResponse.json({ sessionId: session.id, status: "AWAITING_PAYMENT" })
  } catch (error) {
    console.error(`[sessions] ${env.PAYMENT_PROVIDER} charge initiation failed`, error)
    await appDb.portalSession.update({ where: { id: session.id }, data: { status: "FAILED" } })
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to start payment" },
      { status: 502 },
    )
  }
}
