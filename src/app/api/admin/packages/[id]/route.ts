import { NextResponse } from "next/server"
import { Prisma } from "@/generated/app-client"
import { appDb } from "@/lib/db/app"
import { isShaperConfigured } from "@/lib/env"
import { packageInputSchema } from "@/lib/schemas/package"
import { updatePackageShaperBandwidth } from "@/lib/opnsense/traffic-shaper"

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
    const pkg = await appDb.package.update({ where: { id }, data: body.data })

    // Best-effort: a package's shaper pipes (if it already has any — see
    // src/lib/opnsense/traffic-shaper.ts) are created lazily on first connect, not here, but if
    // the speed changed after that point OPNsense needs telling. Never fails the edit itself —
    // worst case the next package edit, or a staff member noticing, catches it.
    if (
      isShaperConfigured &&
      (body.data.downKbps !== undefined || body.data.upKbps !== undefined)
    ) {
      try {
        await updatePackageShaperBandwidth(pkg)
      } catch (shaperError) {
        console.error(
          `[admin/packages] failed to update shaper bandwidth for ${pkg.id}`,
          shaperError,
        )
      }
    }

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
