import { z } from "zod"
import { phoneNumberSchema } from "@/lib/schemas/phone"
import { optionalEmailSchema } from "@/lib/schemas/email"

/**
 * Submitted when a subscriber picks a package and enters their M-Pesa number. zoneId/clientIp/
 * redirectUrl come from the splash page's query params (absent -> `null`, not `undefined`, since
 * they're read from a parsed URL) — `nullish()` so both "missing" shapes are accepted.
 */
export const createSessionSchema = z.object({
  packageId: z.string().min(1, "Choose a package"),
  phoneNumber: phoneNumberSchema,
  /** Optional — falls back to a generated placeholder for providers that require one (Paystack). */
  email: optionalEmailSchema,
  zoneId: z.string().nullish(),
  clientIp: z.string().nullish(),
  clientMac: z.string().nullish(),
  redirectUrl: z.string().nullish(),
})

export type CreateSessionInput = z.infer<typeof createSessionSchema>

export const sessionStatusSchema = z.enum([
  "PENDING",
  "AWAITING_PAYMENT",
  "PAID",
  "PROVISIONED",
  "FAILED",
  "CANCELLED",
  "TIMEOUT",
  "EXPIRED",
])

/** Ready-made hidden form for the /connecting page to auto-submit — see docs/OPNSENSE-SETUP.md. */
export const captivePortalLogonSchema = z.object({
  action: z.string(),
  fields: z.record(z.string(), z.string()),
})

/** Public shape of a session's status, as polled by the splash page. */
export const sessionStatusResponseSchema = z.object({
  id: z.string(),
  status: sessionStatusSchema,
  resultDesc: z.string().nullable(),
  // Built server-side (needs OPNSENSE_CAPTIVE_PORTAL_BASE_URL) so /connecting never needs env access.
  captivePortalLogon: captivePortalLogonSchema.nullable(),
  // Where /connecting sends the browser once the OPNsense logon POST has fired — OPNsense's own
  // login page would normally do this itself, but /connecting isn't that page.
  redirectUrl: z.string().nullable(),
})

export type SessionStatusResponse = z.infer<typeof sessionStatusResponseSchema>
