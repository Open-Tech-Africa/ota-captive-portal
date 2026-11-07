import "server-only"
import { env } from "@/lib/env"
import { chargeResponseSchema, verifyTransactionResponseSchema } from "@/lib/schemas/paystack"
import type { ChargeResponse, VerifyTransactionResponse } from "@/lib/schemas/paystack"

const PAYSTACK_BASE_URL = "https://api.paystack.co"

// Paystack amounts are in the subunit of the currency (cents) — the same convention as NGN kobo —
// verify against a live sandbox response before go-live, Paystack's docs don't show a worked KES example.
const SUBUNIT_MULTIPLIER = 100

type InitiateMpesaChargeRequest = {
  phoneNumber: string
  amountKes: number
  /** Paystack requires an email on every charge even though this app has no customer accounts —
   * see docs/PAYSTACK-INTEGRATION.md for the placeholder-address convention used here. */
  email: string
  accountReference: string
}

/** Triggers an M-Pesa STK push via Paystack's Charge API — see docs/PAYSTACK-INTEGRATION.md. */
export async function initiateMpesaCharge(
  request: InitiateMpesaChargeRequest,
): Promise<ChargeResponse> {
  const response = await fetch(`${PAYSTACK_BASE_URL}/charge`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: request.email,
      amount: String(request.amountKes * SUBUNIT_MULTIPLIER),
      reference: request.accountReference,
      // Paystack's own docs show two conventions for Kenya M-Pesa phone numbers on the same page —
      // "254..." (no plus) is only for the separate mpesa_offline variant; plain "mpesa" wants the
      // international "+254..." form. Our internal normalized format (used for RADIUS username,
      // session storage, etc.) stays "254..." — only this outgoing request gets the "+" prepended.
      mobile_money: { phone: `+${request.phoneNumber}`, provider: "mpesa" },
    }),
  })
  if (!response.ok) {
    throw new Error(`Paystack charge request failed: ${response.status} ${await response.text()}`)
  }
  return chargeResponseSchema.parse(await response.json())
}

/** Fallback for when the charge.success webhook never arrives — see docs/PAYSTACK-INTEGRATION.md. */
export async function verifyTransaction(reference: string): Promise<VerifyTransactionResponse> {
  const response = await fetch(
    `${PAYSTACK_BASE_URL}/transaction/verify/${encodeURIComponent(reference)}`,
    { headers: { Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}` } },
  )
  if (!response.ok) {
    throw new Error(`Paystack verify request failed: ${response.status} ${await response.text()}`)
  }
  return verifyTransactionResponseSchema.parse(await response.json())
}

/** This app has no customer accounts/emails, but Paystack requires one on every charge — a
 * deterministic placeholder tied to the phone number, never actually mailed, is good enough.
 * Not `.invalid` (RFC 2606's reserved placeholder TLD): Paystack's validator checks against a
 * real-TLD allowlist and rejects it outright ("\"email\" must be a valid email"), so this uses a
 * subdomain of whatever domain APP_BASE_URL is on instead — this deployment's operator already owns it. */
export function buildPlaceholderEmail(phoneNumber: string): string {
  return `${phoneNumber}@wisp-portal.${new URL(env.APP_BASE_URL).hostname}`
}
