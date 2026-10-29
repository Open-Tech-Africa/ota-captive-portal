import "server-only"
import { appDb } from "@/lib/db/app"
import { radiusDb } from "@/lib/db/radius"
import { env } from "@/lib/env"

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
      // A newer paid session already replaced these credentials — just close out this record.
      await appDb.portalSession.update({ where: { id: session.id }, data: { status: "EXPIRED" } })
      continue
    }

    try {
      await radiusDb.$transaction([
        radiusDb.radcheck.deleteMany({ where: { username: session.phoneNumber } }),
        radiusDb.radreply.deleteMany({ where: { username: session.phoneNumber } }),
        radiusDb.radusergroup.deleteMany({ where: { username: session.phoneNumber } }),
      ])
      await appDb.portalSession.update({ where: { id: session.id }, data: { status: "EXPIRED" } })
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
