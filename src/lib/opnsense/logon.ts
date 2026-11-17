import { env } from "@/lib/env"

/**
 * Fields for the hidden form the `/connecting` page auto-submits, from the subscriber's own
 * browser, to OPNsense's captive portal REST API — see
 * docs/OPNSENSE-SETUP.md#4-logging-the-client-in-once-payment-clears. The zone is implicit in
 * which port `OPNSENSE_CAPTIVE_PORTAL_BASE_URL` points at (each zone's portal listens on its own
 * `8000+zoneid`), not a request field — this app only logs clients into the one zone that base
 * URL's port belongs to.
 */
export type CaptivePortalLogonFields = {
  action: string
  fields: Record<string, string>
}

export function buildCaptivePortalLogonFields(params: {
  username: string
  password: string
}): CaptivePortalLogonFields {
  return {
    action: `${env.OPNSENSE_CAPTIVE_PORTAL_BASE_URL}/api/captiveportal/access/logon/`,
    fields: {
      user: params.username,
      password: params.password,
    },
  }
}
