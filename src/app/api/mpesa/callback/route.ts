import { NextResponse } from "next/server"
import { appDb } from "@/lib/db/app"
import { stkCallbackSchema, getCallbackMetadataValue } from "@/lib/schemas/mpesa"
import { applyStkResult } from "@/lib/mpesa/apply-stk-result"

// Safaricom retries on anything but a 200 with ResultCode 0, so every path below returns that —
// errors are logged for us to investigate, never surfaced back to Safaricom as a retry trigger.
const ACK = NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted" })

export async function POST(request: Request) {
  const rawBody: unknown = await request.json().catch(() => null)
  const parsed = stkCallbackSchema.safeParse(rawBody)
  if (!parsed.success) {
    console.error("[mpesa/callback] unrecognized payload shape", parsed.error.flatten())
    return ACK
  }
  const { stkCallback } = parsed.data.Body

  const transaction = await appDb.mpesaTransaction.findUnique({
    where: { checkoutRequestId: stkCallback.CheckoutRequestID },
    include: { session: { include: { package: true } } },
  })
  if (!transaction) {
    console.error(
      "[mpesa/callback] no transaction for CheckoutRequestID",
      stkCallback.CheckoutRequestID,
    )
    return ACK
  }

  const mpesaReceiptNumber = getCallbackMetadataValue(parsed.data, "MpesaReceiptNumber")
  const transactionDateRaw = getCallbackMetadataValue(parsed.data, "TransactionDate")

  await applyStkResult(transaction, {
    resultCode: stkCallback.ResultCode,
    resultDesc: stkCallback.ResultDesc,
    mpesaReceiptNumber: mpesaReceiptNumber ? String(mpesaReceiptNumber) : null,
    transactionDate: transactionDateRaw
      ? parseMpesaTransactionDate(String(transactionDateRaw))
      : null,
    raw: rawBody,
  })

  return ACK
}

/** Safaricom sends TransactionDate as e.g. 20260101120115 (YYYYMMDDHHmmss, Nairobi time). */
function parseMpesaTransactionDate(value: string): Date {
  const year = value.slice(0, 4)
  const month = value.slice(4, 6)
  const day = value.slice(6, 8)
  const hour = value.slice(8, 10)
  const minute = value.slice(10, 12)
  const second = value.slice(12, 14)
  return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}+03:00`)
}
