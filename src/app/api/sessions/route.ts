import { NextResponse } from "next/server"
import { appDb } from "@/lib/db/app"
import { createSessionSchema } from "@/lib/schemas/session"
import { initiateStkPush } from "@/lib/mpesa/client"
import { checkRateLimit, getClientIp } from "@/lib/rate-limit"

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
  const { packageId, phoneNumber, zoneId, clientIp, clientMac, redirectUrl } = body.data

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

  const pkg = await appDb.package.findUnique({ where: { id: packageId } })
  if (!pkg || !pkg.isActive) {
    return NextResponse.json({ error: "This package is no longer available" }, { status: 404 })
  }

  const session = await appDb.portalSession.create({
    data: { packageId, phoneNumber, zoneId, clientIp, clientMac, redirectUrl, status: "PENDING" },
  })

  try {
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

    return NextResponse.json({ sessionId: session.id })
  } catch (error) {
    await appDb.portalSession.update({ where: { id: session.id }, data: { status: "FAILED" } })
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to start M-Pesa payment" },
      { status: 502 },
    )
  }
}
