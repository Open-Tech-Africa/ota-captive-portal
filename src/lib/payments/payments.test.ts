import { beforeEach, describe, expect, it, vi } from "vitest"
import { appDb } from "@/lib/db/app"
import { initiateStkPush, queryStkPushStatus } from "@/lib/mpesa/client"
import { initiateMpesaCharge, verifyTransaction } from "@/lib/paystack/client"
import { provisionRadiusAccess } from "@/lib/radius/provision"
import {
  checkPayment,
  paymentResultMessage,
  sessionWithPaymentInclude,
  startPayment,
} from "@/lib/payments"
import { applyMpesaResult } from "@/lib/payments/mpesa"
import { applyPaystackResult } from "@/lib/payments/paystack"
import { resetDatabase } from "../../../test/reset-database"

// Faked: the two payment providers' HTTP APIs and the RADIUS database (all external to this app).
// Real: this app's own Postgres, so every assertion below checks what was actually stored.
const testEnv = vi.hoisted(() => ({ PAYMENT_PROVIDER: "mpesa" as "mpesa" | "paystack" }))
vi.mock("@/lib/env", () => ({ env: testEnv }))
vi.mock("@/lib/mpesa/client", () => ({ initiateStkPush: vi.fn(), queryStkPushStatus: vi.fn() }))
vi.mock("@/lib/paystack/client", () => ({
  initiateMpesaCharge: vi.fn(),
  verifyTransaction: vi.fn(),
  buildPlaceholderEmail: (phoneNumber: string) => `${phoneNumber}@placeholder.test`,
}))
vi.mock("@/lib/radius/provision", () => ({ provisionRadiusAccess: vi.fn() }))

const PHONE_NUMBER = "254712345678"
const ONE_HOUR_MINUTES = 60
const CHECKOUT_REQUEST_ID = "ws_CO_TEST_1"
const PAYSTACK_REFERENCE = "paystack-ref-1"
const MPESA_CANCELLED_BY_USER = 1032
const MPESA_STILL_PROCESSING = 4999

beforeEach(async () => {
  await resetDatabase()
  vi.resetAllMocks()
  testEnv.PAYMENT_PROVIDER = "mpesa"

  vi.mocked(initiateStkPush).mockResolvedValue({
    MerchantRequestID: "merchant-1",
    CheckoutRequestID: CHECKOUT_REQUEST_ID,
    ResponseCode: "0",
    ResponseDescription: "Success. Request accepted for processing",
    CustomerMessage: "Success. Request accepted for processing",
  })
  vi.mocked(initiateMpesaCharge).mockResolvedValue({
    status: true,
    message: "Charge attempted",
    data: { reference: PAYSTACK_REFERENCE, status: "pay_offline" },
  })
  vi.mocked(provisionRadiusAccess).mockResolvedValue({
    username: PHONE_NUMBER,
    password: "one-time-password",
  })
})

async function createPendingSession({ email }: { email?: string } = {}) {
  const pkg = await appDb.package.create({
    data: {
      name: "1 Hour",
      duration: "HOURLY",
      durationMinutes: ONE_HOUR_MINUTES,
      priceKes: 20,
      downKbps: 5_000,
      upKbps: 2_000,
    },
  })
  return appDb.portalSession.create({
    data: { packageId: pkg.id, phoneNumber: PHONE_NUMBER, email, status: "PENDING" },
    include: { package: true },
  })
}

async function startedSession(provider: "mpesa" | "paystack") {
  testEnv.PAYMENT_PROVIDER = provider
  const session = await createPendingSession()
  await startPayment(session)
  return session
}

function loadSession(id: string) {
  return appDb.portalSession.findUniqueOrThrow({
    where: { id },
    include: sessionWithPaymentInclude,
  })
}

function loadMpesaTransaction() {
  return appDb.mpesaTransaction.findUniqueOrThrow({
    where: { checkoutRequestId: CHECKOUT_REQUEST_ID },
    include: { session: { include: { package: true } } },
  })
}

function loadPaystackTransaction() {
  return appDb.paystackTransaction.findUniqueOrThrow({
    where: { reference: PAYSTACK_REFERENCE },
    include: { session: { include: { package: true } } },
  })
}

/** Moves a session's transaction back in time, past checkPayment's head-start window. */
async function ageTransactions(sessionId: string) {
  const longAgo = new Date(Date.now() - 60_000)
  await appDb.mpesaTransaction.updateMany({ where: { sessionId }, data: { createdAt: longAgo } })
  await appDb.paystackTransaction.updateMany({ where: { sessionId }, data: { createdAt: longAgo } })
}

describe("startPayment", () => {
  it("sends an M-Pesa STK Push and waits for payment", async () => {
    const session = await startedSession("mpesa")

    expect(initiateStkPush).toHaveBeenCalledWith(
      expect.objectContaining({
        phoneNumber: PHONE_NUMBER,
        amount: 20,
        accountReference: session.id,
      }),
    )
    const stored = await loadSession(session.id)
    expect(stored.status).toBe("AWAITING_PAYMENT")
    expect(stored.transaction).toMatchObject({
      checkoutRequestId: CHECKOUT_REQUEST_ID,
      amount: 20,
      status: "INITIATED",
    })
    expect(stored.paystackTransaction).toBeNull()
  })

  it("starts a Paystack charge when Paystack is the configured provider", async () => {
    const session = await startedSession("paystack")

    const stored = await loadSession(session.id)
    expect(stored.status).toBe("AWAITING_PAYMENT")
    expect(stored.paystackTransaction).toMatchObject({
      reference: PAYSTACK_REFERENCE,
      status: "INITIATED",
    })
    expect(stored.transaction).toBeNull()
  })

  it("charges Paystack with the subscriber's email, or a placeholder when they gave none", async () => {
    testEnv.PAYMENT_PROVIDER = "paystack"
    await startPayment(await createPendingSession({ email: "subscriber@example.com" }))
    await resetDatabase()
    await startPayment(await createPendingSession())

    const emails = vi.mocked(initiateMpesaCharge).mock.calls.map(([request]) => request.email)
    expect(emails).toEqual(["subscriber@example.com", `${PHONE_NUMBER}@placeholder.test`])
  })

  it("marks the session FAILED and rethrows when the provider rejects the request", async () => {
    vi.mocked(initiateStkPush).mockRejectedValue(new Error("STK Push request failed: 500"))
    vi.spyOn(console, "error").mockImplementation(() => {})
    const session = await createPendingSession()

    await expect(startPayment(session)).rejects.toThrow("STK Push request failed")

    const stored = await loadSession(session.id)
    expect(stored.status).toBe("FAILED")
    expect(stored.transaction).toBeNull()
  })
})

describe("applying a final M-Pesa result", () => {
  it("provisions access when the payment succeeded", async () => {
    const session = await startedSession("mpesa")
    const before = Date.now()

    await applyMpesaResult(await loadMpesaTransaction(), {
      resultCode: 0,
      resultDesc: "The service request is processed successfully.",
      mpesaReceiptNumber: "RCPT123",
    })

    expect(provisionRadiusAccess).toHaveBeenCalledWith(
      expect.objectContaining({ id: session.id }),
      expect.objectContaining({ id: session.packageId }),
      ONE_HOUR_MINUTES * 60,
    )
    const stored = await loadSession(session.id)
    expect(stored).toMatchObject({
      status: "PROVISIONED",
      radiusUsername: PHONE_NUMBER,
      radiusPasswordOneTime: "one-time-password",
    })
    expect(stored.transaction).toMatchObject({ status: "SUCCESS", mpesaReceiptNumber: "RCPT123" })
    const expiresInMs = (stored.expiresAt?.getTime() ?? 0) - before
    expect(expiresInMs).toBeGreaterThanOrEqual(ONE_HOUR_MINUTES * 60_000)
    expect(expiresInMs).toBeLessThan(ONE_HOUR_MINUTES * 60_000 + 10_000)
  })

  it("records a cancelled payment without provisioning anything", async () => {
    const session = await startedSession("mpesa")

    await applyMpesaResult(await loadMpesaTransaction(), {
      resultCode: MPESA_CANCELLED_BY_USER,
      resultDesc: "Request cancelled by user",
    })

    expect(provisionRadiusAccess).not.toHaveBeenCalled()
    const stored = await loadSession(session.id)
    expect(stored.status).toBe("CANCELLED")
    expect(stored.transaction?.status).toBe("CANCELLED")
    expect(paymentResultMessage(stored)).toBe("Request cancelled by user")
  })

  it("applies only the first result when the same transaction is reported twice", async () => {
    const session = await startedSession("mpesa")

    await applyMpesaResult(await loadMpesaTransaction(), { resultCode: 0, resultDesc: "OK" })
    // A retried webhook, or the polling fallback landing after the webhook, with a different result.
    await applyMpesaResult(await loadMpesaTransaction(), {
      resultCode: MPESA_CANCELLED_BY_USER,
      resultDesc: "Request cancelled by user",
    })

    expect(provisionRadiusAccess).toHaveBeenCalledTimes(1)
    const stored = await loadSession(session.id)
    expect(stored.status).toBe("PROVISIONED")
    expect(stored.transaction?.status).toBe("SUCCESS")
  })

  it("marks the session FAILED, but keeps the payment recorded, when provisioning throws", async () => {
    vi.mocked(provisionRadiusAccess).mockRejectedValue(new Error("RADIUS database unreachable"))
    vi.spyOn(console, "error").mockImplementation(() => {})
    const session = await startedSession("mpesa")

    await applyMpesaResult(await loadMpesaTransaction(), { resultCode: 0, resultDesc: "OK" })

    const stored = await loadSession(session.id)
    expect(stored.status).toBe("FAILED")
    expect(stored.transaction?.status).toBe("SUCCESS")
    expect(stored.radiusPasswordOneTime).toBeNull()
  })
})

describe("applying a final Paystack result", () => {
  it("provisions access when the charge succeeded", async () => {
    const session = await startedSession("paystack")

    await applyPaystackResult(await loadPaystackTransaction(), {
      status: "success",
      gatewayResponse: "Approved",
    })

    const stored = await loadSession(session.id)
    expect(stored.status).toBe("PROVISIONED")
    expect(stored.paystackTransaction?.status).toBe("SUCCESS")
    expect(paymentResultMessage(stored)).toBe("Approved")
  })

  it("treats a reversed charge as cancelled", async () => {
    const session = await startedSession("paystack")

    await applyPaystackResult(await loadPaystackTransaction(), { status: "reversed" })

    expect(provisionRadiusAccess).not.toHaveBeenCalled()
    expect((await loadSession(session.id)).status).toBe("CANCELLED")
  })
})

describe("checkPayment", () => {
  it("leaves a fresh payment to the provider's webhook", async () => {
    const session = await startedSession("mpesa")

    await checkPayment(await loadSession(session.id), { force: false })

    expect(queryStkPushStatus).not.toHaveBeenCalled()
    expect((await loadSession(session.id)).status).toBe("AWAITING_PAYMENT")
  })

  it("asks the provider straight away when forced", async () => {
    vi.mocked(queryStkPushStatus).mockResolvedValue(stkQueryResponse(0, "OK"))
    const session = await startedSession("mpesa")

    await checkPayment(await loadSession(session.id), { force: true })

    expect(queryStkPushStatus).toHaveBeenCalledWith(CHECKOUT_REQUEST_ID)
    expect((await loadSession(session.id)).status).toBe("PROVISIONED")
  })

  it("resolves a payment whose webhook never arrived", async () => {
    vi.mocked(queryStkPushStatus).mockResolvedValue(
      stkQueryResponse(MPESA_CANCELLED_BY_USER, "Request cancelled by user"),
    )
    const session = await startedSession("mpesa")
    await ageTransactions(session.id)

    await checkPayment(await loadSession(session.id), { force: false })

    expect((await loadSession(session.id)).status).toBe("CANCELLED")
  })

  it("keeps waiting while M-Pesa reports the payment is still processing", async () => {
    vi.mocked(queryStkPushStatus).mockResolvedValue(
      stkQueryResponse(MPESA_STILL_PROCESSING, "The transaction is being processed"),
    )
    const session = await startedSession("mpesa")

    await checkPayment(await loadSession(session.id), { force: true })

    const stored = await loadSession(session.id)
    expect(stored.status).toBe("AWAITING_PAYMENT")
    expect(stored.transaction?.status).toBe("INITIATED")
  })

  it("keeps waiting, without throwing, when the provider can't be reached", async () => {
    vi.mocked(queryStkPushStatus).mockRejectedValue(new Error("STK Push query failed: 503"))
    vi.spyOn(console, "error").mockImplementation(() => {})
    const session = await startedSession("mpesa")

    await expect(
      checkPayment(await loadSession(session.id), { force: true }),
    ).resolves.toBeUndefined()

    expect((await loadSession(session.id)).status).toBe("AWAITING_PAYMENT")
  })

  it("keeps waiting while Paystack reports a non-final status, then resolves once it's final", async () => {
    vi.mocked(verifyTransaction).mockResolvedValueOnce(verifyResponse("pay_offline", null))
    vi.mocked(verifyTransaction).mockResolvedValueOnce(verifyResponse("success", "Approved"))
    const session = await startedSession("paystack")

    await checkPayment(await loadSession(session.id), { force: true })
    expect((await loadSession(session.id)).status).toBe("AWAITING_PAYMENT")

    await checkPayment(await loadSession(session.id), { force: true })
    expect((await loadSession(session.id)).status).toBe("PROVISIONED")
    expect(verifyTransaction).toHaveBeenCalledWith(PAYSTACK_REFERENCE)
  })

  it("checks with the provider the session started with, even after the provider is switched", async () => {
    vi.mocked(queryStkPushStatus).mockResolvedValue(stkQueryResponse(0, "OK"))
    const session = await startedSession("mpesa")
    testEnv.PAYMENT_PROVIDER = "paystack"

    await checkPayment(await loadSession(session.id), { force: true })

    expect(queryStkPushStatus).toHaveBeenCalled()
    expect(verifyTransaction).not.toHaveBeenCalled()
    expect((await loadSession(session.id)).status).toBe("PROVISIONED")
  })

  it("does nothing for a session that isn't awaiting payment", async () => {
    const session = await startedSession("mpesa")
    await applyMpesaResult(await loadMpesaTransaction(), { resultCode: 0, resultDesc: "OK" })

    await checkPayment(await loadSession(session.id), { force: true })

    expect(queryStkPushStatus).not.toHaveBeenCalled()
  })
})

function stkQueryResponse(resultCode: number, resultDesc: string) {
  return {
    ResponseCode: "0",
    ResponseDescription: "The service request has been accepted successsfully",
    MerchantRequestID: "merchant-1",
    CheckoutRequestID: CHECKOUT_REQUEST_ID,
    ResultCode: String(resultCode),
    ResultDesc: resultDesc,
  }
}

function verifyResponse(status: string, gatewayResponse: string | null) {
  return {
    status: true,
    message: "Verification successful",
    data: {
      reference: PAYSTACK_REFERENCE,
      amount: 2_000,
      currency: "KES",
      status,
      gateway_response: gatewayResponse,
      paid_at: status === "success" ? new Date().toISOString() : null,
    },
  }
}
