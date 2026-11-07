import { NextResponse } from "next/server"
import crypto from "node:crypto"
import { env } from "@/lib/env"
import { appDb } from "@/lib/db/app"
import { chargeWebhookSchema } from "@/lib/schemas/paystack"
import { applyPaystackResult } from "@/lib/paystack/apply-charge-result"
import { isTerminalPaystackStatus } from "@/lib/paystack/status"

const ACK = NextResponse.json({ received: true })

export async function POST(request: Request) {
  const rawBody = await request.text()

  if (!isValidSignature(rawBody, request.headers.get("x-paystack-signature"))) {
    console.error("[paystack/webhook] signature mismatch")
    return NextResponse.json({ error: "invalid signature" }, { status: 401 })
  }

  const parsed = chargeWebhookSchema.safeParse(JSON.parse(rawBody))
  if (!parsed.success) {
    console.error("[paystack/webhook] unrecognized payload shape", parsed.error.flatten())
    return ACK
  }
  // Paystack documents no dedicated charge-failure event — failed/abandoned STK prompts are
  // caught by the verify-transaction fallback in GET /api/sessions/[id]/status instead.
  if (parsed.data.event !== "charge.success") {
    return ACK
  }

  const { data } = parsed.data
  if (!isTerminalPaystackStatus(data.status)) {
    return ACK
  }

  const transaction = await appDb.paystackTransaction.findUnique({
    where: { reference: data.reference },
    include: { session: { include: { package: true } } },
  })
  if (!transaction) {
    console.error("[paystack/webhook] no transaction for reference", data.reference)
    return ACK
  }

  await applyPaystackResult(transaction, {
    status: data.status,
    gatewayResponse: data.gateway_response,
    paidAt: data.paid_at ? new Date(data.paid_at) : null,
    raw: parsed.data,
  })

  return ACK
}

/** HMAC-SHA512 of the raw body, keyed by the secret key — see docs/PAYSTACK-INTEGRATION.md. */
function isValidSignature(rawBody: string, signature: string | null): boolean {
  if (!signature || !env.PAYSTACK_SECRET_KEY) return false

  const expected = crypto
    .createHmac("sha512", env.PAYSTACK_SECRET_KEY)
    .update(rawBody)
    .digest("hex")
  const signatureBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expected)
  if (signatureBuffer.length !== expectedBuffer.length) return false

  return crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
}
