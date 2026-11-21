import "server-only"
import { appDb } from "@/lib/db/app"
import {
  buildPlaceholderEmail,
  initiateMpesaCharge,
  verifyTransaction,
} from "@/lib/paystack/client"
import { isTerminalPaystackStatus, mapPaystackStatus } from "@/lib/paystack/status"
import { settlePayment } from "@/lib/payments/settle"
import type { SessionWithPackage } from "@/lib/payments/types"
import type { PaystackTransaction } from "@/generated/app-client"

export type PaystackResult = {
  /** Paystack's raw status string (e.g. "success", "failed", "reversed") — already confirmed terminal. */
  status: string
  gatewayResponse?: string | null
  paidAt?: Date | null
  /** Whatever payload this result came from (Paystack's webhook body, or our own verify response) — kept for debugging. */
  raw?: unknown
}

type PaystackTransactionWithSession = PaystackTransaction & { session: SessionWithPackage }

/** Starts an M-Pesa charge through Paystack and records the transaction it started. */
export async function startPaystackPayment(session: SessionWithPackage): Promise<void> {
  const { package: pkg } = session
  const chargeResponse = await initiateMpesaCharge({
    phoneNumber: session.phoneNumber,
    amountKes: pkg.priceKes,
    email: session.email ?? buildPlaceholderEmail(session.phoneNumber),
    accountReference: session.id,
  })

  await appDb.$transaction([
    appDb.paystackTransaction.create({
      data: {
        sessionId: session.id,
        reference: chargeResponse.data.reference,
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
 * Asks Paystack directly instead of waiting on a charge.success webhook that may never arrive —
 * see docs/PAYSTACK-INTEGRATION.md's verify-transaction fallback. Throws on a failed request; a
 * status that isn't final yet is a no-op.
 */
export async function checkPaystackPayment(
  session: SessionWithPackage,
  transaction: PaystackTransaction,
): Promise<void> {
  const result = await verifyTransaction(transaction.reference)
  if (!isTerminalPaystackStatus(result.data.status)) return

  await applyPaystackResult(
    { ...transaction, session },
    {
      status: result.data.status,
      gatewayResponse: result.data.gateway_response,
      paidAt: result.data.paid_at ? new Date(result.data.paid_at) : null,
      raw: result,
    },
  )
}

/**
 * Applies a final Paystack result, whichever route learned about it — the charge.success webhook,
 * or the status-polling verify fallback. Idempotent: a transaction only ever gets one result
 * applied, from whichever path sees it first.
 */
export async function applyPaystackResult(
  transaction: PaystackTransactionWithSession,
  result: PaystackResult,
): Promise<void> {
  const outcome = mapPaystackStatus(result.status)

  // Store the result only if no other path has stored one yet. The check and the write must be
  // a single UPDATE: checking `transaction.status` first would read a copy loaded earlier, which
  // the webhook and the polling fallback can both hold at once.
  const { count: storedCount } = await appDb.paystackTransaction.updateMany({
    where: { id: transaction.id, status: "INITIATED" },
    data: {
      status: outcome,
      gatewayResponse: result.gatewayResponse ?? undefined,
      paidAt: result.paidAt ?? undefined,
      rawWebhook: (result.raw as object | undefined) ?? undefined,
    },
  })
  if (storedCount === 0) return

  await settlePayment(transaction.session, outcome)
}
