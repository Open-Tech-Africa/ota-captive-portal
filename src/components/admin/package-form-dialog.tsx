"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  PACKAGE_DURATION_LABEL,
  type AdminPackage,
  type PackageDuration,
} from "@/lib/schemas/package"

type FormState = {
  name: string
  duration: PackageDuration
  durationMinutes: string
  priceKes: string
  downKbps: string
  upKbps: string
  radiusGroup: string
  isActive: boolean
  sortOrder: string
}

const EMPTY_FORM: FormState = {
  name: "",
  duration: "DAILY",
  durationMinutes: "",
  priceKes: "",
  downKbps: "",
  upKbps: "",
  radiusGroup: "",
  isActive: true,
  sortOrder: "0",
}

function toFormState(pkg: AdminPackage): FormState {
  return {
    name: pkg.name,
    duration: pkg.duration,
    durationMinutes: String(pkg.durationMinutes),
    priceKes: String(pkg.priceKes),
    downKbps: String(pkg.downKbps),
    upKbps: String(pkg.upKbps),
    radiusGroup: pkg.radiusGroup ?? "",
    isActive: pkg.isActive,
    sortOrder: String(pkg.sortOrder),
  }
}

type PackageFormDialogProps = { mode: "create" } | { mode: "edit"; pkg: AdminPackage }

export function PackageFormDialog(props: PackageFormDialogProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<FormState>(
    props.mode === "edit" ? toFormState(props.pkg) : EMPTY_FORM,
  )
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  function openWithFreshState(nextOpen: boolean) {
    if (nextOpen) {
      setForm(props.mode === "edit" ? toFormState(props.pkg) : EMPTY_FORM)
      setError(null)
    }
    setOpen(nextOpen)
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const url =
        props.mode === "edit" ? `/api/admin/packages/${props.pkg.id}` : "/api/admin/packages"
      const response = await fetch(url, {
        method: props.mode === "edit" ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, radiusGroup: form.radiusGroup || null }),
      })
      const data: unknown = await response.json().catch(() => null)
      if (!response.ok) {
        const message =
          typeof data === "object" && data && "error" in data
            ? String(data.error)
            : "Couldn't save the package"
        setError(message)
        return
      }
      toast.success(props.mode === "edit" ? "Package updated" : "Package created")
      setOpen(false)
      router.refresh()
    } catch {
      setError("Couldn't reach the server — check your connection and try again")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={openWithFreshState}>
      <DialogTrigger asChild>
        {props.mode === "edit" ? (
          <Button variant="outline" size="sm">
            Edit
          </Button>
        ) : (
          <Button>New package</Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{props.mode === "edit" ? "Edit package" : "New package"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 flex flex-col gap-1.5">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                required
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="duration">Category</Label>
              <Select
                value={form.duration}
                onValueChange={(value: PackageDuration) => setForm({ ...form, duration: value })}
              >
                <SelectTrigger id="duration" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PACKAGE_DURATION_LABEL).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="durationMinutes">Grants (minutes)</Label>
              <Input
                id="durationMinutes"
                type="number"
                min={1}
                value={form.durationMinutes}
                onChange={(event) => setForm({ ...form, durationMinutes: event.target.value })}
                required
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="priceKes">Price (KES)</Label>
              <Input
                id="priceKes"
                type="number"
                min={1}
                value={form.priceKes}
                onChange={(event) => setForm({ ...form, priceKes: event.target.value })}
                required
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sortOrder">Sort order</Label>
              <Input
                id="sortOrder"
                type="number"
                value={form.sortOrder}
                onChange={(event) => setForm({ ...form, sortOrder: event.target.value })}
                required
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="downKbps">Download (Kbps)</Label>
              <Input
                id="downKbps"
                type="number"
                min={1}
                value={form.downKbps}
                onChange={(event) => setForm({ ...form, downKbps: event.target.value })}
                required
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="upKbps">Upload (Kbps)</Label>
              <Input
                id="upKbps"
                type="number"
                min={1}
                value={form.upKbps}
                onChange={(event) => setForm({ ...form, upKbps: event.target.value })}
                required
              />
            </div>

            <div className="col-span-2 flex flex-col gap-1.5">
              <Label htmlFor="radiusGroup">RADIUS group (optional)</Label>
              <Input
                id="radiusGroup"
                value={form.radiusGroup}
                onChange={(event) => setForm({ ...form, radiusGroup: event.target.value })}
              />
            </div>

            <div className="col-span-2 flex items-center justify-between rounded-lg border px-3 py-2">
              <Label htmlFor="isActive">Visible on the splash page</Label>
              <Switch
                id="isActive"
                checked={form.isActive}
                onCheckedChange={(checked) => setForm({ ...form, isActive: checked })}
              />
            </div>
          </div>

          {error ? <p className="text-destructive text-sm">{error}</p> : null}

          <DialogFooter>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
