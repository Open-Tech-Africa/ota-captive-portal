import { NextResponse } from "next/server"
import { appDb } from "@/lib/db/app"
import { buildCaptivePortalLogonFields } from "@/lib/opnsense/logon"
import { checkPayment, paymentResultMessage, sessionWithPaymentInclude } from "@/lib/payments"
import type { SessionStatusResponse } from "@/lib/schemas/session"

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  // Only /connecting sets this — it's the one place the one-time password is actually consumed.
  // The splash page's own polling loop hits this same route every few seconds just to watch for
  // a status change, and must never trigger the one-time read, or /connecting finds it already
  // cleared by the time it asks.
  const reveal = new URL(request.url).searchParams.get("reveal") === "true"
  // Set by the splash page's "Check now" button — lets a subscriber who came back to a stuck tab
  // (e.g. the browser throttled polling while backgrounded to enter their M-Pesa PIN) ask for an
  // immediate gateway check instead of waiting out checkPayment's head start or the next poll.
  const force = new URL(request.url).searchParams.get("force") === "true"

  let session = await appDb.portalSession.findUnique({
    where: { id },
    include: sessionWithPaymentInclude,
  })
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 })
  }

  if (session.status === "AWAITING_PAYMENT") {
    await checkPayment(session, { force })

    // The check may have just changed status/radiusPasswordOneTime — reload before responding.
    session = await appDb.portalSession.findUnique({
      where: { id },
      include: sessionWithPaymentInclude,
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
          username: session.radiusUsername,
          password: radiusPassword,
        })
      : null

  const response: SessionStatusResponse = {
    id: session.id,
    status: session.status,
    resultDesc: paymentResultMessage(session),
    captivePortalLogon,
    redirectUrl: session.redirectUrl,
  }

  return NextResponse.json(response)
}
