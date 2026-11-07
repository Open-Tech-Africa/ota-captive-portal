"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"

export function RefundButton({ transactionId }: { transactionId: string }) {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)

  async function handleRefund() {
    if (!confirm("Refund this payment? This cannot be undone.")) return
    setSubmitting(true)
    try {
      const response = await fetch("/api/admin/paystack/refund", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactionId }),
      })
      const data: unknown = await response.json()
      if (!response.ok) {
        const message =
          typeof data === "object" && data && "error" in data ? String(data.error) : "Refund failed"
        toast.error(message)
        return
      }
      toast.success("Refund queued")
      router.refresh()
    } catch {
      toast.error("Couldn't reach the server — check your connection and try again")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Button variant="destructive" size="sm" onClick={handleRefund} disabled={submitting}>
      {submitting ? "Refunding…" : "Refund"}
    </Button>
  )
}
