import { NextResponse } from "next/server"
import { appDb } from "@/lib/db/app"
import { env } from "@/lib/env"
import { buildCaptivePortalLogonFields } from "@/lib/opnsense/logon"
import { queryStkPushStatus } from "@/lib/mpesa/client"
import { applyStkResult } from "@/lib/mpesa/apply-stk-result"
import type { SessionStatusResponse } from "@/lib/schemas/session"
import type { MpesaTransaction, Package, PortalSession } from "@/generated/app-client"

// Give Safaricom's own callback a head start before we proactively ask — most transactions
// resolve well within this window, and we'd rather not double up on API calls for every poll tick.
const QUERY_FALLBACK_AFTER_MS = 15_000
// Safaricom's own "nothing to report yet" code for STK Push Query — not a real failure/success.
const STILL_PROCESSING_RESULT_CODE = 4999

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  // Only /connecting sets this — it's the one place the one-time password is actually consumed.
  // The splash page's own polling loop hits this same route every few seconds just to watch for
  // a status change, and must never trigger the one-time read, or /connecting finds it already
  // cleared by the time it asks.
  const reveal = new URL(request.url).searchParams.get("reveal") === "true"

  let session = await appDb.portalSession.findUnique({
    where: { id },
    include: { transaction: true, package: true },
  })
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 })
  }

  if (
    session.status === "AWAITING_PAYMENT" &&
    session.transaction &&
    session.transaction.status === "INITIATED" &&
    Date.now() - session.transaction.createdAt.getTime() > QUERY_FALLBACK_AFTER_MS
  ) {
    await tryResolveViaQueryFallback(session, session.transaction)
    // The fallback may have just changed status/radiusPasswordOneTime — reload before responding.
    session = await appDb.portalSession.findUnique({
      where: { id },
      include: { transaction: true, package: true },
    })
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 })
    }
  }

  // The one-time password is served exactly once: clear it the moment it's read, so a page
  // refresh on /connecting can't resubmit stale credentials.
  let radiusPassword: string | null = null
  if (reveal && session.radiusPasswordOneTime) {
    radiusPassword = session.radiusPasswordOneTime
    await appDb.portalSession.update({
      where: { id },
      data: { radiusPasswordOneTime: null },
    })
  }

  const captivePortalLogon =
    session.status === "PROVISIONED" && session.radiusUsername && radiusPassword
      ? buildCaptivePortalLogonFields({
          zoneId: session.zoneId ?? env.OPNSENSE_DEFAULT_ZONE_ID,
          username: session.radiusUsername,
          password: radiusPassword,
          redirectUrl: session.redirectUrl,
        })
      : null

  const response: SessionStatusResponse = {
    id: session.id,
    status: session.status,
    resultDesc: session.transaction?.resultDesc ?? null,
    captivePortalLogon,
  }

  return NextResponse.json(response)
}

/**
 * Asks Safaricom directly instead of waiting on a callback that may never arrive — see
 * docs/MPESA-INTEGRATION.md's STK Push Query fallback. Failures here are swallowed: the session
 * just stays AWAITING_PAYMENT and the next poll tries again.
 */
async function tryResolveViaQueryFallback(
  session: PortalSession & { package: Package },
  transaction: MpesaTransaction,
): Promise<void> {
  try {
    const result = await queryStkPushStatus(transaction.checkoutRequestId)
    const resultCode = Number(result.ResultCode)
    if (resultCode === STILL_PROCESSING_RESULT_CODE) return

    await applyStkResult(
      { ...transaction, session },
      { resultCode, resultDesc: result.ResultDesc, raw: result },
    )
  } catch (error) {
    console.error("[sessions/status] STK query fallback failed", error)
  }
}
