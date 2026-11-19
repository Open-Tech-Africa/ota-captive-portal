import "server-only"
import { randomBytes } from "node:crypto"
import { radiusDb } from "@/lib/db/radius"
import { appDb } from "@/lib/db/app"
import type { Package, PortalSession } from "@/generated/app-client"

const RADIUS_PASSWORD_BYTES = 16

function generateRadiusPassword(): string {
  return randomBytes(RADIUS_PASSWORD_BYTES).toString("base64url")
}

/**
 * Grants RADIUS access and logs the outcome.
 *
 * The RADIUS username is the subscriber's phone number (stable across visits, so daloRADIUS's
 * own `radacct` history groups a returning subscriber's sessions together — see
 * docs/RADIUS-INTEGRATION.md#tracking-returning-subscribers). Only the password rotates per
 * session. Any credentials left over from a previous paid session for this phone number are
 * replaced, not accumulated.
 *
 * `sessionTimeoutSeconds` is caller-supplied rather than derived from `pkg` here, since it isn't
 * always the package's full duration — a free reconnect (see docs/RADIUS-INTEGRATION.md#re-login-
 * without-re-paying) passes whatever time is actually left, not another full grant.
 */
export async function provisionRadiusAccess(
  session: PortalSession,
  pkg: Package,
  sessionTimeoutSeconds: number,
): Promise<{ username: string; password: string }> {
  const username = session.phoneNumber
  const password = generateRadiusPassword()

  try {
    await radiusDb.$transaction([
      radiusDb.radcheck.deleteMany({ where: { username } }),
      radiusDb.radreply.deleteMany({ where: { username } }),
      radiusDb.radusergroup.deleteMany({ where: { username } }),
      radiusDb.radcheck.create({
        data: { username, attribute: "Cleartext-Password", op: ":=", value: password },
      }),
      radiusDb.radreply.create({
        data: {
          username,
          attribute: "Session-Timeout",
          op: ":=",
          value: String(sessionTimeoutSeconds),
        },
      }),
      ...(pkg.radiusGroup
        ? [
            radiusDb.radusergroup.create({
              data: { username, groupname: pkg.radiusGroup, priority: 1 },
            }),
          ]
        : []),
    ])

    await appDb.radiusProvisionLog.create({
      data: { sessionId: session.id, action: "PROVISION", success: true },
    })

    return { username, password }
  } catch (error) {
    await appDb.radiusProvisionLog.create({
      data: {
        sessionId: session.id,
        action: "PROVISION",
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
    })
    throw error
  }
}
