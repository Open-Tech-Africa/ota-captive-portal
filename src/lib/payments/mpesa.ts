import "server-only"
import { appDb } from "@/lib/db/app"
import { initiateStkPush, queryStkPushStatus } from "@/lib/mpesa/client"
import { mapResultCodeToStatus } from "@/lib/mpesa/status"
import { settlePayment } from "@/lib/payments/settle"
import type { SessionWithPackage } from "@/lib/payments/types"
import type { MpesaTransaction } from "@/generated/app-client"

// Safaricom's own "nothing to report yet" code for STK Push Query — not a real failure/success.
const STILL_PROCESSING_RESULT_CODE = 4999

export type MpesaResult = {
  resultCode: number
  resultDesc: string
  mpesaReceiptNumber?: string | null
  transactionDate?: Date | null
  /** Whatever payload this result came from (Safaricom's webhook body, or our own query response) — kept for debugging. */
  raw?: unknown
}

type MpesaTransactionWithSession = MpesaTransaction & { session: SessionWithPackage }

/** Sends the STK Push and records the transaction it started. */
export async function startMpesaPayment(session: SessionWithPackage): Promise<void> {
  const { package: pkg } = session
  const stkResponse = await initiateStkPush({
    phoneNumber: session.phoneNumber,
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
        phoneNumber: session.phoneNumber,
        status: "INITIATED",
      },
    }),
    appDb.portalSession.update({
      where: { id: session.id },
      data: { status: "AWAITING_PAYMENT" },
    }),
  ])
}

/**
 * Asks Safaricom directly instead of waiting on a callback that may never arrive — see
 * docs/MPESA-INTEGRATION.md's STK Push Query fallback. Throws on a failed query; a result that
 * isn't final yet is a no-op.
 */
export async function checkMpesaPayment(
  session: SessionWithPackage,
  transaction: MpesaTransaction,
): Promise<void> {
  const result = await queryStkPushStatus(transaction.checkoutRequestId)
  const resultCode = Number(result.ResultCode)
  if (resultCode === STILL_PROCESSING_RESULT_CODE) return

  await applyMpesaResult(
    { ...transaction, session },
    { resultCode, resultDesc: result.ResultDesc, raw: result },
  )
}

/**
 * Applies a final M-Pesa result, whichever route learned about it — the callback webhook, or the
 * status-polling query fallback. Idempotent: a transaction only ever gets one result applied,
 * from whichever path sees it first.
 */
export async function applyMpesaResult(
  transaction: MpesaTransactionWithSession,
  result: MpesaResult,
): Promise<void> {
  const outcome = mapResultCodeToStatus(result.resultCode)

  // Store the result only if no other path has stored one yet. The check and the write must be
  // a single UPDATE: checking `transaction.status` first would read a copy loaded earlier, which
  // the webhook and the polling fallback can both hold at once.
  const { count: storedCount } = await appDb.mpesaTransaction.updateMany({
    where: { id: transaction.id, status: "INITIATED" },
    data: {
      status: outcome,
      resultCode: result.resultCode,
      resultDesc: result.resultDesc,
      mpesaReceiptNumber: result.mpesaReceiptNumber ?? undefined,
      transactionDate: result.transactionDate ?? undefined,
      rawCallback: (result.raw as object | undefined) ?? undefined,
    },
  })
  if (storedCount === 0) return

  await settlePayment(transaction.session, outcome)
}
