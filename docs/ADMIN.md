# Staff admin area

Two pages behind one staff login, linked by a shared nav (`src/components/admin/admin-nav.tsx`,
rendered from `src/app/admin/(dashboard)/layout.tsx` — the route group keeps `/admin/login` outside
the nav/logout chrome):

- **`/admin`** — subscriber lookup by phone number.
- **`/admin/packages`** — package management (see below).
- **`/admin/sessions`** — live OPNsense captive-portal sessions + force disconnect (see below).

For ISP staff, not subscribers — nothing here is linked from the captive portal splash page.

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

## Package management (`/admin/packages`)

Create, edit, deactivate, and delete `Package` rows — previously only possible by writing directly
to Postgres (roadmap item 3 in `CLAUDE.md`). The splash page only ever shows packages where
`isActive` is true (`src/components/portal/splash-content.tsx`), ordered by `sortOrder`.

- **Active toggle**: flips `isActive` without opening the edit dialog — the quick way to hide a
  package from the splash page without losing its configuration or its payment history.
- **Delete**: a hard `DELETE`. `Package.sessions` is a required relation, so Postgres rejects
  deleting a package that any `PortalSession` has ever referenced (`POST .../packages/[id]` returns
  409 for that case) — **deactivate instead of delete** once a package has ever been sold. Delete is
  only for packages created by mistake, never used.
- **Download/upload speed** (`downKbps`/`upKbps`) isn't a RADIUS attribute — OPNsense's captive
  portal doesn't read one, under any dictionary (see
  `docs/OPNSENSE-SETUP.md#8-traffic-shaper-per-package-speed-limits`). It's enforced via OPNsense's
  Traffic Shaper API instead, wired up automatically; nothing to configure on this screen beyond
  the numbers themselves.

## Live sessions (`/admin/sessions`)

Shows every client OPNsense's captive portal currently has `AUTHORIZED`, read via its REST API
(`GET /api/captiveportal/session/list/<zoneid>/`) — not `radacct`, so it reflects OPNsense's own
session state even if a `radacct` row is stale or FreeRADIUS accounting lags. Requires
`OPNSENSE_API_BASE_URL`/`OPNSENSE_API_KEY`/`OPNSENSE_API_SECRET` (see
`docs/OPNSENSE-SETUP.md#7-admin-api-live-sessions--force-disconnect`); the page shows a
"not configured" message instead of erroring when they're unset, same shape as the RADIUS-outage
handling on the subscriber lookup page.

- **Disconnect**: `POST /api/captiveportal/session/disconnect/<zoneid>/`, keyed by OPNsense's own
  `sessionId` (not the phone number or `radacct`'s `Acct-Session-Id`). Kicks the client off
  immediately; they have to re-authenticate through the splash page to get back online. This is a
  **manual, staff-initiated kick** — it does not touch `radcheck`/`radreply`, and nothing calls it
  automatically. It is *not* the automatic expiry enforcement discussed in
  `docs/RADIUS-INTEGRATION.md#enforcing-expiry-passive-vs-active-open-design-question`, which
  remains an open design question — this just gives staff a manual tool for the "kick this person
  off right now" case (abuse, device sharing, a support call), independent of whether their package
  has actually expired.

## What's intentionally not here yet

- **Automatic CoA/Disconnect enforcement at package expiry**: still an open design question — see
  `docs/RADIUS-INTEGRATION.md`'s "Enforcing expiry: passive vs. active" section. The manual
  disconnect button above is a different thing (staff-initiated, not expiry-triggered), though it
  could be reused as the mechanism if active enforcement is ever built.
- **Disputes, Settlements, balance/payout views**: real Paystack API resources, scoped out of this
  first pass to keep it to the one thing staff will actually need often (did this number pay, did
  it connect, how much did it use, can I refund it) rather than rebuilding Paystack's own dashboard.
