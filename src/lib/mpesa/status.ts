// Safaricom result codes seen in practice; not an exhaustive list. Anything unrecognized just
// becomes FAILED with resultDesc shown to the subscriber verbatim.
const CANCELLED_CODES = new Set([1032])
const TIMEOUT_CODES = new Set([1037])

export function mapResultCodeToStatus(
  resultCode: number,
): "SUCCESS" | "CANCELLED" | "TIMEOUT" | "FAILED" {
  if (resultCode === 0) return "SUCCESS"
  if (CANCELLED_CODES.has(resultCode)) return "CANCELLED"
  if (TIMEOUT_CODES.has(resultCode)) return "TIMEOUT"
  return "FAILED"
}
