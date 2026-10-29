import "server-only"
import { z } from "zod"

const serverEnvSchema = z.object({
  DATABASE_URL: z.url(),
  RADIUS_DATABASE_URL: z.url(),
  APP_BASE_URL: z.url(),

  MPESA_ENV: z.enum(["sandbox", "production"]),
  MPESA_CONSUMER_KEY: z.string().min(1),
  MPESA_CONSUMER_SECRET: z.string().min(1),
  MPESA_SHORTCODE: z.string().min(1),
  MPESA_PASSKEY: z.string().min(1),
  MPESA_CALLBACK_URL: z.url(),

  OPNSENSE_CAPTIVE_PORTAL_BASE_URL: z.url(),
  OPNSENSE_DEFAULT_ZONE_ID: z.string().min(1),

  RADIUS_CLEANUP_GRACE_MINUTES: z.coerce.number().int().positive().default(10),
  // Required by POST /api/radius-cleanup to authorize the external scheduler that triggers it.
  CRON_SECRET: z.string().min(16, "Generate one with: openssl rand -base64 32"),
})

export type ServerEnv = z.infer<typeof serverEnvSchema>

/** Validated server environment. Fails fast at startup with a readable message. */
export const env: ServerEnv = serverEnvSchema.parse(process.env)

export const mpesaBaseUrl =
  env.MPESA_ENV === "production" ? "https://api.safaricom.co.ke" : "https://sandbox.safaricom.co.ke"
