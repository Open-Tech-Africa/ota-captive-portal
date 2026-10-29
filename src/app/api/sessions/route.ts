import { NextResponse } from "next/server"
import { appDb } from "@/lib/db/app"
import { createSessionSchema } from "@/lib/schemas/session"
import { initiateStkPush } from "@/lib/mpesa/client"

export async function POST(request: Request) {
  const body = createSessionSchema.safeParse(await request.json())
  if (!body.success) {
    return NextResponse.json({ error: body.error.flatten() }, { status: 400 })
  }
  const { packageId, phoneNumber, zoneId, clientIp, clientMac, redirectUrl } = body.data

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
