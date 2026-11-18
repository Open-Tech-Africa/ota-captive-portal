import { Wifi } from "lucide-react"
import { env } from "@/lib/env"

export function SiteLogo() {
  return (
    <div className="flex items-center justify-center gap-2">
      <Wifi className="text-primary size-6" />
      <span className="font-heading text-xl font-semibold tracking-tight">{env.SITE_NAME}</span>
    </div>
  )
}
