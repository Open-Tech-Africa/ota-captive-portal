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
  "email": "2547XXXXXXXX@wisp-portal.invalid",
  "amount": "5000",
  "reference": "<portalSessionId>",
  "mobile_money": {
    "phone": "2547XXXXXXXX",
    "provider": "mpesa"
  }
}
```

- `email` is required by Paystack on every charge even though this app has no customer accounts — [`buildPlaceholderEmail`](../src/lib/paystack/client.ts) builds a deterministic, never-mailed placeholder (`<phone>@wisp-portal.invalid`, using the `.invalid` TLD reserved by RFC 2606 for exactly this).
- `amount` is in the currency's subunit (cents) — same convention as Daraja's shillings-only `Amount`, except Paystack wants the *cents* value as a string. `KES 50` → `"5000"`.
- `reference` should be the `PortalSession.id`, same role as Daraja's `AccountReference` — lets the webhook/verify fallback match back without depending solely on whatever reference Paystack might otherwise generate.
- Response (`data.status`) starts in an intermediate state while the prompt is outstanding — community reports describe `"pay_offline"`, but verify this against a live sandbox call. See [`isTerminalPaystackStatus`](../src/lib/paystack/status.ts) for the full set this app treats as non-final.

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

## UI states

Same `PortalSession.status` machine as the Daraja path — `PENDING → AWAITING_PAYMENT → (PAID → PROVISIONED) | FAILED | CANCELLED | TIMEOUT` — the UI doesn't need to know or care which provider is active.

## Open items to confirm against a live sandbox before go-live

- The exact `data.status` value(s) Paystack returns for a Kenya M-Pesa charge while the STK prompt is outstanding, and whether any mobile-money providers on the Kenya corridor ever need a follow-up OTP-submission call (some Paystack mobile-money providers in other countries do; Safaricom's own STK push does not, so this app currently assumes Kenya M-Pesa via Paystack behaves the same way).
- Whether `charge.success`'s `data` object includes a `customer`/`phone` field in practice, and the exact shape of `gateway_response`/`paid_at` for a mobile money (not card) charge.
- Confirm `amount` subunit convention for KES specifically — assumed cents (×100) by analogy with NGN kobo, not shown as a worked example in Paystack's docs.
