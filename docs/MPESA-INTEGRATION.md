# M-Pesa Daraja Integration (STK Push)

Reference: Safaricom Daraja developer portal, "M-Pesa Express" / "Lipa Na M-Pesa Online" API. Verify exact field names against `developer.safaricom.co.ke` before building — Safaricom does revise the docs.

## Credentials needed

| Env var | Source | Notes |
|---|---|---|
| `MPESA_ENV` | — | `sandbox` or `production` |
| `MPESA_CONSUMER_KEY` / `MPESA_CONSUMER_SECRET` | Daraja app (APIs > M-Pesa Express) | Used for OAuth, not sent to the client |
| `MPESA_SHORTCODE` | Paybill/Till number (sandbox: `174379`) | `BusinessShortCode` / `PartyB` |
| `MPESA_PASSKEY` | Given with the shortcode on the portal | Used to build the `Password` field |
| `MPESA_CALLBACK_URL` | This app's public HTTPS URL | Must be internet-reachable; Safaricom POSTs here |

## 1. OAuth token

```
GET https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials
Authorization: Basic base64(consumer_key:consumer_secret)
```

Returns `access_token` (expires in ~3600s). Cache it server-side (in-memory with expiry, or a row in the app DB) instead of fetching one per request.

## 2. STK Push request

```
POST https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "BusinessShortCode": "174379",
  "Password": "<base64(ShortCode + Passkey + Timestamp)>",
  "Timestamp": "20260101120000",
  "TransactionType": "CustomerPayBillOnline",
  "Amount": 50,
  "PartyA": "2547XXXXXXXX",
  "PartyB": "174379",
  "PhoneNumber": "2547XXXXXXXX",
  "CallBackURL": "https://portal.example.com/api/mpesa/callback",
  "AccountReference": "<portalSessionId>",
  "TransactionDesc": "WiFi Daily Pass"
}
```

- `PartyA` and `PhoneNumber` are both the subscriber's number, normalized to `2547XXXXXXXX` / `2541XXXXXXXX` (strip leading `0` or `+`).
- `AccountReference` should be the `PortalSession.id` so the callback can be matched back without relying solely on `CheckoutRequestID` (store both).
- Response: `MerchantRequestID`, `CheckoutRequestID`, `ResponseCode` (`"0"` = accepted for processing — **not** payment success yet).

Store `merchantRequestId` + `checkoutRequestId` on the `MpesaTransaction` row immediately, status `INITIATED`.

## 3. Callback

Safaricom POSTs to `CallBackURL` when the customer enters their PIN, cancels, or the prompt times out:

```json
{
  "Body": {
    "stkCallback": {
      "MerchantRequestID": "...",
      "CheckoutRequestID": "...",
      "ResultCode": 0,
      "ResultDesc": "The service request is processed successfully.",
      "CallbackMetadata": {
        "Item": [
          { "Name": "Amount", "Value": 50 },
          { "Name": "MpesaReceiptNumber", "Value": "NLJ7RT61SV" },
          { "Name": "TransactionDate", "Value": 20260101120115 },
          { "Name": "PhoneNumber", "Value": 254712345678 }
        ]
      }
    }
  }
}
```

On failure/cancel/timeout, `ResultCode` is non-zero and `CallbackMetadata` is absent — only `ResultDesc` explains why (e.g. "Request cancelled by user", "DS timeout user cannot be reached").

Handler responsibilities (`POST /api/mpesa/callback`):

1. Look up `MpesaTransaction` by `checkoutRequestId`.
2. Store the raw payload (`rawCallback` JSON column) regardless of outcome — needed for support/debugging.
3. `ResultCode === 0` → status `SUCCESS`, copy `MpesaReceiptNumber`/`TransactionDate`/`Amount`, flip `PortalSession.status` to `PAID`, trigger RADIUS provisioning (see [`RADIUS-INTEGRATION.md`](RADIUS-INTEGRATION.md)).
4. Non-zero → status `FAILED` (or `CANCELLED`/`TIMEOUT` based on `ResultDesc`/known codes), flip `PortalSession.status` to `FAILED`, surface a retry option in the UI.
5. **Idempotency**: Safaricom may retry the callback. Guard on `MpesaTransaction.status` already being terminal (`SUCCESS`/`FAILED`) and no-op if so, so RADIUS provisioning never runs twice for one payment.
6. Always return `{ "ResultCode": 0, "ResultDesc": "Accepted" }` with HTTP 200 — Safaricom retries on anything else.

## 4. Fallback: STK Push query

**Implemented in `GET /api/sessions/[id]/status`** — not a separate job. Since the splash page already polls that route every 3s while `AWAITING_PAYMENT`, the fallback piggybacks on that same poll: once a transaction has been `INITIATED` for more than `QUERY_FALLBACK_AFTER_MS` (15s) with no callback having resolved it, the status route itself calls:

```
POST https://sandbox.safaricom.co.ke/mpesa/stkpushquery/v1/query
{
  "BusinessShortCode": "...",
  "Password": "...",
  "Timestamp": "...",
  "CheckoutRequestID": "..."
}
```

A `ResultCode` of `4999` means "still processing" — not applied, the session just keeps waiting. Any other code is treated as final and run through the exact same logic the webhook uses (`applyMpesaResult` in `src/lib/payments/mpesa.ts`, shared by both paths so they can never diverge) — including RADIUS provisioning on success. This covers the case where the callback never arrives at all (we hit this ourselves testing against Daraja sandbox) but the payment actually went through, or definitively failed/timed out.

Note this only resolves transactions that someone is actively polling for (i.e., a subscriber still has the splash page open). A transaction nobody's watching anymore stays `AWAITING_PAYMENT` until the cleanup job's grace period or a future visit — acceptable for now, but worth a dedicated sweep job if stale `AWAITING_PAYMENT` rows start piling up.

The splash page also has a **"Check now" button**, shown the whole time a session is `AWAITING_PAYMENT`/`PAID`, that hits this same route with `?force=true` — this skips the `QUERY_FALLBACK_AFTER_MS` wait and asks Safaricom immediately, regardless of how long the transaction's been `INITIATED`. It's there for the common case of a subscriber coming back to a tab that was backgrounded (and so had its poll timer throttled by the browser) while they were off entering their PIN in the M-Pesa prompt.

## UI states to design for

`PENDING → AWAITING_PAYMENT → (PAID → PROVISIONED) | FAILED | CANCELLED | TIMEOUT`

Show distinct copy for cancel ("You declined the M-Pesa prompt") vs. timeout ("No response — try again") vs. insufficient funds, where `ResultDesc` allows distinguishing them, and always offer a clear "Try again" that re-triggers STK Push without losing the selected package.
