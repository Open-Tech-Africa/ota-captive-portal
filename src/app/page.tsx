import { Suspense } from "react"
import { SiteLogo } from "@/components/portal/site-logo"
import { SplashContent } from "@/components/portal/splash-content"
import { SplashSkeleton } from "@/components/portal/splash-skeleton"
import { VendorAttribution } from "@/components/portal/vendor-attribution"

export default function SplashPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  return (
    <>
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-8 px-4 py-12">
        <SiteLogo />

        <div className="text-center">
          <h1 className="font-heading text-2xl font-semibold">Get connected</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Pick a package and pay with M-Pesa — you&apos;ll be online in a minute.
          </p>
        </div>

        <Suspense fallback={<SplashSkeleton />}>
          <SplashContent searchParams={searchParams} />
        </Suspense>
      </main>

      <footer className="flex justify-center pb-6">
        <VendorAttribution />
      </footer>
    </>
  )
}
