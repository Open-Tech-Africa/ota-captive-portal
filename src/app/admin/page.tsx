import { Suspense } from "react"
import { appDb } from "@/lib/db/app"
import { radiusDb } from "@/lib/db/radius"
import { normalizeKenyanPhoneNumber } from "@/lib/schemas/phone"
import { LogoutButton } from "@/components/admin/logout-button"
import { RefundButton } from "@/components/admin/refund-button"

const RADACCT_HISTORY_LIMIT = 20

export default function AdminPage({ searchParams }: { searchParams: Promise<{ phone?: string }> }) {
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Subscriber lookup</h1>
        <LogoutButton />
      </div>

      <Suspense fallback={<p className="text-muted-foreground text-sm">Loading…</p>}>
        <SubscriberLookup searchParams={searchParams} />
      </Suspense>
    </div>
  )
}

function formatBytes(value: bigint | number | null): string {
  if (value === null) return "—"
  const bytes = Number(value)
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(value: Date | null): string {
  return value ? value.toLocaleString("en-KE", { timeZone: "Africa/Nairobi" }) : "—"
}

async function SubscriberLookup({ searchParams }: { searchParams: Promise<{ phone?: string }> }) {
  const { phone: rawPhone } = await searchParams
  const phone = rawPhone ? normalizeKenyanPhoneNumber(rawPhone) : null

  const sessions = phone
    ? await appDb.portalSession.findMany({
        where: { phoneNumber: phone },
        include: { package: true, transaction: true, paystackTransaction: true },
        orderBy: { createdAt: "desc" },
      })
    : []

  const usageHistory = phone
    ? await radiusDb.radacct.findMany({
        where: { username: phone },
        orderBy: { acctstarttime: "desc" },
        take: RADACCT_HISTORY_LIMIT,
      })
    : []

  // All-time total across every session this subscriber has ever had, not just the recent
  // history above — usernames are stable per phone number (see docs/RADIUS-INTEGRATION.md's
  // "Tracking returning subscribers"), so every radacct row for this phone belongs to them.
  const usageTotal = phone
    ? await radiusDb.radacct.aggregate({
        where: { username: phone },
        _sum: { acctinputoctets: true, acctoutputoctets: true },
      })
    : null

  const activeSession = usageHistory.find((row) => row.acctstoptime === null) ?? null

  return (
    <>
      <form action="/admin" method="GET" className="flex gap-2">
        <input
          type="text"
          name="phone"
          defaultValue={rawPhone ?? ""}
          placeholder="07XXXXXXXX"
          className="border-border bg-background flex-1 rounded-lg border px-3 py-2 text-sm"
        />
        <button
          type="submit"
          className="bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-medium"
        >
          Search
        </button>
      </form>

      {rawPhone && !phone ? (
        <p className="text-destructive text-sm">That doesn&apos;t look like a Safaricom number.</p>
      ) : null}

      {phone ? (
        <>
          {activeSession ? (
            <div className="rounded-lg border border-green-600/30 bg-green-600/10 px-4 py-3 text-sm">
              Currently connected — session started {formatDate(activeSession.acctstarttime)}
            </div>
          ) : null}

          <section className="flex flex-col gap-2">
            <h2 className="text-muted-foreground text-sm font-medium">Payment history</h2>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-border border-b text-left">
                  <th className="py-2">Package</th>
                  <th className="py-2">Status</th>
                  <th className="py-2">Provider</th>
                  <th className="py-2">When</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((session) => (
                  <tr key={session.id} className="border-border/50 border-b">
                    <td className="py-2">{session.package.name}</td>
                    <td className="py-2">{session.status}</td>
                    <td className="py-2">
                      {session.paystackTransaction
                        ? `Paystack (${session.paystackTransaction.status})`
                        : session.transaction
                          ? `M-Pesa (${session.transaction.status})`
                          : "—"}
                    </td>
                    <td className="py-2">{formatDate(session.createdAt)}</td>
                    <td className="py-2">
                      {session.paystackTransaction?.status === "SUCCESS" ? (
                        <RefundButton transactionId={session.paystackTransaction.id} />
                      ) : null}
                    </td>
                  </tr>
                ))}
                {sessions.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-muted-foreground py-4 text-center">
                      No payment history for this number.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </section>

          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h2 className="text-muted-foreground text-sm font-medium">Usage history (RADIUS)</h2>
              {usageTotal ? (
                <p className="text-muted-foreground text-sm">
                  All-time total: {formatBytes(usageTotal._sum.acctoutputoctets)} down /{" "}
                  {formatBytes(usageTotal._sum.acctinputoctets)} up
                </p>
              ) : null}
            </div>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-border border-b text-left">
                  <th className="py-2">Started</th>
                  <th className="py-2">Stopped</th>
                  <th className="py-2">Down / Up</th>
                  <th className="py-2">Terminate cause</th>
                </tr>
              </thead>
              <tbody>
                {usageHistory.map((row) => (
                  <tr key={row.radacctid.toString()} className="border-border/50 border-b">
                    <td className="py-2">{formatDate(row.acctstarttime)}</td>
                    <td className="py-2">{formatDate(row.acctstoptime)}</td>
                    <td className="py-2">
                      {formatBytes(row.acctoutputoctets)} / {formatBytes(row.acctinputoctets)}
                    </td>
                    <td className="py-2">{row.acctterminatecause || "—"}</td>
                  </tr>
                ))}
                {usageHistory.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="text-muted-foreground py-4 text-center">
                      No RADIUS accounting data for this number.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </section>
        </>
      ) : null}
    </>
  )
}
