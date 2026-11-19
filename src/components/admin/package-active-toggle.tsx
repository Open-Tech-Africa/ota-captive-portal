"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Switch } from "@/components/ui/switch"

export function PackageActiveToggle({
  packageId,
  isActive,
}: {
  packageId: string
  isActive: boolean
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  async function handleChange(checked: boolean) {
    setPending(true)
    try {
      const response = await fetch(`/api/admin/packages/${packageId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: checked }),
      })
      if (!response.ok) {
        toast.error("Couldn't update the package")
        return
      }
      router.refresh()
    } catch {
      toast.error("Couldn't reach the server — check your connection and try again")
    } finally {
      setPending(false)
    }
  }

  return <Switch checked={isActive} disabled={pending} onCheckedChange={handleChange} />
}
