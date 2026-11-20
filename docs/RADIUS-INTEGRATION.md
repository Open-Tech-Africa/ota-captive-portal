# Sharing the daloRADIUS database

Your instinct is right: the cleanest way to grant access after payment is to write directly into the same database FreeRADIUS reads from, using the schema daloRADIUS already installed. This app does **not** reimplement AAA — it just inserts the rows FreeRADIUS expects, the same way daloRADIUS's own "Users" admin screen would.

## Tables this app touches (from the daloRADIUS install)

Per the [daloRADIUS Debian install guide](https://github.com/lirantal/daloradius/wiki/Install-daloRADIUS-on-Debian), the schema is loaded in this order: `fr3-mariadb-freeradius.sql` → `mariadb-daloradius.sql` → `mariadb-daloradius-dictionaries.sql` → migrations. The FreeRADIUS core tables we need:

| Table | Purpose | This app's usage |
|---|---|---|
| `radcheck` | Per-user auth attributes (e.g. `Cleartext-Password`) | **Write**: one row per provisioned session, `username` / `Cleartext-Password` / `value` |
| `radreply` | Per-user reply attributes returned on Access-Accept | **Write**: `Session-Timeout` (seconds, = package duration) + a bandwidth attribute matching the AP/router vendor (e.g. `Mikrotik-Rate-Limit` for MikroTik APs, or `WISPr-Bandwidth-Max-Down`/`Max-Up` if the NAS honors WISPr) |
| `radusergroup` | Optional group membership, lets daloRADIUS reports bucket by package type | **Write** (optional): `groupname` = package slug, e.g. `pkg-daily` |
| `radacct` | Accounting: session start/stop, bytes in/out | **Read-only**, but load-bearing — see [below](#radacct-and-package-expiry). FreeRADIUS only writes these if the OPNsense captive portal zone has accounting enabled (ports 1812/1813, see `docs/OPNSENSE-SETUP.md`) |
| `nas` | Registered RADIUS clients (OPNsense's portal interface) | **Read-only** from the app's side — this row is added once in daloRADIUS (`Management > NAS`) when wiring OPNsense, not per-subscriber |

We never touch daloRADIUS's own tables (`operators`, `userinfo`, billing plans UI tables, etc.) — those stay exactly as daloRADIUS's install left them, for ISP staff to use through the daloRADIUS web UI.

## Why two Prisma schemas instead of one

Prisma's `schema.prisma` supports exactly one `datasource` block. This app genuinely has two unrelated databases with two different migration owners:

```
prisma/
  app/
    schema.prisma     # Postgres — our models, our migrations (`prisma migrate dev`)
  radius/
    schema.prisma      # MariaDB — daloRADIUS's tables, introspected (`prisma db pull`), never migrated by us
```

Two generated clients (`@prisma/client` output paths configured per schema, e.g. `src/generated/app-client` and `src/generated/radius-client`), imported from two small wrapper modules (`src/lib/db/app.ts`, `src/lib/db/radius.ts`). This is still "simple" in the sense that matters for choosing Prisma over Drizzle: no manual SQL migration files to hand-write, full type safety on both sides, and `prisma db pull` keeps the radius-side types in sync automatically whenever daloRADIUS's own migrations change the schema.

**Alternative considered**: skip Prisma entirely for the radius side and use a thin `mysql2` pool with 3–4 hand-written parameterized queries (insert/delete on `radcheck`/`radreply`/`radusergroup`). Simpler dependency-wise, but loses type safety and autocomplete on a schema that does change (daloRADIUS ships migrations). Recommendation: start with the introspected Prisma client; fall back to raw `mysql2` only if `prisma db pull` proves awkward against the live schema (e.g. due to composite-key quirks in `radcheck`).

`RADIUS_DATABASE_URL` (separate from the app's `DATABASE_URL`) points at the MariaDB instance the daloRADIUS install created, e.g.:

```
RADIUS_DATABASE_URL=mysql://raduser:radpass@radius-host:3306/raddb
```

The app's own Postgres `DATABASE_URL` is unrelated and never shared with FreeRADIUS.

## Tracking returning subscribers

A fully random RADIUS username per paid session (one early option) would mean every visit from the same subscriber creates an unrelated identity in `radcheck`/`radacct` — daloRADIUS's own reports, and this app, would have no way to see "this phone number has connected 12 times" from the RADIUS side.

Instead: **the RADIUS username is the subscriber's normalized phone number** (`2547XXXXXXXX`), stable across every visit. Only the **password** is random and rotated per paid session:

- `radacct` then naturally accumulates every session under one `username` per subscriber, so daloRADIUS's existing accounting/usage screens already answer "has this subscriber been here before, and how much have they used" with zero extra work.
- Each new payment **replaces** that phone number's `radcheck`/`radreply`/`radusergroup` rows (delete, then insert fresh ones) rather than adding more — so there's exactly one active credential per phone number at a time, with a freshly generated, single-use password and new session attributes (duration, bandwidth) for the package just paid for.
- A known username isn't a weakness by itself — same as any login system, the secret is the password. The password is random, used exactly once by the auto-login step below, and short-lived by `Session-Timeout` plus the cleanup job.
- Separate from RADIUS entirely: this app's own `PortalSession`/`MpesaTransaction` rows are already keyed by `phoneNumber` in the app's Postgres database, so business-level "returning customer" questions (receipts, support lookups, future loyalty logic) are answered there regardless of what RADIUS holds.

## Provisioning on payment success

```ts
// src/lib/radius/provision.ts (sketch)
// sessionTimeoutSeconds is caller-supplied, not derived from pkg here — see "Re-login without
// re-paying" below for why a reconnect passes something other than the package's full duration.
async function provisionRadiusAccess(
  session: PortalSession,
  pkg: Package,
  sessionTimeoutSeconds: number,
) {
  const username = session.phoneNumber // stable identity — see "Tracking returning subscribers" above
  const password = generateRadiusPassword() // random, single-use per paid session

  // Replace any credentials left over from a previous paid session for this subscriber.
  await radiusDb.radcheck.deleteMany({ where: { username } })
  await radiusDb.radreply.deleteMany({ where: { username } })
  await radiusDb.radusergroup.deleteMany({ where: { username } })

  await radiusDb.radcheck.create({
    data: { username, attribute: "Cleartext-Password", op: ":=", value: password },
  })
  await radiusDb.radreply.create({
    data: { username, attribute: "Session-Timeout", op: ":=", value: String(sessionTimeoutSeconds) },
  })
  // No bandwidth radreply attribute here — OPNsense's captive portal doesn't read one, under any
  // dictionary. Package speed is enforced via OPNsense's Traffic Shaper API instead — see
  // docs/OPNSENSE-SETUP.md#8-traffic-shaper-per-package-speed-limits.
  if (pkg.radiusGroup) {
    await radiusDb.radusergroup.create({
      data: { username, groupname: pkg.radiusGroup, priority: 1 },
    })
  }

  return { username, password }
}
```

Wrap the delete-then-insert sequence in a transaction where the driver supports it; on partial failure, roll back and mark `PortalSession.status = FAILED` with the error recorded in `RadiusProvisionLog` rather than leaving a half-provisioned user.

After provisioning, the password is used exactly once, client-side, to auto-submit OPNsense's captive portal logon form (see [`OPNSENSE-SETUP.md`](OPNSENSE-SETUP.md)) — it's never displayed to the subscriber and never reused once that form submits.

## Re-login without re-paying

A subscriber with unexpired paid access can get bounced back to the splash page without their time actually running out — an OPNsense idle timeout, the zone's session state getting cleared, a new device/MAC, etc. `POST /api/sessions` checks for this before charging anything: if the phone number already has a `PortalSession` with `status: PROVISIONED` and `expiresAt` still in the future, it reconnects them on that instead of creating a new paid session — whichever package they clicked this time is irrelevant to this path.

Reconnecting still calls [`provisionRadiusAccess`](../src/lib/radius/provision.ts), rotating the password same as a fresh payment (the old one was already cleared after its one-time read, so it can't be reused directly) — but passing the **time actually remaining** (`expiresAt - now`) as `Session-Timeout`, not the package's full duration. Otherwise every reconnect would hand out another full grant on top of whatever was left, extending total paid time for free. The existing `PortalSession` row (and its original `expiresAt`) is left alone; only `radiusUsername`/`radiusPasswordOneTime` are updated, and the response's `status` is already `PROVISIONED` so the splash page skips straight to `/connecting` instead of asking for an M-Pesa PIN. If re-provisioning itself fails, the request falls through to a normal paid session rather than leaving the subscriber stuck.

## `radacct` and package expiry

`Session-Timeout` in `radreply` tells FreeRADIUS the *maximum* length of a session counted from when the NAS opens it — but this app doesn't control when that is. With accounting enabled on the OPNsense portal zone, FreeRADIUS writes an `Acct-Start` row to `radacct` the moment the client's session actually begins, and `radacct.acctstarttime` (plus `acctinputoctets`/`acctoutputoctets` as it updates) is the real source of truth for "how far into this hourly/daily/weekly pass is this subscriber." Read `radacct` (keyed on `radiusUsername`) rather than assuming the pass started at the moment this app provisioned `radcheck` — a subscriber might pay and not actually connect for several minutes.

## Enforcing expiry: passive vs. active (open design question)

Two ways to cut a subscriber off once their package time is up, not mutually exclusive:

1. **Passive (`Session-Timeout`/`Expiration` in `radcheck`/`radreply`)**: FreeRADIUS simply won't re-authenticate the session past the timeout, and `Expiration` can hard-block the `radcheck` row after a given date. Works with the cleanup job below but only takes effect at the NAS's own re-auth/accounting-interim cadence — there can be a lag between "package expired" and "connection actually dropped."
2. **Active (RADIUS CoA / Disconnect-Request)**: the app itself sends a Disconnect-Request (or CoA-Request to adjust bandwidth mid-session) to OPNsense the moment a package's time is up, using the session identifiers from the live `radacct` row (`Acct-Session-Id`, NAS IP). OPNsense's captive portal does support CoA/Disconnect from FreeRADIUS. This needs a CoA client in the app — the simplest option is shelling out to `radclient`/`radius-coa`-style tooling (FreeRADIUS's own CLI utilities) rather than hand-rolling the RADIUS wire protocol, pointed at OPNsense's NAS IP with the same shared secret from the `nas` table.

**Recommendation**: start with passive enforcement (`Session-Timeout` sized to the package, plus the cleanup job removing `radcheck`/`radreply` rows after expiry so a lapsed login can't quietly keep working) since it needs no new network client in the app. Add active CoA/Disconnect only if a hard, immediate cutoff turns out to matter in practice (e.g. subscribers noticing a few extra free minutes) — note it here as a deliberate v2, not an oversight.

**A manual, staff-initiated version of "active" exists today**, but it's a different thing from what this section is about: `/admin/sessions` (`docs/ADMIN.md`) lets staff force-disconnect a client right now, via OPNsense's own Captive Portal API (`POST /api/captiveportal/session/disconnect`, see `docs/OPNSENSE-SETUP.md#7-admin-api-live-sessions--force-disconnect`) rather than a RADIUS CoA/Disconnect-Request. It's simpler than the `radclient`-based approach above (no RADIUS wire protocol, no shared secret — just an HTTPS call with an API key), but nothing calls it automatically at expiry — it only fires when a staff member clicks the button. If active *automatic* enforcement is ever built, reusing this same OPNsense-API call instead of a RADIUS CoA client is worth considering first, since it's already wired up and tested.

## Cleanup

`Session-Timeout` caps how long a given RADIUS session can stay connected, but the `radcheck`/`radreply`/`radusergroup` rows themselves persist until deleted — leaving them around lets the same generated credentials authenticate again for free after the package "expires" if the subscriber kept the auto-filled form. Run a scheduled job (cron, or a Next.js route hit by an external scheduler):

1. Find `PortalSession`s where `expiresAt < now() - gracePeriod` and `status = PROVISIONED`.
2. Delete the matching `radcheck` / `radreply` / `radusergroup` rows for that `radiusUsername` (the subscriber's phone number) — **only if** this is still the subscriber's most recent session (compare `PortalSession.id` to the latest `PROVISIONED` session for that phone number). Since usernames are now stable per phone number, a subscriber who pays again before an older session's grace period elapses must not have their brand-new credentials deleted by the stale job run.
3. Mark the session `EXPIRED`.

This also keeps the shared MariaDB tables from accumulating stale rows over time — important since daloRADIUS staff browse these same tables.
