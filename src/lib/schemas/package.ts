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
