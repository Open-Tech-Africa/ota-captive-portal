"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"

export function PackageDeleteButton({
  packageId,
  packageName,
}: {
  packageId: string
  packageName: string
}) {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)

  async function handleDelete() {
    if (!confirm(`Delete "${packageName}"? This cannot be undone.`)) return
    setSubmitting(true)
    try {
      const response = await fetch(`/api/admin/packages/${packageId}`, { method: "DELETE" })
      const data: unknown = await response.json().catch(() => null)
      if (!response.ok) {
        const message =
          typeof data === "object" && data && "error" in data
            ? String(data.error)
            : "Couldn't delete the package"
        toast.error(message)
        return
      }
      toast.success("Package deleted")
      router.refresh()
    } catch {
      toast.error("Couldn't reach the server — check your connection and try again")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Button variant="destructive" size="sm" onClick={handleDelete} disabled={submitting}>
      {submitting ? "Deleting…" : "Delete"}
    </Button>
  )
}
