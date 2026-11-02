import "server-only"

type Bucket = { count: number; resetAt: number }

const buckets = new Map<string, Bucket>()

/**
 * Simple in-memory fixed-window rate limiter, keyed by whatever string the caller provides (a
 * phone number, an IP, ...). Resets on process restart and doesn't share state across instances —
 * fine for this single-instance deployment; a horizontally-scaled one would need a shared store
 * (Redis) instead. Stale entries are pruned lazily on their own next check, not on a timer.
 */
export function checkRateLimit(
  key: string,
  { max, windowMs }: { max: number; windowMs: number },
): boolean {
  const now = Date.now()
  const bucket = buckets.get(key)

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return true
  }

  if (bucket.count >= max) return false

  bucket.count += 1
  return true
}

/** The visitor's real IP behind Cloudflare Tunnel/proxy — falls back to a shared bucket if absent. */
export function getClientIp(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  )
}
