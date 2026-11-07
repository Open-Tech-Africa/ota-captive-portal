import { z } from "zod"

/**
 * Paystack's Charge endpoint response for an initiated mobile money charge. Field names are
 * Paystack's, not ours — do not rename. `data.status` is kept as a free string rather than a
 * closed enum: Paystack's public docs don't show a worked Kenya M-Pesa example, and community
 * reports describe an intermediate value like "pay_offline" while the STK prompt is outstanding —
 * verify the exact set of values against a live sandbox response before go-live.
 */
export const chargeResponseSchema = z.object({
  status: z.boolean(),
  message: z.string(),
  data: z.object({
    reference: z.string(),
    status: z.string(),
    display_text: z.string().optional(),
  }),
})

export type ChargeResponse = z.infer<typeof chargeResponseSchema>

/**
 * `charge.success` webhook body — the only charge-related event Paystack documents (no dedicated
 * failure event; failed/abandoned STK prompts are caught by the verify-transaction fallback
 * instead). Verify field names against a live sandbox payload before go-live.
 */
export const chargeWebhookSchema = z.object({
  event: z.string(),
  data: z.object({
    reference: z.string(),
    status: z.string(),
    amount: z.number(),
    currency: z.string().optional(),
    gateway_response: z.string().nullable().optional(),
    paid_at: z.string().nullable().optional(),
    customer: z.object({ phone: z.string().nullable().optional() }).optional(),
  }),
})

export type ChargeWebhook = z.infer<typeof chargeWebhookSchema>

/** `GET /transaction/verify/:reference` response — the STK-query-style fallback. */
export const verifyTransactionResponseSchema = z.object({
  status: z.boolean(),
  message: z.string(),
  data: z.object({
    reference: z.string(),
    amount: z.number(),
    currency: z.string(),
    status: z.string(),
    gateway_response: z.string().nullable().optional(),
    paid_at: z.string().nullable().optional(),
    channel: z.string().optional(),
  }),
})

export type VerifyTransactionResponse = z.infer<typeof verifyTransactionResponseSchema>

/** `POST /refund` response. Paystack's own docs show inconsistent casing for createdAt/updatedAt
 * across endpoints — kept loose here since this app only reads `status` and `reference`. */
export const refundResponseSchema = z.object({
  status: z.boolean(),
  message: z.string(),
  data: z.object({
    reference: z.string(),
    status: z.string(),
    amount: z.number().optional(),
  }),
})

export type RefundResponse = z.infer<typeof refundResponseSchema>
