import { NextResponse } from "next/server"
import { isOpnsenseAdminApiConfigured } from "@/lib/env"
import { disconnectCaptivePortalSession } from "@/lib/opnsense/admin-client"

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  if (!isOpnsenseAdminApiConfigured) {
    return NextResponse.json({ error: "OPNsense admin API isn't configured" }, { status: 501 })
  }

  const { sessionId } = await params
  try {
    await disconnectCaptivePortalSession(sessionId)
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("[admin/opnsense/sessions] disconnect failed", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Couldn't disconnect that session" },
      { status: 502 },
    )
  }
}
