import { appDb } from "@/lib/db/app"
import { env } from "@/lib/env"
import { PurchaseFlow } from "@/components/portal/purchase-flow"
import type { PublicPackage } from "@/lib/schemas/package"

function firstValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

export async function SplashContent({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const zoneId = firstValue(params.zoneid)
  const clientIp = firstValue(params.clientip)
  const redirectUrl = firstValue(params.redirurl)

  const packages = await appDb.package.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
  })

  const publicPackages: PublicPackage[] = packages.map((pkg) => ({
    id: pkg.id,
    name: pkg.name,
    duration: pkg.duration,
    durationMinutes: pkg.durationMinutes,
    priceKes: pkg.priceKes,
    downKbps: pkg.downKbps,
    upKbps: pkg.upKbps,
  }))

  if (publicPackages.length === 0) {
    return (
      <p className="text-muted-foreground text-center">
        No packages are available right now. Please check back shortly.
      </p>
    )
  }

  return (
    <PurchaseFlow
      packages={publicPackages}
      zoneId={zoneId}
      clientIp={clientIp}
      redirectUrl={redirectUrl}
      paymentProvider={env.PAYMENT_PROVIDER}
    />
  )
}
