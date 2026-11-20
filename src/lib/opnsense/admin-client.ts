import "server-only"
import https from "node:https"
import { env } from "@/lib/env"
import { parseOpnsenseSessionList, type OpnsenseSession } from "@/lib/schemas/opnsense-session"

// A LAN-only API with no reverse proxy in front has no sensible retry/backoff story if it's
// simply unreachable (box down, wrong IP, firewalled) — fail fast rather than hang on the OS's
// own TCP timeout (observed: several minutes), which would otherwise stall /admin/sessions and
// leave /connecting's apply-shaper call occupying a request for far longer than its caller
// (a fire-and-forget fetch() with no timeout of its own) expects.
const REQUEST_TIMEOUT_MS = 8_000

/**
 * OPNsense's main admin REST API (key/secret Basic Auth) — distinct from
 * src/lib/opnsense/logon.ts's anonymous, client-facing captive-portal logon endpoint. See
 * docs/OPNSENSE-SETUP.md#7-admin-api-live-sessions--force-disconnect for how to generate the key
 * and which privilege it needs. Uses node:https directly (not fetch) so the self-signed-cert
 * bypass stays scoped to this one client instead of needing a global TLS override.
 */
export function opnsenseAdminRequest(
  path: string,
  options: { method?: string; body?: string; contentType?: string } = {},
) {
  if (!env.OPNSENSE_API_BASE_URL || !env.OPNSENSE_API_KEY || !env.OPNSENSE_API_SECRET) {
    throw new Error("OPNsense admin API isn't configured — set OPNSENSE_API_BASE_URL/KEY/SECRET")
  }

  const url = new URL(path, env.OPNSENSE_API_BASE_URL)
  const credentials = Buffer.from(`${env.OPNSENSE_API_KEY}:${env.OPNSENSE_API_SECRET}`).toString(
    "base64",
  )

  return new Promise<unknown>((resolve, reject) => {
    const request = https.request(
      url,
      {
        method: options.method ?? "GET",
        rejectUnauthorized: !env.OPNSENSE_API_ALLOW_SELF_SIGNED,
        headers: {
          Authorization: `Basic ${credentials}`,
          "Content-Type": options.contentType ?? "application/x-www-form-urlencoded",
          ...(options.body ? { "Content-Length": Buffer.byteLength(options.body) } : {}),
        },
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on("data", (chunk: Buffer) => chunks.push(chunk))
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8")
          if (!response.statusCode || response.statusCode >= 400) {
            reject(new Error(`OPNsense API request failed: ${response.statusCode} ${text}`))
            return
          }
          try {
            resolve(text ? JSON.parse(text) : null)
          } catch {
            reject(new Error(`OPNsense API returned a non-JSON response: ${text.slice(0, 200)}`))
          }
        })
      },
    )
    request.on("error", reject)
    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error(`OPNsense API request to ${path} timed out`))
    })
    if (options.body) request.write(options.body)
    request.end()
  })
}

export async function listCaptivePortalSessions(): Promise<OpnsenseSession[]> {
  const payload = await opnsenseAdminRequest(
    `/api/captiveportal/session/list/${env.OPNSENSE_CAPTIVE_PORTAL_ZONE_ID}/`,
  )
  return parseOpnsenseSessionList(payload)
}

/**
 * Used by the Traffic Shaper integration (src/lib/opnsense/traffic-shaper.ts) to find out what IP
 * OPNsense itself assigned a subscriber's captive-portal session to, once their browser has
 * actually logged in — this app's own server can't reliably determine a hotspot client's real IP
 * any other way (it's self-hosted behind no reverse proxy, so there's no X-Forwarded-For; see
 * docs/OPNSENSE-SETUP.md#8-traffic-shaper-per-package-speed-limits). Returns null if no AUTHORIZED
 * session for this username is found yet — the caller should treat that as "not logged in yet",
 * not an error.
 */
export async function findActiveSessionIpByUsername(username: string): Promise<string | null> {
  const sessions = await listCaptivePortalSessions()
  const match = sessions.find(
    (session) => session.userName === username && session.clientState !== "NOT_AUTHORIZED",
  )
  return match?.ipAddress ?? null
}

/**
 * Admin-initiated kick, not the automatic expiry enforcement discussed in
 * docs/RADIUS-INTEGRATION.md#enforcing-expiry-passive-vs-active-open-design-question — that's
 * still an open design question. This just gives staff a manual "disconnect now" button; nothing
 * calls it automatically.
 */
export async function disconnectCaptivePortalSession(sessionId: string): Promise<void> {
  const result = await opnsenseAdminRequest(
    `/api/captiveportal/session/disconnect/${env.OPNSENSE_CAPTIVE_PORTAL_ZONE_ID}/`,
    { method: "POST", body: new URLSearchParams({ sessionId }).toString() },
  )

  const status =
    result && typeof result === "object" && "status" in result ? String(result.status) : null
  if (status === "Illegal response") {
    throw new Error("OPNsense rejected the disconnect request")
  }
}
