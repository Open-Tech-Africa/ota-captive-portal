import { z } from "zod"

const callbackMetadataItemSchema = z.object({
  Name: z.string(),
  Value: z.union([z.string(), z.number()]).optional(),
})

/** Safaricom's STK Push callback body. Field names are Safaricom's, not ours — do not rename. */
export const stkCallbackSchema = z.object({
  Body: z.object({
    stkCallback: z.object({
      MerchantRequestID: z.string(),
      CheckoutRequestID: z.string(),
      ResultCode: z.number(),
      ResultDesc: z.string(),
      CallbackMetadata: z
        .object({
          Item: z.array(callbackMetadataItemSchema),
        })
        .optional(),
    }),
  }),
})

export type StkCallback = z.infer<typeof stkCallbackSchema>

/** Pulls a named value out of CallbackMetadata.Item, e.g. "MpesaReceiptNumber" or "Amount". */
export function getCallbackMetadataValue(
  callback: StkCallback,
  name: string,
): string | number | undefined {
  return callback.Body.stkCallback.CallbackMetadata?.Item.find((item) => item.Name === name)?.Value
}
