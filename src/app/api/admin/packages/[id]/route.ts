import { NextResponse } from "next/server"
import { Prisma } from "@/generated/app-client"
import { appDb } from "@/lib/db/app"
import { packageInputSchema } from "@/lib/schemas/package"

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = packageInputSchema.partial().safeParse(await request.json())
  if (!body.success) {
    return NextResponse.json(
      { error: body.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    )
  }

  try {
    await appDb.package.update({ where: { id }, data: body.data })
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json({ error: "Package not found" }, { status: 404 })
    }
    throw error
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  try {
    await appDb.package.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json({ error: "Package not found" }, { status: 404 })
    }
    // Packages have a required (non-optional) relation to PortalSession, so Postgres restricts
    // deleting one that any subscriber has ever used — deactivating is the intended way to retire it.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      return NextResponse.json(
        { error: "Can't delete a package that has subscriber sessions — deactivate it instead" },
        { status: 409 },
      )
    }
    throw error
  }
}
