import { NextResponse } from "next/server"
import { appDb } from "@/lib/db/app"
import { packageInputSchema } from "@/lib/schemas/package"

export async function POST(request: Request) {
  const body = packageInputSchema.safeParse(await request.json())
  if (!body.success) {
    return NextResponse.json(
      { error: body.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    )
  }

  const pkg = await appDb.package.create({ data: body.data })
  return NextResponse.json({ id: pkg.id }, { status: 201 })
}
