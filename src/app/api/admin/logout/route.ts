import { NextResponse } from "next/server"
import { ADMIN_SESSION_COOKIE } from "@/lib/admin/session"

export async function POST(request: Request) {
  // Mirror login's attributes exactly (see the matching isHttps check in ../login/route.ts)
  // rather than the bare response.cookies.delete(name), which sends a Set-Cookie with none of
  // them — some browsers only treat that as clearing a previous cookie when the attributes line
  // up with how it was originally set.
  const isHttps =
    request.headers.get("x-forwarded-proto") === "https" ||
    new URL(request.url).protocol === "https:"

  const response = NextResponse.json({ ok: true })
  response.cookies.set(ADMIN_SESSION_COOKIE, "", {
    httpOnly: true,
    secure: isHttps,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  })
  return response
}
