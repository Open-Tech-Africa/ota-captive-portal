import { z } from "zod"

/** An optional customer-supplied email. Blank input and absent input are both "not provided". */
export const optionalEmailSchema = z
  .string()
  .trim()
  .transform((value) => (value.length === 0 ? null : value))
  .pipe(z.email("Enter a valid email").nullable())
  .nullish()
