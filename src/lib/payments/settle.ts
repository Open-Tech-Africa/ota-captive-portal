import "server-only"
import { appDb } from "@/lib/db/app"
import { provisionRadiusAccess } from "@/lib/radius/provision"
import type { PaymentOutcome, SessionWithPackage } from "@/lib/payments/types"

/**
 * Moves a session on from a final payment outcome, whichever provider reported it: a failed
 * payment just records the outcome; a successful one goes PAID, then PROVISIONED once RADIUS
 * access is granted (or FAILED if provisioning throws).
 *
 * Callers must already have recorded the outcome on their own transaction row and checked that it
 * wasn't already settled — this function has no idempotency guard of its own.
 */
export async function settlePayment(
  session: SessionWithPackage,
  outcome: PaymentOutcome,
): Promise<void> {
  if (outcome !== "SUCCESS") {
    await appDb.portalSession.update({ where: { id: session.id }, data: { status: outcome } })
    return
  }

  await appDb.portalSession.update({ where: { id: session.id }, data: { status: "PAID" } })

  const { package: pkg } = session
  try {
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
    console.error("[payments] RADIUS provisioning failed", error)
    await appDb.portalSession.update({ where: { id: session.id }, data: { status: "FAILED" } })
  }
}
