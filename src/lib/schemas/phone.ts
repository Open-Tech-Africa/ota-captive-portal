import { z } from "zod"

const KENYAN_MOBILE_PATTERN = /^(?:\+?254|0)?(7\d{8}|1\d{8})$/

/** Normalizes a Kenyan mobile number (07..., +2547..., 2547...) to Daraja's 2547XXXXXXXX form. */
export function normalizeKenyanPhoneNumber(value: string): string | null {
  const match = KENYAN_MOBILE_PATTERN.exec(value.trim())
  if (!match) return null
  return `254${match[1]}`
}

export const phoneNumberSchema = z
  .string()
  .trim()
  .min(1, "Enter a phone number")
  .transform((value, ctx) => {
    const normalized = normalizeKenyanPhoneNumber(value)
    if (!normalized) {
      ctx.addIssue({ code: "custom", message: "Enter a valid Safaricom number, e.g. 07XXXXXXXX" })
      return z.NEVER
    }
    return normalized
  })

export type NormalizedPhoneNumber = z.infer<typeof phoneNumberSchema>
