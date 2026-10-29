import { cn } from "@/lib/utils"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import type { PublicPackage } from "@/lib/schemas/package"

const DURATION_LABEL: Record<PublicPackage["duration"], string> = {
  HOURLY: "Hourly",
  DAILY: "Daily",
  WEEKLY: "Weekly",
}

export function PackageCard({
  pkg,
  selected,
  onSelect,
}: {
  pkg: PublicPackage
  selected: boolean
  onSelect: () => void
}) {
  return (
    <Card
      role="radio"
      aria-checked={selected}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          onSelect()
        }
      }}
      className={cn(
        "cursor-pointer transition-colors",
        selected ? "ring-primary ring-2" : "hover:ring-foreground/20",
      )}
    >
      <CardHeader>
        <CardDescription>{DURATION_LABEL[pkg.duration]}</CardDescription>
        <CardTitle className="text-lg">{pkg.name}</CardTitle>
      </CardHeader>
      <CardContent className="flex items-baseline justify-between">
        <span className="font-heading text-2xl font-semibold">KES {pkg.priceKes}</span>
        <span className="text-muted-foreground text-sm">
          {(pkg.downKbps / 1000).toFixed(1)} Mbps
        </span>
      </CardContent>
    </Card>
  )
}
