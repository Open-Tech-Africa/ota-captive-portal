import { Suspense } from "react"
import { appDb } from "@/lib/db/app"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { PackageFormDialog } from "@/components/admin/package-form-dialog"
import { PackageActiveToggle } from "@/components/admin/package-active-toggle"
import { PackageDeleteButton } from "@/components/admin/package-delete-button"
import { PACKAGE_DURATION_LABEL, type AdminPackage } from "@/lib/schemas/package"

export default function AdminPackagesPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Packages</h1>
        <PackageFormDialog mode="create" />
      </div>

      <Suspense fallback={<p className="text-muted-foreground text-sm">Loading…</p>}>
        <PackagesTable />
      </Suspense>
    </div>
  )
}

async function PackagesTable() {
  const packages = await appDb.package.findMany({ orderBy: { sortOrder: "asc" } })

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Category</TableHead>
            <TableHead>Price</TableHead>
            <TableHead>Speed</TableHead>
            <TableHead>Active</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {packages.map((pkg) => {
            const adminPkg: AdminPackage = {
              id: pkg.id,
              name: pkg.name,
              duration: pkg.duration,
              durationMinutes: pkg.durationMinutes,
              priceKes: pkg.priceKes,
              downKbps: pkg.downKbps,
              upKbps: pkg.upKbps,
              radiusGroup: pkg.radiusGroup,
              isActive: pkg.isActive,
              sortOrder: pkg.sortOrder,
            }
            return (
              <TableRow key={pkg.id}>
                <TableCell className="font-medium">{pkg.name}</TableCell>
                <TableCell>
                  <Badge variant="secondary">{PACKAGE_DURATION_LABEL[pkg.duration]}</Badge>
                </TableCell>
                <TableCell>KES {pkg.priceKes}</TableCell>
                <TableCell>
                  {(pkg.downKbps / 1000).toFixed(1)} / {(pkg.upKbps / 1000).toFixed(1)} Mbps
                </TableCell>
                <TableCell>
                  <PackageActiveToggle packageId={pkg.id} isActive={pkg.isActive} />
                </TableCell>
                <TableCell className="flex justify-end gap-2">
                  <PackageFormDialog mode="edit" pkg={adminPkg} />
                  <PackageDeleteButton packageId={pkg.id} packageName={pkg.name} />
                </TableCell>
              </TableRow>
            )
          })}
          {packages.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="text-muted-foreground py-6 text-center">
                No packages yet — create one to show it on the splash page.
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
    </>
  )
}
