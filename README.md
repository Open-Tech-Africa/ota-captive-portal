# WISP Captive Portal

Self-service captive portal for a WISP (Wireless ISP) hotspot: a subscriber joins the open SSID, picks a time-based data package (hourly / daily / weekly), pays by M-Pesa STK Push, and is automatically granted internet access once payment clears.

It mirrors the stack and conventions of [`ota-energy`](../ota-energy) but swaps Drizzle for Prisma, since this app's own data model is small.

Full detail lives in `docs/`:

- [`docs/INSTALL.md`](docs/INSTALL.md) — **start here to run a new instance on a new machine**: prerequisites, getting the code onto the box, the RADIUS database user, `.env`, build/migrate/seed, troubleshooting
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — end-to-end flow, components, sequence diagram
- [`docs/MPESA-INTEGRATION.md`](docs/MPESA-INTEGRATION.md) — Daraja STK Push integration
- [`docs/PAYSTACK-INTEGRATION.md`](docs/PAYSTACK-INTEGRATION.md) — Paystack as an alternative STK Push rail (picked via `PAYMENT_PROVIDER`)
- [`docs/ADMIN.md`](docs/ADMIN.md) — `/admin` staff subscriber lookup (payments + RADIUS usage, refunds) and its deliberately minimal auth
- [`docs/RADIUS-INTEGRATION.md`](docs/RADIUS-INTEGRATION.md) — how the app shares the FreeRADIUS/daloRADIUS database and provisions access
- [`docs/OPNSENSE-SETUP.md`](docs/OPNSENSE-SETUP.md) — OPNsense captive portal + FreeRADIUS wiring

## Physical / network stack (not part of this repo, assumed already built or built alongside it)

- AP(s) broadcasting an **open SSID** (no WPA key — auth happens at the captive portal, not at L2)
- **OPNsense** as the gateway/router, with the Captive Portal plugin bound to the AP's LAN/VLAN, using a **RADIUS** authentication backend
- **FreeRADIUS 3.x** + **daloRADIUS** on Debian, installed per the [official daloRADIUS install guide](https://github.com/lirantal/daloradius/wiki/Install-daloRADIUS-on-Debian), backed by MariaDB
- This app (the captive portal splash + payment UI), reachable over the internet (needed for Safaricom's STK Push callback)

daloRADIUS itself is **not replaced** — it stays the ISP-staff tool for NAS management, operator accounts, and usage/billing reports (it reads the same `radacct` table this app's users generate). This app only adds a **customer-facing self-service layer**: pick a package, pay, get connected.

## Feature list

1. Splash page served to devices that just joined the open SSID and hit the captive portal redirect.
2. Package selection: a few **hourly / daily / weekly** plans (price + speed, configured by ISP staff, not hardcoded).
3. M-Pesa phone number entry → **STK Push** for the package price.
4. Live payment status (push sent → waiting for PIN → paid / failed / cancelled / timed out).
5. On successful payment, the app **provisions a RADIUS user** (writes to `radcheck` / `radreply` / `radusergroup` in the shared daloRADIUS database) with a session timeout matching the package duration and a bandwidth cap matching the package speed.
6. The app then **logs the client in** against OPNsense's captive portal using those freshly-provisioned credentials, so the browser is redirected straight to the internet with no extra step from the user.
7. Expired/used sessions are cleaned up (scheduled job) so RADIUS credentials aren't reusable after the package lapses.

## Stack (mirrors `ota-energy`, Prisma instead of Drizzle)

- **Next.js** (App Router, `src/`, TypeScript strict)
- **Tailwind CSS v4** + **shadcn/ui** (Radix primitives) — same design-system conventions as `ota-energy`
- **Zod** as the source of truth for types (request bodies, env, Mpesa payloads)
- **Prisma** — two schemas, two databases (see [`docs/RADIUS-INTEGRATION.md`](docs/RADIUS-INTEGRATION.md)):
  - `prisma/app` — Postgres, owned by this app (packages, sessions, M-Pesa transactions, provisioning logs). Migrations are ours.
  - `prisma/radius` — MariaDB, owned by daloRADIUS (`radcheck`, `radreply`, `radusergroup`, `radacct`, `nas`). We only ever `prisma db pull` this one — **never** `prisma migrate` against it, since daloRADIUS's own SQL files are the source of truth for that schema.
- **pnpm**, Docker + docker-compose (dev Postgres container; the radius MariaDB is the real FreeRADIUS/daloRADIUS box, not something this repo stands up)
- No `better-auth` / customer accounts — subscribers are identified by phone number only, same "no account required" philosophy as `ota-energy`'s guest checkout. An optional lightweight staff-only login can be added later if an internal packages-admin page is needed.

## Getting started (local dev, no real RADIUS DB)

```bash
cp .env.example .env   # fill in real values — see each doc under docs/ for where they come from
docker compose up -d db
pnpm install            # also runs `prisma generate` for both schemas
pnpm db:migrate         # creates this app's own tables
pnpm db:seed            # sample Hourly / Daily / Weekly packages
pnpm dev
```

Visit `http://localhost:3000` directly to exercise the splash → package → phone number flow (you won't have a real OPNsense zone in dev, so `zoneid`/`clientip`/`redirurl` will be absent — append them as query params to simulate the captive portal redirect, e.g. `?zoneid=1&redirurl=https://example.com`). M-Pesa STK Push needs real (sandbox is fine) Safaricom Daraja credentials and a publicly reachable `MPESA_CALLBACK_URL` to receive the callback — see [`docs/MPESA-INTEGRATION.md`](docs/MPESA-INTEGRATION.md). RADIUS provisioning needs a real `RADIUS_DATABASE_URL` pointed at a daloRADIUS install; without one, payments will succeed but provisioning will fail and the session will end up `FAILED` (logged in `RadiusProvisionLog`).

## Running a new instance against a real daloRADIUS install

See [`docs/INSTALL.md`](docs/INSTALL.md) for the full runbook. Short version: there's also [`docker-compose.lxc.yml`](docker-compose.lxc.yml) for running this app on the **same host** as FreeRADIUS/daloRADIUS (the recommended topology for a real site) — it uses host networking so the app reaches MariaDB on `127.0.0.1` with no bind-address changes or VPN needed. Once `RADIUS_DATABASE_URL` points at a real install, run `pnpm radius:pull` to replace the hand-written `prisma/radius/schema.prisma` with the real, introspected schema.

## Status

Running: a first real instance is deployed and verified end-to-end (splash page, Postgres migrated/seeded, RADIUS database user created with least-privilege grants, `prisma/radius/schema.prisma` corrected against the real daloRADIUS schema). Not yet exercised against real infra: an actual M-Pesa payment (sandbox credentials not wired up yet) and the OPNsense auto-login handoff (endpoint/fields need verifying against the installed OPNsense version — see `docs/OPNSENSE-SETUP.md`'s open items). No staff-facing packages admin screen yet; packages are seeded directly.
