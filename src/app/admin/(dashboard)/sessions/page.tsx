import { Suspense } from "react"
import { isOpnsenseAdminApiConfigured } from "@/lib/env"
import { listCaptivePortalSessions } from "@/lib/opnsense/admin-client"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { SessionDisconnectButton } from "@/components/admin/session-disconnect-button"

export default function AdminSessionsPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Live sessions</h1>

      {isOpnsenseAdminApiConfigured ? (
        <Suspense fallback={<p className="text-muted-foreground text-sm">Loading…</p>}>
          <SessionsTable />
        </Suspense>
      ) : (
        <p className="text-muted-foreground text-sm">
          OPNsense admin API isn&apos;t configured — set{" "}
          <code className="text-foreground">OPNSENSE_API_BASE_URL</code>,{" "}
          <code className="text-foreground">OPNSENSE_API_KEY</code>, and{" "}
          <code className="text-foreground">OPNSENSE_API_SECRET</code> to enable this page (see
          docs/OPNSENSE-SETUP.md).
        </p>
      )}
    </div>
  )
}

function formatBytes(value: number | undefined): string {
  if (value === undefined) return "—"
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function formatStartTime(value: number | undefined): string {
  if (value === undefined) return "—"
  return new Date(value * 1000).toLocaleString("en-KE", { timeZone: "Africa/Nairobi" })
}

/**
 * OPNsense being unreachable shouldn't take down the whole admin dashboard — same reasoning as the
 * RADIUS-outage handling on the subscriber lookup page (src/app/admin/(dashboard)/page.tsx).
 */
async function SessionsTable() {
  let sessions
  try {
    sessions = await listCaptivePortalSessions()
  } catch (error) {
    console.error("[admin/sessions] failed to load live sessions", error)
    return (
      <p className="text-destructive text-sm">
        Couldn&apos;t reach OPNsense — live sessions are unavailable right now.
      </p>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Phone</TableHead>
          <TableHead>IP address</TableHead>
          <TableHead>MAC address</TableHead>
          <TableHead>Connected since</TableHead>
          <TableHead>Data (down / up)</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sessions.map((session) => (
          <TableRow key={session.sessionId}>
            <TableCell className="font-medium">{session.userName}</TableCell>
            <TableCell>{session.ipAddress}</TableCell>
            <TableCell>{session.macAddress ?? "—"}</TableCell>
            <TableCell>{formatStartTime(session.startTime)}</TableCell>
            <TableCell>
              {formatBytes(session.bytes_in)} / {formatBytes(session.bytes_out)}
            </TableCell>
            <TableCell className="text-right">
              <SessionDisconnectButton sessionId={session.sessionId} label={session.userName} />
            </TableCell>
          </TableRow>
        ))}
        {sessions.length === 0 ? (
          <TableRow>
            <TableCell colSpan={6} className="text-muted-foreground py-6 text-center">
              No clients are currently connected.
            </TableCell>
          </TableRow>
        ) : null}
      </TableBody>
    </Table>
  )
}
