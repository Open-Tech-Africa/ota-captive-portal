import "server-only"
import { appDb } from "@/lib/db/app"
import { provisionRadiusAccess } from "@/lib/radius/provision"
import { mapPaystackStatus } from "@/lib/paystack/status"
import type { PaystackTransaction, Package, PortalSession } from "@/generated/app-client"

export type ResolvedChargeResult = {
  /** Paystack's raw status string (e.g. "success", "failed", "reversed") — already confirmed terminal. */
  status: string
  gatewayResponse?: string | null
  paidAt?: Date | null
  /** Whatever payload this result came from (Paystack's webhook body, or our own verify response) — kept for debugging. */
  raw?: unknown
}

type TransactionWithSession = PaystackTransaction & {
  session: PortalSession & { package: Package }
}

/**
 * Applies a resolved Paystack result to a transaction/session, whichever route learned about it —
 * the charge.success webhook, or the status-polling verify fallback. Both must behave identically,
 * so this is the one place that logic lives (mirrors src/lib/mpesa/apply-stk-result.ts).
 */
export async function applyPaystackResult(
  transaction: TransactionWithSession,
  result: ResolvedChargeResult,
): Promise<void> {
  // Idempotency: a transaction only ever gets one result applied, from whichever path sees it first.
  if (transaction.status !== "INITIATED") return

  const status = mapPaystackStatus(result.status)

  await appDb.paystackTransaction.update({
    where: { id: transaction.id },
    data: {
      status,
      gatewayResponse: result.gatewayResponse ?? undefined,
      paidAt: result.paidAt ?? undefined,
      rawWebhook: (result.raw as object | undefined) ?? undefined,
    },
  })

  if (status !== "SUCCESS") {
    await appDb.portalSession.update({ where: { id: transaction.sessionId }, data: { status } })
    return
  }

  await appDb.portalSession.update({
    where: { id: transaction.sessionId },
    data: { status: "PAID" },
  })

  try {
    const { session } = transaction
    const { package: pkg } = session
    const { username, password } = await provisionRadiusAccess(
      session,
      pkg,
      pkg.durationMinutes * 60,
    )

    await appDb.portalSession.update({
      where: { id: session.id },
      data: {
        status: "PROVISIONED",
        radiusUsername: username,
        radiusPasswordOneTime: password,
        expiresAt: new Date(Date.now() + pkg.durationMinutes * 60_000),
      },
    })
  } catch (error) {
    console.error("[paystack] RADIUS provisioning failed", error)
    await appDb.portalSession.update({
      where: { id: transaction.sessionId },
      data: { status: "FAILED" },
    })
  }
}
