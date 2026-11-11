# Paystack Integration (M-Pesa STK Push, alternative to direct Daraja)

Reference: [Paystack API docs](https://paystack.com/docs/api/). Verify exact field names/values against this before go-live — several details below (the Kenya M-Pesa `data.status` values, the `charge.success` payload fields) aren't shown as worked examples in Paystack's public docs and were inferred from the documented envelope/parameter lists.

## Why this exists alongside direct Daraja integration

Safaricom's Daraja production go-live needs a merchant application (Till/Paybill shortcode, business registration) — see [`MPESA-INTEGRATION.md`](MPESA-INTEGRATION.md) and `docs/ARCHITECTURE.md`'s open questions. Paystack is a registered payment aggregator already live with M-Pesa in Kenya, so it can trigger the same STK push without this app needing its own Safaricom merchant relationship — useful as a stand-in until direct Daraja production credentials come through, or permanently if that's simpler going forward.

**Only one rail is active at a time**, picked by the `PAYMENT_PROVIDER` env var (`mpesa` | `paystack`, default `mpesa`) — see [`src/lib/env.ts`](../src/lib/env.ts). Each provider's credential group is validated conditionally, so switching never needs dummy values for the one you're not using. A session's provider is fixed at creation time by which transaction row got populated (`MpesaTransaction` vs `PaystackTransaction`) — switching `PAYMENT_PROVIDER` never strands in-flight sessions started under the previous one, since `GET /api/sessions/[id]/status` branches on whichever relation is present, not on the current env value.

## Credentials needed

| Env var | Source | Notes |
|---|---|---|
| `PAYMENT_PROVIDER` | — | Set to `paystack` to make this the active rail |
| `PAYSTACK_SECRET_KEY` | Paystack dashboard > Settings > API Keys & Webhooks | `sk_test_...` or `sk_live_...` — the prefix alone determines test vs. live mode, there's no separate "sandbox" URL |

Unlike Safaricom's per-request `CallBackURL`, Paystack's webhook URL is configured once in the dashboard (Settings > API Keys & Webhooks), not sent on each charge. Point it at `${APP_BASE_URL}/api/paystack/webhook`.

## 1. Charge request (triggers the STK push)

```
POST https://api.paystack.co/charge
Authorization: Bearer sk_test_...
Content-Type: application/json

{
  "email": "2547XXXXXXXX@wisp-portal.portal.example.com",
  "amount": "5000",
  "reference": "<portalSessionId>",
  "mobile_money": {
    "phone": "2547XXXXXXXX",
    "provider": "mpesa"
  }
}
```

- `amount` is in the currency's subunit (cents) — same convention as Daraja's shillings-only `Amount`, except Paystack wants the *cents* value as a string. `KES 50` → `"5000"`. **Confirmed against a live charge.**
- `reference` should be the `PortalSession.id`, same role as Daraja's `AccountReference` — lets the webhook/verify fallback match back without depending solely on whatever reference Paystack might otherwise generate. **Confirmed**: the webhook's `data.reference` comes back exactly as sent.
- `mobile_money.phone` **must be in international `+254...` form** — Paystack's own docs show two conventions on the same page (`254...` no plus is only for the separate `mpesa_offline` variant; plain `mpesa` wants `+254...`). Sending the no-plus form this app normally uses internally (RADIUS username, session storage, etc.) gets a fast `400 "Invalid phone number format"`. Convert only at the point of building this request — [`initiateMpesaCharge`](../src/lib/paystack/client.ts) prepends the `+`.
- `email` is required by Paystack on every charge even though this app has no customer accounts — it's an **optional** field on the splash page's phone-entry form (see `PurchaseFlow`), stored on `PortalSession` for receipts/support lookups when given. When the subscriber leaves it blank, [`buildPlaceholderEmail`](../src/lib/paystack/client.ts) builds a deterministic, never-mailed placeholder instead (a subdomain of whatever `APP_BASE_URL` is on — a domain this deployment's operator actually owns). **Confirmed**: Paystack's validator checks the domain against a real-TLD allowlist, so an earlier attempt using the RFC 2606 `.invalid` TLD was rejected outright (`400 "\"email\" must be a valid email"`) before this fix.
- Response (`data.status`) starts in an intermediate state while the prompt is outstanding. **Confirmed against a live charge**: a successful STK push resolves with `gateway_response: "Approved"` on the `charge.success` webhook. See [`isTerminalPaystackStatus`](../src/lib/paystack/status.ts) for the full set this app treats as non-final (not yet individually confirmed against a live decline/cancel/timeout).

Store `reference` (Paystack's, which should match what you sent) on the `PaystackTransaction` row immediately, status `INITIATED`.

## 2. Webhook

Paystack POSTs to the dashboard-configured URL when the charge resolves:

```json
{
  "event": "charge.success",
  "data": {
    "reference": "...",
    "status": "success",
    "amount": 5000,
    "gateway_response": "Successful",
    "paid_at": "2026-01-01T12:01:15.000Z"
  }
}
```

Paystack documents no dedicated charge-failure event — only `charge.success`. A declined/cancelled/timed-out STK prompt is instead caught by the verify-transaction fallback below, same as Daraja's callback-never-arrives case.

Handler responsibilities (`POST /api/paystack/webhook`):

1. Verify `x-paystack-signature`: HMAC-SHA512 of the **raw** request body, keyed by `PAYSTACK_SECRET_KEY`, compared with `crypto.timingSafeEqual`. Reject with `401` on mismatch — this is the only authentication on this endpoint, unlike Daraja which has none at all beyond obscurity of the URL.
2. Only act on `event === "charge.success"`.
3. Look up `PaystackTransaction` by `reference`.
4. Store the raw payload (`rawWebhook` JSON column) regardless of outcome — needed for support/debugging, same as `MpesaTransaction.rawCallback`.
5. **Idempotency**: guard on `PaystackTransaction.status` already being terminal, no-op if so — see [`applyPaystackResult`](../src/lib/paystack/apply-charge-result.ts), shared by both the webhook and the verify fallback so they can never diverge (mirrors `src/lib/mpesa/apply-stk-result.ts`).
6. Always return `200` — Paystack retries on timeouts/5xx, so acknowledge fast and log problems for us to investigate rather than surfacing them as retries.

## 3. Fallback: verify transaction

**Implemented in `GET /api/sessions/[id]/status`**, same pattern as the Daraja STK Push Query fallback — not a separate job. Once a `PaystackTransaction` has been `INITIATED` for more than `QUERY_FALLBACK_AFTER_MS` (15s) with nothing having resolved it, the status route calls:

```
GET https://api.paystack.co/transaction/verify/:reference
Authorization: Bearer sk_test_...
```

A non-terminal `data.status` (see [`isTerminalPaystackStatus`](../src/lib/paystack/status.ts)) means "still processing" — not applied, the session just keeps waiting. Any terminal status is run through the exact same logic the webhook uses.

The splash page's **"Check now" button** (see [`MPESA-INTEGRATION.md`](MPESA-INTEGRATION.md)'s fallback section) hits this same path with `?force=true`, so it works identically here — the status route branches on whichever transaction relation the session has, not on the current `PAYMENT_PROVIDER` value.

## UI states

Same `PortalSession.status` machine as the Daraja path — `PENDING → AWAITING_PAYMENT → (PAID → PROVISIONED) | FAILED | CANCELLED | TIMEOUT` — the UI doesn't need to know or care which provider is active.

## Confirmed against a live charge (2026-11-07)

A real KES charge via a subscriber's own phone resolved end-to-end: `charge.success` webhook received, `PaystackTransaction.status` → `SUCCESS` with `gatewayResponse: "Approved"`, `PortalSession` → `PAID` → `PROVISIONED`, RADIUS `radcheck`/`radreply` rows written correctly. The `amount`-in-cents and `+254...` phone conventions above were both debugged against this live attempt (see git history on this file/`client.ts` for the exact errors Paystack returned before each fix).

## Still open — not yet confirmed against a live decline/cancel/timeout

- The exact `data.status` value(s) for a *failed*, *cancelled*, or *timed-out* STK prompt (only the success path has been exercised so far), and whether `mapPaystackStatus`'s guesses (`"reversed"`, `"abandoned"`, `"timeout"`) match what Paystack actually sends.
- Whether any mobile-money providers on the Kenya corridor ever need a follow-up OTP-submission call (some Paystack mobile-money providers in other countries do; Safaricom's own STK push does not, and the one successful charge so far didn't need one, but this isn't confirmed for every case).
- Whether `charge.success`'s `data` object includes a `customer`/`phone` field in practice (not inspected on the one confirmed payload yet).
