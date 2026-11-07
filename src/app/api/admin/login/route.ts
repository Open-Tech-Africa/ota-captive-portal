import { NextResponse } from "next/server"
import { env } from "@/lib/env"
import { adminLoginSchema } from "@/lib/schemas/admin"
import { ADMIN_SESSION_COOKIE } from "@/lib/admin/session"

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12

export async function POST(request: Request) {
  const body = adminLoginSchema.safeParse(await request.json())
  if (!body.success) {
    return NextResponse.json({ error: "Enter the password" }, { status: 400 })
  }

  if (body.data.password !== env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: "Wrong password" }, { status: 401 })
  }

  const response = NextResponse.json({ ok: true })
  // The cookie's value is the password itself — a deliberate stopgap, see docs/ADMIN.md.
  response.cookies.set(ADMIN_SESSION_COOKIE, env.ADMIN_PASSWORD, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  })
  return response
}
