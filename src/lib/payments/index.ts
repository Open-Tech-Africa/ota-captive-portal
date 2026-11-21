import "server-only"
import { appDb } from "@/lib/db/app"
import { env } from "@/lib/env"
import { checkMpesaPayment, startMpesaPayment } from "@/lib/payments/mpesa"
import { checkPaystackPayment, startPaystackPayment } from "@/lib/payments/paystack"
import type { SessionWithPackage, SessionWithPayment } from "@/lib/payments/types"

export { sessionWithPaymentInclude } from "@/lib/payments/types"
export type { SessionWithPayment } from "@/lib/payments/types"

// Give the provider's own webhook a head start before we proactively ask — most transactions
// resolve well within this window, and we'd rather not double up on API calls for every poll tick.
const CHECK_FALLBACK_AFTER_MS = 15_000

/**
 * Starts a payment for a PENDING session with whichever provider `PAYMENT_PROVIDER` selects, and
 * moves the session to AWAITING_PAYMENT. On failure the session is marked FAILED and the error
 * rethrown, so the caller can tell the subscriber.
 */
export async function startPayment(session: SessionWithPackage): Promise<void> {
  try {
    if (env.PAYMENT_PROVIDER === "paystack") {
      await startPaystackPayment(session)
    } else {
      await startMpesaPayment(session)
    }
  } catch (error) {
    console.error(`[payments] ${env.PAYMENT_PROVIDER} payment initiation failed`, error)
    await appDb.portalSession.update({ where: { id: session.id }, data: { status: "FAILED" } })
    throw error
  }
}

/**
 * The polling fallback for a webhook that never arrives: asks the session's provider directly and
 * applies the result if it's final. Does nothing unless the payment is still outstanding and has
 * had `CHECK_FALLBACK_AFTER_MS` to resolve on its own — `force` skips that wait (the splash page's
 * "Check now" button). Never throws: on a failed check the session just stays AWAITING_PAYMENT
 * and the next poll tries again.
 *
 * The provider is whichever transaction the session was started with, not the current
 * `PAYMENT_PROVIDER`, so switching providers never strands sessions started under the old one.
 */
export async function checkPayment(
  session: SessionWithPayment,
  { force }: { force: boolean },
): Promise<void> {
  if (session.status !== "AWAITING_PAYMENT") return

  const isCheckDue = (startedAt: Date) =>
    force || Date.now() - startedAt.getTime() > CHECK_FALLBACK_AFTER_MS

  const { transaction: mpesaTransaction, paystackTransaction } = session
  try {
    if (mpesaTransaction?.status === "INITIATED" && isCheckDue(mpesaTransaction.createdAt)) {
      await checkMpesaPayment(session, mpesaTransaction)
    } else if (
      paystackTransaction?.status === "INITIATED" &&
      isCheckDue(paystackTransaction.createdAt)
    ) {
      await checkPaystackPayment(session, paystackTransaction)
    }
  } catch (error) {
    console.error("[payments] status check fallback failed", error)
  }
}

/** The provider's own description of how the payment ended, shown to the subscriber verbatim. */
export function paymentResultMessage(session: SessionWithPayment): string | null {
  return session.transaction?.resultDesc ?? session.paystackTransaction?.gatewayResponse ?? null
}
