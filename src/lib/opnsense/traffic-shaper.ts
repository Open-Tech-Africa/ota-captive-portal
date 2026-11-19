import "server-only"
import { env } from "@/lib/env"
import { opnsenseAdminRequest } from "@/lib/opnsense/admin-client"

/**
 * Per-package speed enforcement via OPNsense's Traffic Shaper API — see
 * docs/OPNSENSE-SETUP.md#8-traffic-shaper-per-package-speed-limits for why this exists instead of
 * a RADIUS bandwidth attribute (OPNsense's captive portal doesn't read one). Field names and the
 * add/set/del request-response shapes below come from OPNsense's own model/controller source
 * (https://github.com/opnsense/core — TrafficShaper.xml, SettingsController.php,
 * ApiMutableModelControllerBase.php), not a live instance — see that doc section's "confirm
 * against the live OPNsense version" note before trusting this against a real deployment.
 *
 * Design: one pipe pair (download + upload) per *package*, created lazily on first use and cached
 * on the Package row (shaperDownPipeUuid/shaperUpPipeUuid) — not deduplicated across packages
 * with the same speed, to keep this simple; a WISP has a handful of packages, not thousands, so a
 * few extra pipes cost nothing. One rule pair per *session*, bound to the subscriber's actual IP
 * (from findActiveSessionIpByUsername), created once they log into OPNsense and torn down by the
 * same job that removes their RADIUS credentials on expiry (src/lib/radius/cleanup.ts).
 */

type ShaperAddResponse =
  { result: "saved"; uuid: string } | { result: "failed"; validations?: Record<string, string> }

type ShaperDelResponse = { result: "deleted" | "not found" | "failed" }

function assertSaved(response: unknown, what: string): asserts response is { uuid: string } {
  const result = response as ShaperAddResponse
  if (!result || result.result !== "saved" || !("uuid" in result)) {
    throw new Error(`OPNsense rejected the ${what}: ${JSON.stringify(response)}`)
  }
}

async function reconfigure(): Promise<void> {
  await opnsenseAdminRequest("/api/trafficshaper/service/reconfigure/", { method: "POST" })
}

async function addPipe(bandwidthKbps: number, description: string): Promise<string> {
  const response = await opnsenseAdminRequest("/api/trafficshaper/settings/add_pipe/", {
    method: "POST",
    contentType: "application/json",
    body: JSON.stringify({
      pipe: {
        enabled: "1",
        bandwidth: String(bandwidthKbps),
        bandwidthMetric: "Kbit",
        mask: "none",
        description,
      },
    }),
  })
  assertSaved(response, "shaper pipe")
  return response.uuid
}

async function setPipeBandwidth(uuid: string, bandwidthKbps: number): Promise<void> {
  await opnsenseAdminRequest(`/api/trafficshaper/settings/set_pipe/${uuid}/`, {
    method: "POST",
    contentType: "application/json",
    body: JSON.stringify({
      pipe: { bandwidth: String(bandwidthKbps), bandwidthMetric: "Kbit" },
    }),
  })
}

/**
 * direction is relative to `interface`, per pf/OPNsense convention — "in" is traffic arriving at
 * that interface (the hotspot client's upload), "out" is traffic leaving toward it (the client's
 * download). Unconfirmed against a live box; verify before relying on it (see module docblock).
 */
async function addRule(fields: {
  source: string
  destination: string
  direction: "in" | "out"
  targetPipeUuid: string
  description: string
}): Promise<string> {
  if (!env.OPNSENSE_HOTSPOT_INTERFACE) {
    throw new Error("OPNSENSE_HOTSPOT_INTERFACE isn't configured")
  }
  const response = await opnsenseAdminRequest("/api/trafficshaper/settings/add_rule/", {
    method: "POST",
    contentType: "application/json",
    body: JSON.stringify({
      rule: {
        enabled: "1",
        interface: env.OPNSENSE_HOTSPOT_INTERFACE,
        proto: "ip",
        source: fields.source,
        destination: fields.destination,
        direction: fields.direction,
        target: fields.targetPipeUuid,
        description: fields.description,
      },
    }),
  })
  assertSaved(response, "shaper rule")
  return response.uuid
}

async function delRule(uuid: string): Promise<void> {
  const response = (await opnsenseAdminRequest(`/api/trafficshaper/settings/del_rule/${uuid}/`, {
    method: "POST",
  })) as ShaperDelResponse
  if (response.result === "failed") {
    throw new Error(`OPNsense refused to delete shaper rule ${uuid}`)
  }
  // "not found" is fine — already gone, nothing left to clean up.
}

/** Creates this package's download/upload pipes on first use; a no-op once both UUIDs are cached. */
export async function ensurePackageShaperPipes(pkg: {
  id: string
  downKbps: number
  upKbps: number
  shaperDownPipeUuid: string | null
  shaperUpPipeUuid: string | null
}): Promise<{ downPipeUuid: string; upPipeUuid: string; createdNew: boolean }> {
  if (pkg.shaperDownPipeUuid && pkg.shaperUpPipeUuid) {
    return {
      downPipeUuid: pkg.shaperDownPipeUuid,
      upPipeUuid: pkg.shaperUpPipeUuid,
      createdNew: false,
    }
  }

  const downPipeUuid =
    pkg.shaperDownPipeUuid ?? (await addPipe(pkg.downKbps, `ota-captive-portal ${pkg.id} download`))
  const upPipeUuid =
    pkg.shaperUpPipeUuid ?? (await addPipe(pkg.upKbps, `ota-captive-portal ${pkg.id} upload`))
  await reconfigure()
  return { downPipeUuid, upPipeUuid, createdNew: true }
}

/** Best-effort: updates an already-created pipe pair's bandwidth after a package edit. */
export async function updatePackageShaperBandwidth(pkg: {
  downKbps: number
  upKbps: number
  shaperDownPipeUuid: string | null
  shaperUpPipeUuid: string | null
}): Promise<void> {
  if (!pkg.shaperDownPipeUuid || !pkg.shaperUpPipeUuid) return
  await setPipeBandwidth(pkg.shaperDownPipeUuid, pkg.downKbps)
  await setPipeBandwidth(pkg.shaperUpPipeUuid, pkg.upKbps)
  await reconfigure()
}

/** Binds a subscriber's IP to their package's pipes. Call removeShaperRules first on a reconnect. */
export async function applyShaperRules(fields: {
  ip: string
  downPipeUuid: string
  upPipeUuid: string
  description: string
}): Promise<{ downRuleUuid: string; upRuleUuid: string }> {
  const upRuleUuid = await addRule({
    source: fields.ip,
    destination: "any",
    direction: "in",
    targetPipeUuid: fields.upPipeUuid,
    description: `${fields.description} upload`,
  })
  const downRuleUuid = await addRule({
    source: "any",
    destination: fields.ip,
    direction: "out",
    targetPipeUuid: fields.downPipeUuid,
    description: `${fields.description} download`,
  })
  await reconfigure()
  return { downRuleUuid, upRuleUuid }
}

export async function removeShaperRules(uuids: {
  downRuleUuid?: string | null
  upRuleUuid?: string | null
}): Promise<void> {
  const toDelete = [uuids.downRuleUuid, uuids.upRuleUuid].filter((uuid): uuid is string => !!uuid)
  if (toDelete.length === 0) return
  for (const uuid of toDelete) {
    await delRule(uuid)
  }
  await reconfigure()
}
