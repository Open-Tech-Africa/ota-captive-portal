import "server-only"
import { env, mpesaBaseUrl } from "@/lib/env"
import type {
  OAuthResponse,
  StkPushRequest,
  StkPushResponse,
  StkPushQueryResponse,
} from "@/lib/mpesa/types"

let cachedToken: { value: string; expiresAt: number } | null = null

/** Nairobi (EAT, UTC+3, no DST) wall-clock timestamp in Safaricom's YYYYMMDDHHmmss format. */
function formatMpesaTimestamp(date: Date): string {
  const nairobiTime = new Date(date.getTime() + 3 * 60 * 60 * 1000)
  const pad = (value: number) => String(value).padStart(2, "0")
  return [
    nairobiTime.getUTCFullYear(),
    pad(nairobiTime.getUTCMonth() + 1),
    pad(nairobiTime.getUTCDate()),
    pad(nairobiTime.getUTCHours()),
    pad(nairobiTime.getUTCMinutes()),
    pad(nairobiTime.getUTCSeconds()),
  ].join("")
}

function buildPassword(timestamp: string): string {
  return Buffer.from(`${env.MPESA_SHORTCODE}${env.MPESA_PASSKEY}${timestamp}`).toString("base64")
}

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value

  const credentials = Buffer.from(
    `${env.MPESA_CONSUMER_KEY}:${env.MPESA_CONSUMER_SECRET}`,
  ).toString("base64")
  const response = await fetch(`${mpesaBaseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${credentials}` },
  })
  if (!response.ok) {
    throw new Error(`M-Pesa OAuth failed: ${response.status} ${await response.text()}`)
  }
  const data = (await response.json()) as OAuthResponse

  // Refresh a little early so a request never races an about-to-expire token.
  const EARLY_REFRESH_SECONDS = 60
  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + (Number(data.expires_in) - EARLY_REFRESH_SECONDS) * 1000,
  }
  return cachedToken.value
}

export async function initiateStkPush(request: StkPushRequest): Promise<StkPushResponse> {
  const token = await getAccessToken()
  const timestamp = formatMpesaTimestamp(new Date())

  const response = await fetch(`${mpesaBaseUrl}/mpesa/stkpush/v1/processrequest`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      BusinessShortCode: env.MPESA_SHORTCODE,
      Password: buildPassword(timestamp),
      Timestamp: timestamp,
      TransactionType: "CustomerPayBillOnline",
      Amount: request.amount,
      PartyA: request.phoneNumber,
      PartyB: env.MPESA_SHORTCODE,
      PhoneNumber: request.phoneNumber,
      CallBackURL: env.MPESA_CALLBACK_URL,
      AccountReference: request.accountReference,
      TransactionDesc: request.transactionDesc,
    }),
  })
  if (!response.ok) {
    throw new Error(`STK Push request failed: ${response.status} ${await response.text()}`)
  }
  return (await response.json()) as StkPushResponse
}

/** Fallback for when the callback never arrives — see docs/MPESA-INTEGRATION.md#4-fallback-stk-push-query. */
export async function queryStkPushStatus(checkoutRequestId: string): Promise<StkPushQueryResponse> {
  const token = await getAccessToken()
  const timestamp = formatMpesaTimestamp(new Date())

  const response = await fetch(`${mpesaBaseUrl}/mpesa/stkpushquery/v1/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      BusinessShortCode: env.MPESA_SHORTCODE,
      Password: buildPassword(timestamp),
      Timestamp: timestamp,
      CheckoutRequestID: checkoutRequestId,
    }),
  })
  if (!response.ok) {
    throw new Error(`STK Push query failed: ${response.status} ${await response.text()}`)
  }
  return (await response.json()) as StkPushQueryResponse
}
