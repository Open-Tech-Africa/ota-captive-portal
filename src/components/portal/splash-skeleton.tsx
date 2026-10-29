import { Skeleton } from "@/components/ui/skeleton"

export function SplashSkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Skeleton className="h-28 rounded-xl" />
      <Skeleton className="h-28 rounded-xl" />
      <Skeleton className="h-28 rounded-xl" />
    </div>
  )
}
