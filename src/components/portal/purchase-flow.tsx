"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { PackageCard } from "@/components/portal/package-card"
import { PoweredBy } from "@/components/portal/powered-by"
import { readSavedPhoneNumber, saveSavedPhoneNumber } from "@/lib/saved-phone-number"
import { phoneNumberSchema } from "@/lib/schemas/phone"
import { optionalEmailSchema } from "@/lib/schemas/email"
import { sessionStatusResponseSchema } from "@/lib/schemas/session"
import type { PublicPackage } from "@/lib/schemas/package"

const POLL_INTERVAL_MS = 3_000

const WAITING_STATUSES = new Set(["PENDING", "AWAITING_PAYMENT", "PAID"])

const STATUS_COPY: Record<string, string> = {
  PENDING: "Starting…",
  AWAITING_PAYMENT: "Enter your M-Pesa PIN on your phone to finish paying.",
  PAID: "Payment received — setting up your access…",
  FAILED: "That payment didn't go through.",
  CANCELLED: "You cancelled the M-Pesa prompt.",
  TIMEOUT: "No response on your phone in time.",
}

type Step = "select" | "phone" | "waiting"

export function PurchaseFlow({
  packages,
  zoneId,
  clientIp,
  redirectUrl,
  paymentProvider,
}: {
  packages: PublicPackage[]
  zoneId: string | null
  clientIp: string | null
  redirectUrl: string | null
  paymentProvider: "mpesa" | "paystack"
}) {
  const router = useRouter()
  const [step, setStep] = useState<Step>("select")
  const [selectedId, setSelectedId] = useState<string | null>(packages[0]?.id ?? null)
  const [phoneNumber, setPhoneNumber] = useState("")
  const [phoneError, setPhoneError] = useState<string | null>(null)
  const [email, setEmail] = useState("")
  const [emailError, setEmailError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string>(STATUS_COPY.PENDING)
  const [isCheckingNow, setIsCheckingNow] = useState(false)
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  const selectedPackage = packages.find((pkg) => pkg.id === selectedId) ?? null

  useEffect(() => {
    // Reads an external system (localStorage), which isn't available during SSR — a lazy
    // useState initializer would read it during hydration too and mismatch the server markup.
    const saved = readSavedPhoneNumber()
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing from localStorage, not derived state
    if (saved) setPhoneNumber(saved)
  }, [])

  useEffect(() => {
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current)
    }
  }, [])

  async function startPayment() {
    const parsedPhone = phoneNumberSchema.safeParse(phoneNumber)
    if (!parsedPhone.success) {
      setPhoneError(parsedPhone.error.issues[0]?.message ?? "Enter a valid phone number")
      return
    }
    if (!selectedPackage) return

    const parsedEmail = optionalEmailSchema.safeParse(email)
    if (!parsedEmail.success) {
      setEmailError(parsedEmail.error.issues[0]?.message ?? "Enter a valid email")
      return
    }

    setPhoneError(null)
    setEmailError(null)
    saveSavedPhoneNumber(phoneNumber)
    setSubmitting(true)
    try {
      const response = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          packageId: selectedPackage.id,
          phoneNumber: parsedPhone.data,
          email: parsedEmail.data,
          zoneId,
          clientIp,
          redirectUrl,
        }),
      })
      const data: unknown = await response.json()
      if (!response.ok) {
        const message =
          typeof data === "object" && data && "error" in data
            ? String(data.error)
            : "Payment failed to start"
        toast.error(message)
        return
      }
      const { sessionId: newSessionId } = data as { sessionId: string }
      setSessionId(newSessionId)
      setStep("waiting")
      setStatusMessage(STATUS_COPY.AWAITING_PAYMENT)
      pollTimer.current = setInterval(() => pollStatus(newSessionId), POLL_INTERVAL_MS)
    } catch {
      toast.error("Couldn't reach the server — check your connection and try again")
    } finally {
      setSubmitting(false)
    }
  }

  async function pollStatus(id: string, options: { force?: boolean } = {}) {
    try {
      const response = await fetch(
        `/api/sessions/${id}/status${options.force ? "?force=true" : ""}`,
      )
      if (!response.ok) return
      const parsed = sessionStatusResponseSchema.safeParse(await response.json())
      if (!parsed.success) return
      const { status, resultDesc } = parsed.data

      if (status === "PROVISIONED") {
        if (pollTimer.current) clearInterval(pollTimer.current)
        router.push(`/connecting?sessionId=${id}`)
        return
      }
      if (!WAITING_STATUSES.has(status)) {
        if (pollTimer.current) clearInterval(pollTimer.current)
        setStatusMessage(resultDesc ?? STATUS_COPY[status] ?? "Something went wrong.")
        return
      }
      setStatusMessage(STATUS_COPY[status] ?? statusMessage)
    } catch {
      // Transient network hiccup — the next poll tick will retry.
    }
  }

  function tryAgain() {
    if (pollTimer.current) clearInterval(pollTimer.current)
    setSessionId(null)
    setStep("phone")
  }

  async function checkNow() {
    if (!sessionId || isCheckingNow) return
    setIsCheckingNow(true)
    try {
      await pollStatus(sessionId, { force: true })
    } finally {
      setIsCheckingNow(false)
    }
  }

  if (step === "waiting") {
    const isStillWaiting =
      statusMessage === STATUS_COPY.AWAITING_PAYMENT || statusMessage === STATUS_COPY.PAID
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <p className="text-lg">{statusMessage}</p>
        {isStillWaiting ? (
          <Button variant="outline" onClick={checkNow} disabled={isCheckingNow}>
            {isCheckingNow ? "Checking…" : "Check now"}
          </Button>
        ) : (
          <Button onClick={tryAgain}>Try again</Button>
        )}
        {sessionId ? <p className="text-muted-foreground text-xs">Reference: {sessionId}</p> : null}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div role="radiogroup" className="grid gap-3 sm:grid-cols-3">
        {packages.map((pkg) => (
          <PackageCard
            key={pkg.id}
            pkg={pkg}
            selected={pkg.id === selectedId}
            onSelect={() => setSelectedId(pkg.id)}
          />
        ))}
      </div>

      <PoweredBy provider={paymentProvider} />

      {step === "select" ? (
        <Button onClick={() => setStep("phone")} disabled={!selectedPackage} size="lg">
          Continue to payment
        </Button>
      ) : null}

      {step === "phone" && selectedPackage ? (
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => setStep("select")}
            className="text-muted-foreground w-fit text-sm underline-offset-4 hover:underline"
          >
            ← Change package
          </button>
          <Label htmlFor="phone-number">M-Pesa phone number</Label>
          <Input
            id="phone-number"
            inputMode="tel"
            placeholder="07XXXXXXXX"
            value={phoneNumber}
            onChange={(event) => setPhoneNumber(event.target.value)}
            aria-invalid={Boolean(phoneError)}
          />
          {phoneError ? <p className="text-destructive text-sm">{phoneError}</p> : null}

          <Label htmlFor="email">Email (optional)</Label>
          <Input
            id="email"
            type="email"
            inputMode="email"
            placeholder="you@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-invalid={Boolean(emailError)}
          />
          {emailError ? <p className="text-destructive text-sm">{emailError}</p> : null}

          <Button onClick={startPayment} disabled={submitting} size="lg">
            {submitting ? "Sending…" : `Pay KES ${selectedPackage.priceKes} & connect`}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
