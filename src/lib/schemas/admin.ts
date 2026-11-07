import { z } from "zod"

export const adminLoginSchema = z.object({
  password: z.string().min(1, "Enter the password"),
})

export const refundRequestSchema = z.object({
  transactionId: z.string().min(1),
})
