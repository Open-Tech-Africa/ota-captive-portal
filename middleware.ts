import { NextResponse, type NextRequest } from "next/server"
import { ADMIN_SESSION_COOKIE } from "@/lib/admin/session"

// Gates /admin and /api/admin behind a single shared staff password — see docs/ADMIN.md.
// Deliberately a flat secret comparison with no hashing/sessions: a stopgap until real per-staff
// auth (better-auth) replaces this, agreed as acceptable for now.

const PUBLIC_ADMIN_PATHS = new Set(["/admin/login", "/api/admin/login"])

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  if (PUBLIC_ADMIN_PATHS.has(pathname)) return NextResponse.next()

  const sessionCookie = request.cookies.get(ADMIN_SESSION_COOKIE)?.value
  // Reads process.env directly rather than importing src/lib/env.ts's fully-validated schema —
  // this keeps middleware's Edge-runtime bundle from pulling in every other provider's env checks
  // for a single string comparison.
  if (sessionCookie && sessionCookie === process.env.ADMIN_PASSWORD) return NextResponse.next()

  if (pathname.startsWith("/api/admin")) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }
  const loginUrl = new URL("/admin/login", request.url)
  loginUrl.searchParams.set("redirectTo", pathname)
  return NextResponse.redirect(loginUrl)
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
}
