import "server-only"
import { appDb } from "@/lib/db/app"
import { radiusDb } from "@/lib/db/radius"
import { env, isShaperConfigured } from "@/lib/env"
import { removeShaperRules } from "@/lib/opnsense/traffic-shaper"

/**
 * Best-effort: a shaper-API hiccup should never stop RADIUS credential cleanup, which is the
 * security-critical half of this job. Failures are logged, not thrown — a leaked shaper rule just
 * sits there bound to an IP that's no longer authenticated, which is low-stakes, not a dangling
 * credential that could keep authenticating.
 */
async function removeShaperRulesBestEffort(session: {
  id: string
  shaperDownRuleUuid: string | null
  shaperUpRuleUuid: string | null
}): Promise<void> {
  if (!isShaperConfigured) return
  if (!session.shaperDownRuleUuid && !session.shaperUpRuleUuid) return
  try {
    await removeShaperRules({
      downRuleUuid: session.shaperDownRuleUuid,
      upRuleUuid: session.shaperUpRuleUuid,
    })
  } catch (error) {
    console.error(`[radius-cleanup] failed to remove shaper rules for session ${session.id}`, error)
  }
}

/**
 * Deletes RADIUS credentials for sessions whose package has expired, so a lapsed password can't
 * keep authenticating. Meant to be run on a schedule (see README for wiring a cron trigger).
 *
 * Because the RADIUS username is the subscriber's phone number (stable across visits — see
 * docs/RADIUS-INTEGRATION.md#tracking-returning-subscribers), this only deletes a phone number's
 * `radcheck`/`radreply`/`radusergroup` rows when the expiring session is still that phone
 * number's most recent `PROVISIONED` one — a subscriber who paid again before this job ran must
 * keep their newer credentials.
 */
export async function cleanupExpiredRadiusSessions(): Promise<{ cleaned: number }> {
  const cutoff = new Date(Date.now() - env.RADIUS_CLEANUP_GRACE_MINUTES * 60_000)

  const expiredSessions = await appDb.portalSession.findMany({
    where: { status: "PROVISIONED", expiresAt: { lt: cutoff } },
  })

  let cleaned = 0

  for (const session of expiredSessions) {
    const latestForPhoneNumber = await appDb.portalSession.findFirst({
      where: { phoneNumber: session.phoneNumber, status: "PROVISIONED" },
      orderBy: { createdAt: "desc" },
    })

    if (latestForPhoneNumber && latestForPhoneNumber.id !== session.id) {
      // A newer paid session already replaced these RADIUS credentials — but its shaper rules (if
      // any) are keyed by this session's own row, not the username, so the new session's own
      // apply-shaper call won't touch them. Clear them here before closing the record out.
      await removeShaperRulesBestEffort(session)
      await appDb.portalSession.update({
        where: { id: session.id },
        data: {
          status: "EXPIRED",
          shaperClientIp: null,
          shaperDownRuleUuid: null,
          shaperUpRuleUuid: null,
        },
      })
      continue
    }

    try {
      await radiusDb.$transaction([
        radiusDb.radcheck.deleteMany({ where: { username: session.phoneNumber } }),
        radiusDb.radreply.deleteMany({ where: { username: session.phoneNumber } }),
        radiusDb.radusergroup.deleteMany({ where: { username: session.phoneNumber } }),
      ])
      await removeShaperRulesBestEffort(session)
      await appDb.portalSession.update({
        where: { id: session.id },
        data: {
          status: "EXPIRED",
          shaperClientIp: null,
          shaperDownRuleUuid: null,
          shaperUpRuleUuid: null,
        },
      })
      await appDb.radiusProvisionLog.create({
        data: { sessionId: session.id, action: "CLEANUP", success: true },
      })
      cleaned += 1
    } catch (error) {
      await appDb.radiusProvisionLog.create({
        data: {
          sessionId: session.id,
          action: "CLEANUP",
          success: false,
          error: error instanceof Error ? error.message : String(error),
        },
      })
    }
  }

  return { cleaned }
}
