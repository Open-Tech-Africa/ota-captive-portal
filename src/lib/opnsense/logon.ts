import { env } from "@/lib/env"

/**
 * Fields for the hidden form the `/connecting` page auto-submits, from the subscriber's own
 * browser, to OPNsense's captive portal logon endpoint. See docs/OPNSENSE-SETUP.md#4-logging-the-client-in-once-payment-clears
 * — verify the exact endpoint/field names against the installed OPNsense version before relying
 * on this in production.
 */
export type CaptivePortalLogonFields = {
  action: string
  fields: Record<string, string>
}

export function buildCaptivePortalLogonFields(params: {
  zoneId: string
  username: string
  password: string
  redirectUrl: string | null
}): CaptivePortalLogonFields {
  return {
    action: `${env.OPNSENSE_CAPTIVE_PORTAL_BASE_URL}/index.php?zone=${encodeURIComponent(params.zoneId)}`,
    fields: {
      zone: params.zoneId,
      auth_user: params.username,
      auth_pass: params.password,
      accept: "Continue",
      redirurl: params.redirectUrl ?? "",
    },
  }
}
