import "server-only"
import { z } from "zod"

const serverEnvSchema = z
  .object({
    DATABASE_URL: z.url(),
    RADIUS_DATABASE_URL: z.url(),
    APP_BASE_URL: z.url(),

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

    RADIUS_CLEANUP_GRACE_MINUTES: z.coerce.number().int().positive().default(10),
    // Required by POST /api/radius-cleanup to authorize the external scheduler that triggers it.
    CRON_SECRET: z.string().min(16, "Generate one with: openssl rand -base64 32"),

    // Gates /admin — a single shared staff password for now, not per-user accounts. See
    // docs/ADMIN.md for why, and what replaces this later.
    ADMIN_PASSWORD: z.string().min(8, "Generate one with: openssl rand -base64 18"),
  })
  .superRefine((value, ctx) => {
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
