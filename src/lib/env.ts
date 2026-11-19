import "server-only"
import { z } from "zod"

const serverEnvSchema = z
  .object({
    DATABASE_URL: z.url(),
    RADIUS_DATABASE_URL: z.url(),
    APP_BASE_URL: z.url(),

    // The hotspot's own brand, shown on the splash page and in the page title — every deployer
    // of this app runs a different network, so this is the one piece of "Mamba WiFi"-style
    // branding that isn't hardcoded. Kept separate from the fixed "Built by Open Tech Africa"
    // footer credit (src/components/portal/vendor-attribution.tsx), which doesn't change per
    // deployment.
    SITE_NAME: z.string().min(1).default("Mamba WiFi"),

    // Which STK-push rail is live. Both providers' credential groups below are optional in the base
    // schema and required conditionally (see superRefine) so switching providers never needs dummy
    // values for the one you're not using — see docs/PAYSTACK-INTEGRATION.md for why this exists.
    PAYMENT_PROVIDER: z.enum(["mpesa", "paystack"]).default("mpesa"),

    MPESA_ENV: z.enum(["sandbox", "production"]).optional(),
    MPESA_CONSUMER_KEY: z.string().min(1).optional(),
    MPESA_CONSUMER_SECRET: z.string().min(1).optional(),
    MPESA_SHORTCODE: z.string().min(1).optional(),
    MPESA_PASSKEY: z.string().min(1).optional(),
    MPESA_CALLBACK_URL: z.url().optional(),

    // Paystack has no separate sandbox/production base URL — test vs. live mode is purely
    // determined by which secret key you use (sk_test_... vs sk_live_...).
    PAYSTACK_SECRET_KEY: z.string().min(1).optional(),

    OPNSENSE_CAPTIVE_PORTAL_BASE_URL: z.url(),

    // Admin-only, optional: lets /admin/sessions read live captive-portal sessions and force a
    // disconnect via OPNsense's own REST API — a different credential/host than
    // OPNSENSE_CAPTIVE_PORTAL_BASE_URL above (that one's the anonymous, per-zone client-facing
    // logon endpoint; this is OPNsense's main admin API, key/secret auth, usually on the LAN/admin
    // interface). See docs/OPNSENSE-SETUP.md#7-admin-api-live-sessions--force-disconnect. The
    // feature degrades to "not configured" in the admin UI when these are left unset.
    OPNSENSE_API_BASE_URL: z.url().optional(),
    OPNSENSE_API_KEY: z.string().min(1).optional(),
    OPNSENSE_API_SECRET: z.string().min(1).optional(),
    // OPNsense captive portal zone id (not the port-implied zone used by the logon endpoint above)
    // — the session list/disconnect API calls need it explicitly. 0 is the default/first zone on
    // almost every install; confirm under Services > Captive Portal > Administration if unsure.
    OPNSENSE_CAPTIVE_PORTAL_ZONE_ID: z.coerce.number().int().nonnegative().default(0),
    // OPNsense's admin GUI/API near-universally runs a self-signed cert on a bare LAN IP (same
    // reason OPNSENSE-SETUP.md's step 2 keeps the client-facing portal on HTTP-only) — default to
    // skipping TLS verification for this one admin-API client. Set to false if you've put a real
    // cert on OPNsense's GUI.
    OPNSENSE_API_ALLOW_SELF_SIGNED: z.coerce.boolean().default(true),
    // OPNsense's own interface identifier (e.g. "opt1") for the hotspot VLAN/interface — NOT an IP,
    // and not necessarily the same as what Services > Captive Portal > Administration shows; check
    // Interfaces > Overview. Required for the Traffic Shaper rules that enforce package speeds —
    // see docs/OPNSENSE-SETUP.md#8-traffic-shaper-per-package-speed-limits.
    OPNSENSE_HOTSPOT_INTERFACE: z.string().min(1).optional(),

    RADIUS_CLEANUP_GRACE_MINUTES: z.coerce.number().int().positive().default(10),
    // Required by POST /api/radius-cleanup to authorize the external scheduler that triggers it.
    CRON_SECRET: z.string().min(16, "Generate one with: openssl rand -base64 32"),

    // Gates /admin — a single shared staff password for now, not per-user accounts. See
    // docs/ADMIN.md for why, and what replaces this later.
    ADMIN_PASSWORD: z.string().min(8, "Generate one with: openssl rand -base64 18"),
  })
  .superRefine((value, ctx) => {
    const opnsenseAdminApiFields = [
      "OPNSENSE_API_BASE_URL",
      "OPNSENSE_API_KEY",
      "OPNSENSE_API_SECRET",
    ] as const
    const setCount = opnsenseAdminApiFields.filter((key) => value[key]).length
    if (setCount > 0 && setCount < opnsenseAdminApiFields.length) {
      for (const key of opnsenseAdminApiFields) {
        if (!value[key]) {
          ctx.addIssue({
            code: "custom",
            path: [key],
            message: `${key} must be set together with the other OPNsense admin API vars, or left unset entirely`,
          })
        }
      }
    }

    if (value.PAYMENT_PROVIDER === "mpesa") {
      const required = [
        "MPESA_ENV",
        "MPESA_CONSUMER_KEY",
        "MPESA_CONSUMER_SECRET",
        "MPESA_SHORTCODE",
        "MPESA_PASSKEY",
        "MPESA_CALLBACK_URL",
      ] as const
      for (const key of required) {
        if (!value[key]) {
          ctx.addIssue({
            code: "custom",
            path: [key],
            message: `${key} is required when PAYMENT_PROVIDER=mpesa`,
          })
        }
      }
    } else {
      if (!value.PAYSTACK_SECRET_KEY) {
        ctx.addIssue({
          code: "custom",
          path: ["PAYSTACK_SECRET_KEY"],
          message: "PAYSTACK_SECRET_KEY is required when PAYMENT_PROVIDER=paystack",
        })
      }
    }
  })

export type ServerEnv = z.infer<typeof serverEnvSchema>

/** Validated server environment. Fails fast at startup with a readable message. */
export const env: ServerEnv = serverEnvSchema.parse(process.env)

export const mpesaBaseUrl =
  env.MPESA_ENV === "production" ? "https://api.safaricom.co.ke" : "https://sandbox.safaricom.co.ke"

export const isOpnsenseAdminApiConfigured = Boolean(
  env.OPNSENSE_API_BASE_URL && env.OPNSENSE_API_KEY && env.OPNSENSE_API_SECRET,
)

/**
 * The Traffic Shaper integration (docs/OPNSENSE-SETUP.md#8-traffic-shaper-per-package-speed-limits)
 * needs the admin API above plus the hotspot interface name — kept as its own flag rather than
 * folded into the admin-API group so /admin/sessions (which doesn't need the interface) still
 * works with just the three admin-API vars set.
 */
export const isShaperConfigured = Boolean(
  isOpnsenseAdminApiConfigured && env.OPNSENSE_HOTSPOT_INTERFACE,
)
