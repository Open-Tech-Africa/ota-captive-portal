import "server-only"
import { appDb } from "@/lib/db/app"
import { provisionRadiusAccess } from "@/lib/radius/provision"
import { mapResultCodeToStatus } from "@/lib/mpesa/status"
import type { MpesaTransaction, Package, PortalSession } from "@/generated/app-client"

export type ResolvedStkResult = {
  resultCode: number
  resultDesc: string
  mpesaReceiptNumber?: string | null
  transactionDate?: Date | null
  /** Whatever payload this result came from (Safaricom's webhook body, or our own query response) — kept for debugging. */
  raw?: unknown
}

type TransactionWithSession = MpesaTransaction & {
  session: PortalSession & { package: Package }
}

/**
 * Applies a resolved M-Pesa result to a transaction/session, whichever route learned about it —
 * the callback webhook, or the status-polling fallback query. Both must behave identically, so
 * this is the one place that logic lives.
 */
export async function applyStkResult(
  transaction: TransactionWithSession,
  result: ResolvedStkResult,
): Promise<void> {
  // Idempotency: a transaction only ever gets one result applied, from whichever path sees it first.
  if (transaction.status !== "INITIATED") return

  const status = mapResultCodeToStatus(result.resultCode)

  await appDb.mpesaTransaction.update({
    where: { id: transaction.id },
    data: {
      status,
      resultCode: result.resultCode,
      resultDesc: result.resultDesc,
      mpesaReceiptNumber: result.mpesaReceiptNumber ?? undefined,
      transactionDate: result.transactionDate ?? undefined,
      rawCallback: (result.raw as object | undefined) ?? undefined,
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
    console.error("[mpesa] RADIUS provisioning failed", error)
    await appDb.portalSession.update({
      where: { id: transaction.sessionId },
      data: { status: "FAILED" },
    })
  }
}
