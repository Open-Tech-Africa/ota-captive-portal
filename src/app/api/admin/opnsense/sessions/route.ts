import { NextResponse } from "next/server"
import { isOpnsenseAdminApiConfigured } from "@/lib/env"
import { listCaptivePortalSessions } from "@/lib/opnsense/admin-client"

export async function GET() {
  if (!isOpnsenseAdminApiConfigured) {
    return NextResponse.json({ error: "OPNsense admin API isn't configured" }, { status: 501 })
  }

  try {
    const sessions = await listCaptivePortalSessions()
    return NextResponse.json({ sessions })
  } catch (error) {
    console.error("[admin/opnsense/sessions] list failed", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Couldn't reach OPNsense" },
      { status: 502 },
    )
  }
}
