"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"

export function SessionDisconnectButton({
  sessionId,
  label,
}: {
  sessionId: string
  label: string
}) {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)

  async function handleDisconnect() {
    if (!confirm(`Disconnect ${label} now? They'll have to re-authenticate to get back online.`))
      return
    setSubmitting(true)
    try {
      const response = await fetch(`/api/admin/opnsense/sessions/${sessionId}`, {
        method: "DELETE",
      })
      const data: unknown = await response.json().catch(() => null)
      if (!response.ok) {
        const message =
          typeof data === "object" && data && "error" in data
            ? String(data.error)
            : "Couldn't disconnect that session"
        toast.error(message)
        return
      }
      toast.success(`${label} disconnected`)
      router.refresh()
    } catch {
      toast.error("Couldn't reach the server — check your connection and try again")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Button variant="destructive" size="sm" onClick={handleDisconnect} disabled={submitting}>
      {submitting ? "Disconnecting…" : "Disconnect"}
    </Button>
  )
}
