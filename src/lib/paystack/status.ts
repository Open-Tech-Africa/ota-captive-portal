// Paystack's charge status strings seen in practice; not an exhaustive list — verify against a
// live sandbox response before go-live.

// Intermediate states while the STK prompt is still outstanding on the subscriber's phone. These
// must never be treated as a final result (mirrors Safaricom's ResultCode 4999 "still processing").
const NON_TERMINAL_STATUSES = new Set(["pending", "pay_offline", "send_otp", "send_pin", "ongoing"])

const CANCELLED_STATUSES = new Set(["reversed", "abandoned"])
const TIMEOUT_STATUSES = new Set(["timeout"])

export function isTerminalPaystackStatus(status: string): boolean {
  return !NON_TERMINAL_STATUSES.has(status)
}

/** Anything unrecognized just becomes FAILED with gatewayResponse shown to the subscriber verbatim. */
export function mapPaystackStatus(status: string): "SUCCESS" | "CANCELLED" | "TIMEOUT" | "FAILED" {
  if (status === "success") return "SUCCESS"
  if (CANCELLED_STATUSES.has(status)) return "CANCELLED"
  if (TIMEOUT_STATUSES.has(status)) return "TIMEOUT"
  return "FAILED"
}
