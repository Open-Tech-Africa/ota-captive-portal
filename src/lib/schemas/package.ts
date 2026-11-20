import { z } from "zod"

export const packageDurationSchema = z.enum(["HOURLY", "DAILY", "WEEKLY"])

/** Public shape of a package, as sent to the browser. No pricing/bandwidth internals beyond what the UI needs. */
export const packageSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  duration: packageDurationSchema,
  durationMinutes: z.number().int().positive(),
  priceKes: z.number().int().positive(),
  downKbps: z.number().int().positive(),
  upKbps: z.number().int().positive(),
})

export type PackageDuration = z.infer<typeof packageDurationSchema>
export type PublicPackage = z.infer<typeof packageSchema>

/** Shared between the splash page's package cards and the admin packages table. */
export const PACKAGE_DURATION_LABEL: Record<PackageDuration, string> = {
  HOURLY: "Hourly",
  DAILY: "Daily",
  WEEKLY: "Weekly",
}

/**
 * Full admin-side shape for creating/editing a package — everything the public schema above
 * leaves out. downKbps/upKbps are enforced via OPNsense's Traffic Shaper, not a RADIUS attribute —
 * see docs/OPNSENSE-SETUP.md#8-traffic-shaper-per-package-speed-limits for why (OPNsense's captive
 * portal doesn't read any bandwidth field from RADIUS at all). Used for both POST (create) and
 * PATCH (edit, as `.partial()`).
 */
export const packageInputSchema = z.object({
  name: z.string().min(1, "Name is required"),
  duration: packageDurationSchema,
  durationMinutes: z.coerce.number().int().positive(),
  priceKes: z.coerce.number().int().positive(),
  downKbps: z.coerce.number().int().positive(),
  upKbps: z.coerce.number().int().positive(),
  radiusGroup: z.string().nullish(),
  isActive: z.boolean(),
  sortOrder: z.coerce.number().int(),
})

export type PackageInput = z.infer<typeof packageInputSchema>

/** What the admin package list/detail endpoints send back — the full row, not the trimmed public shape. */
export const adminPackageSchema = packageInputSchema.extend({
  id: z.string().min(1),
})

export type AdminPackage = z.infer<typeof adminPackageSchema>
