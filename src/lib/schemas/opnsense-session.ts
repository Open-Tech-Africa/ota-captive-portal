import { z } from "zod"

/**
 * One active OPNsense captive-portal client session, as returned by
 * `GET /api/captiveportal/session/list/<zoneid>/` — see
 * docs/OPNSENSE-SETUP.md#7-admin-api-live-sessions--force-disconnect. Field names/shapes are taken
 * from OPNsense's own docs and source (https://docs.opnsense.org/development/api/core/captiveportal.html),
 * not confirmed against a live instance yet — `.optional()` on anything not load-bearing for this
 * app's two uses (listing, disconnecting) so an unexpected extra/missing field doesn't break the
 * whole list.
 */
export const opnsenseSessionSchema = z.object({
  sessionId: z.string().min(1),
  userName: z.string().min(1),
  ipAddress: z.string().min(1),
  macAddress: z.string().optional(),
  clientState: z.string().optional(),
  startTime: z.coerce.number().optional(),
  bytes_in: z.coerce.number().optional(),
  bytes_out: z.coerce.number().optional(),
})

export type OpnsenseSession = z.infer<typeof opnsenseSessionSchema>

/**
 * The session/list endpoint's top-level shape isn't pinned down by OPNsense's own docs — a PHP
 * associative array keyed by session ID round-trips through json_encode as a JSON *object*, not an
 * array, unless the keys happen to be sequential integers. Accept either and normalize to a list.
 */
export function parseOpnsenseSessionList(payload: unknown): OpnsenseSession[] {
  const rawSessions = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object"
      ? Object.values(payload)
      : []

  const sessions: OpnsenseSession[] = []
  for (const raw of rawSessions) {
    const parsed = opnsenseSessionSchema.safeParse(raw)
    if (parsed.success) sessions.push(parsed.data)
  }
  return sessions
}
