import { NextResponse } from "next/server"
import { appDb } from "@/lib/db/app"
import { isShaperConfigured } from "@/lib/env"
import { findActiveSessionIpByUsername } from "@/lib/opnsense/admin-client"
import {
  applyShaperRules,
  ensurePackageShaperPipes,
  removeShaperRules,
} from "@/lib/opnsense/traffic-shaper"

/**
 * Called from /connecting (src/components/portal/captive-portal-auto-login.tsx) a moment after
 * the subscriber's hidden-iframe form POST to OPNsense's logon endpoint — not before: OPNsense
 * doesn't have a session for this client until that POST lands, and this app's own server has no
 * other reliable way to learn the client's real IP (see docs/OPNSENSE-SETUP.md#8). Best-effort and
 * fire-and-forget from the browser's side: every failure mode here returns 200 `skipped` rather
 * than an error, since a subscriber should never get stuck on /connecting because OPNsense's
 * Traffic Shaper API hiccupped — worst case, they get online without a speed cap applied.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  if (!isShaperConfigured) {
    return NextResponse.json({ ok: true, skipped: "not_configured" })
  }

  const session = await appDb.portalSession.findUnique({
    where: { id },
    include: { package: true },
  })
  if (!session || session.status !== "PROVISIONED") {
    return NextResponse.json({ ok: true, skipped: "no_active_session" })
  }

  try {
    const ip = await findActiveSessionIpByUsername(session.phoneNumber)
    if (!ip) {
      return NextResponse.json({ ok: true, skipped: "ip_not_found_yet" })
    }

    const pkg = session.package
    const { downPipeUuid, upPipeUuid } = await ensurePackageShaperPipes(pkg)
    if (!pkg.shaperDownPipeUuid || !pkg.shaperUpPipeUuid) {
      await appDb.package.update({
        where: { id: pkg.id },
        data: { shaperDownPipeUuid: downPipeUuid, shaperUpPipeUuid: upPipeUuid },
      })
    }

    // A reconnect (docs/RADIUS-INTEGRATION.md#re-login-without-re-paying) reuses this same session
    // row — clear whatever rules a previous connect left bound (possibly to a different IP) before
    // creating fresh ones, so a device switch or re-auth never leaves a stale rule behind.
    await removeShaperRules({
      downRuleUuid: session.shaperDownRuleUuid,
      upRuleUuid: session.shaperUpRuleUuid,
    })

    const { downRuleUuid, upRuleUuid } = await applyShaperRules({
      ip,
      downPipeUuid,
      upPipeUuid,
      description: `ota session ${session.id}`,
    })

    await appDb.portalSession.update({
      where: { id: session.id },
      data: { shaperClientIp: ip, shaperDownRuleUuid: downRuleUuid, shaperUpRuleUuid: upRuleUuid },
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("[sessions/apply-shaper] failed", error)
    return NextResponse.json({ ok: true, skipped: "error" })
  }
}
