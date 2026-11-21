import type {
  MpesaTransaction,
  Package,
  PaystackTransaction,
  PortalSession,
} from "@/generated/app-client"

/** The final result of a payment, in this app's own terms — each provider maps its codes onto it. */
export type PaymentOutcome = "SUCCESS" | "CANCELLED" | "TIMEOUT" | "FAILED"

export type SessionWithPackage = PortalSession & { package: Package }

/** A session loaded with everything the payments module needs — see `sessionWithPaymentInclude`. */
export type SessionWithPayment = SessionWithPackage & {
  transaction: MpesaTransaction | null
  paystackTransaction: PaystackTransaction | null
}

export const sessionWithPaymentInclude = {
  package: true,
  transaction: true,
  paystackTransaction: true,
} as const
