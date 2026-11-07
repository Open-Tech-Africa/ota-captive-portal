# Staff admin area

`/admin` — a subscriber lookup by phone number, showing payment history (M-Pesa or Paystack,
whichever provider a given session used) next to RADIUS usage history, with a refund action for
successful Paystack payments. For ISP staff, not subscribers — nothing here is linked from the
captive portal splash page.

## Auth (deliberately minimal for now)

A single shared staff password, not per-user accounts — see `CLAUDE.md`'s note that this app has no
`better-auth`/customer-account system, and that "an optional lightweight staff-only login can be
added later" was always the expected shape of this. This is that lightweight version:

- `ADMIN_PASSWORD` env var holds the one shared password.
- `POST /api/admin/login` compares a submitted password to `ADMIN_PASSWORD` and, on match, sets an
  `httpOnly`/`secure` cookie whose **value is the password itself** — no hashing, no session store,
  no expiry beyond the cookie's own 12-hour `maxAge`.
- `middleware.ts` gates every `/admin/*` page and `/api/admin/*` route (except the login routes
  themselves) by comparing that cookie's value against `process.env.ADMIN_PASSWORD` directly
  (not the fully-validated `src/lib/env.ts` export — middleware runs on the Edge runtime, and this
  keeps its bundle from pulling in every other provider's env requirements for one string compare).

**This is a known stopgap, not a mistake** — agreed explicitly as "good enough for now." It means:
every staff member who knows the password has identical, full access, and there's no audit trail
of who did what (who issued a given refund, for instance). The moment either of those actually
matters — multiple staff needing individual accountability, or wanting to revoke one person's
access without changing the password for everyone — replace this with real per-staff auth
(`better-auth`, already used elsewhere in this workspace) rather than extending the shared-password
scheme further.

## What the lookup page shows

Enter a phone number (normalized the same way the splash page does, via
`normalizeKenyanPhoneNumber`) to see:

- **Payment history**: every `PortalSession` for that number, with its package, status, and
  whichever provider's transaction it has (`MpesaTransaction` or `PaystackTransaction` — see
  `docs/PAYSTACK-INTEGRATION.md` for why a session only ever has one or the other, fixed at
  creation time). A successful Paystack payment gets a **Refund** button
  (`POST /api/admin/paystack/refund`, wraps Paystack's `POST /refund` — see their
  [Refund API docs](https://paystack.com/docs/api/refund/)); refunding sets that transaction's
  status to `REFUNDED`. M-Pesa/Daraja payments have no refund action here — Safaricom's own
  reversal process is separate and not wired up.
- **Usage history (RADIUS)**: the subscriber's `radacct` rows (read-only, per
  `docs/RADIUS-INTEGRATION.md`) — session start/stop times, bytes down/up, terminate cause. A
  `radacct` row with no `acctstoptime` yet shows as "Currently connected."

## What's intentionally not here yet

- **Manual disconnect** (kick a currently-connected subscriber early): needs a RADIUS
  CoA/Disconnect-Request client, which `docs/RADIUS-INTEGRATION.md` already flags as a deliberate
  v2 ("add only if a hard, immediate cutoff turns out to matter in practice"), not something this
  pass builds just because the admin screen now exists to put a button on.
- **Disputes, Settlements, balance/payout views**: real Paystack API resources, scoped out of this
  first pass to keep it to the one thing staff will actually need often (did this number pay, did
  it connect, how much did it use, can I refund it) rather than rebuilding Paystack's own dashboard.
