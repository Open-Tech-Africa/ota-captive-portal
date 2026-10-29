import { Wifi } from "lucide-react"

export function SiteLogo() {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="flex items-center gap-2">
        <Wifi className="text-primary size-6" />
        <span className="font-heading text-xl font-semibold tracking-tight">Mamba WiFi</span>
      </div>
      <span className="text-muted-foreground text-xs">Powered by OTA Internet</span>
    </div>
  )
}
