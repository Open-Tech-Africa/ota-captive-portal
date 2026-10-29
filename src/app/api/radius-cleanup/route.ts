import { NextResponse } from "next/server"
import { env } from "@/lib/env"
import { cleanupExpiredRadiusSessions } from "@/lib/radius/cleanup"

/** Hit by an external scheduler (cron, systemd timer, ...) — see README "Scheduled cleanup". */
export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization")
  if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const result = await cleanupExpiredRadiusSessions()
  return NextResponse.json(result)
}
