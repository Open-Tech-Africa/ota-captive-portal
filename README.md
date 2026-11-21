# WISP Captive Portal

Self-service captive portal for a WISP (Wireless ISP) hotspot, built on open-source infrastructure: a subscriber joins the open SSID, picks a time-based data package (hourly / daily / weekly), pays by M-Pesa STK Push (direct Safaricom Daraja, or via Paystack as an alternative rail), and is automatically granted internet access once payment clears — no app install, no account, just a phone number.

It's designed to sit in front of an existing **OPNsense + FreeRADIUS + daloRADIUS** setup rather than replace any of it — daloRADIUS stays the ISP-staff tool for NAS management and usage/billing reports; this app only adds the customer-facing "pick a package, pay, get connected" layer in front.

Full detail lives in `docs/`:

- [`docs/INSTALL.md`](docs/INSTALL.md) — running a real instance on a real daloRADIUS/OPNsense site (the production runbook — read this once you're past the Quickstart below)
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — end-to-end flow, components, sequence diagram
- [`docs/MPESA-INTEGRATION.md`](docs/MPESA-INTEGRATION.md) — Daraja STK Push integration
- [`docs/PAYSTACK-INTEGRATION.md`](docs/PAYSTACK-INTEGRATION.md) — Paystack as an alternative STK Push rail (picked via `PAYMENT_PROVIDER`)
- [`docs/ADMIN.md`](docs/ADMIN.md) — `/admin` staff subscriber lookup (payments + RADIUS usage, refunds) and its deliberately minimal auth
- [`docs/RADIUS-INTEGRATION.md`](docs/RADIUS-INTEGRATION.md) — how the app shares the FreeRADIUS/daloRADIUS database and provisions access
- [`docs/OPNSENSE-SETUP.md`](docs/OPNSENSE-SETUP.md) — OPNsense captive portal + FreeRADIUS wiring
- [`docs/PUBLISHING.md`](docs/PUBLISHING.md) — maintainer-only: checklist for taking this repo public

## Physical / network stack (not part of this repo, assumed already built or built alongside it)

- AP(s) broadcasting an **open SSID** (no WPA key — auth happens at the captive portal, not at L2)
- **OPNsense** as the gateway/router, with the Captive Portal plugin bound to the AP's LAN/VLAN, using a **RADIUS** authentication backend
- **FreeRADIUS 3.x** + **daloRADIUS** on Debian, installed per the [official daloRADIUS install guide](https://github.com/lirantal/daloradius/wiki/Install-daloRADIUS-on-Debian), backed by MariaDB
- This app (the captive portal splash + payment UI), reachable over the internet (needed for the M-Pesa/Paystack payment callback)

You don't need any of the above to try the app itself — see **Quickstart** below.

## Feature list

1. Splash page served to devices that just joined the open SSID and hit the captive portal redirect.
2. Package selection: a few **hourly / daily / weekly** plans (price + speed, configured by ISP staff, not hardcoded).
3. Phone number entry → **M-Pesa STK Push** for the package price, via either Safaricom Daraja directly or Paystack.
4. Live payment status (push sent → waiting for PIN → paid / failed / cancelled / timed out).
5. On successful payment, the app **provisions a RADIUS user** (writes to `radcheck` / `radreply` / `radusergroup` in the shared daloRADIUS database) with a session timeout matching the package duration and a bandwidth cap matching the package speed.
6. The app then **logs the client in** against OPNsense's captive portal using those freshly-provisioned credentials, so the browser is redirected straight to the internet with no extra step from the user.
7. Expired/used sessions are cleaned up (scheduled job) so RADIUS credentials aren't reusable after the package lapses.
8. A lightweight `/admin` area for staff: look up a subscriber by phone number, see their payment and RADIUS usage history, issue a refund.

## Stack

- **Next.js** (App Router, `src/`, TypeScript strict)
- **Tailwind CSS v4** + **shadcn/ui** (Radix primitives)
- **Zod** as the source of truth for types (request bodies, env, provider payloads)
- **Prisma** — two schemas, two databases (see [`docs/RADIUS-INTEGRATION.md`](docs/RADIUS-INTEGRATION.md)):
  - `prisma/app` — Postgres, owned by this app (packages, sessions, payment transactions, provisioning logs). Migrations are ours.
  - `prisma/radius` — MariaDB, owned by daloRADIUS (`radcheck`, `radreply`, `radusergroup`, `radacct`, `nas`). We only ever `prisma db pull` this one — **never** `prisma migrate` against it, since daloRADIUS's own SQL files are the source of truth for that schema.
- **pnpm**, Docker + Docker Compose
- No customer accounts — subscribers are identified by phone number only. A lightweight shared-password staff login gates `/admin` (see [`docs/ADMIN.md`](docs/ADMIN.md)).

## Technologies used

### This app

| Technology | Role here | Docs |
|---|---|---|
| [Next.js](https://nextjs.org/) | App framework (App Router, Cache Components) | [nextjs.org/docs](https://nextjs.org/docs) |
| [React](https://react.dev/) | UI library Next.js is built on | [react.dev/reference/react](https://react.dev/reference/react) |
| [TypeScript](https://www.typescriptlang.org/) | Strict typing throughout | [typescriptlang.org/docs](https://www.typescriptlang.org/docs/) |
| [Zod](https://zod.dev/) | Runtime validation + source of truth for types (env, forms, API bodies, provider payloads) | [zod.dev](https://zod.dev/) |
| [Prisma](https://www.prisma.io/) | ORM for both Postgres and MariaDB datasources | [prisma.io/docs](https://www.prisma.io/docs) |
| [Tailwind CSS](https://tailwindcss.com/) | Styling | [tailwindcss.com/docs](https://tailwindcss.com/docs) |
| [shadcn/ui](https://ui.shadcn.com/) | UI components, built on Radix primitives | [ui.shadcn.com/docs](https://ui.shadcn.com/docs) |
| [Radix UI](https://www.radix-ui.com/) | Unstyled accessible primitives shadcn/ui wraps | [radix-ui.com/primitives/docs](https://www.radix-ui.com/primitives/docs/overview/introduction) |
| [Sonner](https://sonner.emilkowal.ski/) | Toast notifications | [sonner.emilkowal.ski](https://sonner.emilkowal.ski/) |
| [Lucide](https://lucide.dev/) | Icons | [lucide.dev/icons](https://lucide.dev/icons/) |
| [pnpm](https://pnpm.io/) | Package manager | [pnpm.io/motivation](https://pnpm.io/motivation) |
| [ESLint](https://eslint.org/) + [Prettier](https://prettier.io/) | Linting and formatting | [eslint.org/docs](https://eslint.org/docs/latest/) · [prettier.io/docs](https://prettier.io/docs/) |
| [Docker](https://www.docker.com/) / [Docker Compose](https://docs.docker.com/compose/) | Containerized dev/runtime, Postgres | [docs.docker.com](https://docs.docker.com/) |

### Payments

| Technology | Role here | Docs |
|---|---|---|
| [Safaricom Daraja](https://developer.safaricom.co.ke/) | M-Pesa STK Push, direct integration | [developer.safaricom.co.ke/APIs](https://developer.safaricom.co.ke/APIs) — see [`docs/MPESA-INTEGRATION.md`](docs/MPESA-INTEGRATION.md) |
| [Paystack](https://paystack.com/) | Alternative M-Pesa STK Push rail via their Charge API | [paystack.com/docs/api](https://paystack.com/docs/api/) — see [`docs/PAYSTACK-INTEGRATION.md`](docs/PAYSTACK-INTEGRATION.md) |

### WISP / network infrastructure (not part of this repo — see [Physical / network stack](#physical--network-stack-not-part-of-this-repo-assumed-already-built-or-built-alongside-it) above)

| Technology | Role here | Docs |
|---|---|---|
| [OPNsense](https://opnsense.org/) | Gateway/router, Captive Portal plugin | [docs.opnsense.org](https://docs.opnsense.org/) |
| [FreeRADIUS](https://freeradius.org/) | AAA server backing OPNsense's captive portal | [freeradius.org/documentation](https://freeradius.org/documentation/) |
| [daloRADIUS](https://github.com/lirantal/daloradius) | Staff web UI over the FreeRADIUS schema (NAS management, reports) | [daloRADIUS wiki](https://github.com/lirantal/daloradius/wiki) |
| [MariaDB](https://mariadb.org/) | Database engine behind FreeRADIUS/daloRADIUS (`radcheck`, `radreply`, `radacct`, …) | [mariadb.com/kb](https://mariadb.com/kb/en/documentation/) |
| [PostgreSQL](https://www.postgresql.org/) | Database engine behind this app's own data | [postgresql.org/docs](https://www.postgresql.org/docs/) |
| [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) (`cloudflared`) | Public HTTPS URL for the payment callback/webhook, with or without a domain | [Cloudflare Tunnel docs](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) |

---

## Prerequisites

To try the app (Quickstart below):

- **Docker Engine** + the **Compose plugin** (`docker compose`, not the old standalone `docker-compose`)
- **git**
- Credentials for **one** payment rail — whichever you have to hand:
  - A free [Safaricom Daraja](https://developer.safaricom.co.ke/) sandbox app (instant, no business registration), or
  - A free [Paystack](https://dashboard.paystack.com/) test account

That's it — Postgres runs in a container, and you don't need a real RADIUS/OPNsense install or a domain name to see the payment flow work end to end (see "What doesn't need real infra" below). To wire this up to an actual hotspot, you'll additionally need the setup in [`docs/INSTALL.md`](docs/INSTALL.md).

## One-command install

Only Docker is required on the host (pnpm is optional; without it the scripts read `package.json` with `jq`). Each installer runs the `docker:*` scripts from `package.json`, applies migrations, seeds packages into an empty database, and waits for the app to answer. Both are safe to re-run.

On first run (or whenever `.env` is incomplete) the installer creates `.env` with generated secrets and asks for every value the app needs: hotspot name, public URL, payment provider and its keys (Paystack, or the M-Pesa Daraja set), RADIUS database URL, OPNsense portal URL, admin password, and optionally the OPNsense admin API and Traffic Shaper interface. Press Enter to keep a value; secrets are typed hidden. Testing without WISP infrastructure? Keep the RADIUS and OPNsense placeholders. With `--tunnel`, the public URL is filled in from the tunnel automatically. Re-run with `--configure` to change values later, or `--no-prompt` for automation.

```bash
./scripts/install-dev.sh                  # dev: Postgres + hot-reload web on :3000   (pnpm install:dev)
./scripts/install-dev.sh --tunnel         # ...plus an ephemeral trycloudflare.com URL
./scripts/install-prod.sh --named-tunnel  # prod: web-prod + your named tunnel        (pnpm install:prod)
```

`install-prod.sh` refuses to start while any required `.env` var is empty or still an `.env.example` placeholder. Re-run it after `git pull` to upgrade. The manual steps below show what the scripts do.

## Quickstart (try it now, no domain needed)

```bash
git clone https://github.com/Open-Tech-Africa/ota-captive-portal.git

cd ota-captive-portal
cp .env.example .env
```

Edit `.env`:

- Fill in the `MPESA_*` vars (Daraja sandbox), **or** set `PAYMENT_PROVIDER=paystack` and fill in `PAYSTACK_SECRET_KEY` instead — whichever rail you have credentials for.
- Generate and fill in `CRON_SECRET` and `ADMIN_PASSWORD`: `openssl rand -base64 32` and `openssl rand -base64 18`.
- Leave `RADIUS_DATABASE_URL` and `OPNSENSE_*` as the placeholder values already in `.env.example` — they just need to be *present and well-formed*, not actually reachable, for the app to start.
- Leave `APP_BASE_URL`/`MPESA_CALLBACK_URL` as-is for now — you'll come back and set the real tunnel URL in step 2.

**1. Start Postgres and the app, then set up the schema:**

```bash
pnpm docker:dev            # docker:db + docker:web:build
pnpm docker:dev:migrate    # prisma migrate deploy: applies the migrations committed in prisma/app/migrations
pnpm docker:dev:seed       # default packages; fresh database only
```

> **Only seed an empty database.** The seed upserts the default packages, so re-running it overwrites any price/speed changes made in `/admin/packages`. `./scripts/install-dev.sh` checks this for you and skips the seed when packages already exist.
>
> `pnpm db:migrate` (`prisma migrate dev`) is for *creating* a new migration after you edit `prisma/app/schema.prisma` — not for setting up an instance.

Confirm it's up: `curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/` → expect `200`.

**2. Get a public HTTPS URL** (M-Pesa and Paystack both need to reach this app over the internet to deliver their payment callback/webhook — `localhost` doesn't work for either):

```bash
pnpm docker:tunnel
docker compose logs tunnel | grep trycloudflare
```

Copy the printed `https://<random>.trycloudflare.com` URL. Put it in `.env` as `APP_BASE_URL`, and as `MPESA_CALLBACK_URL` with `/api/mpesa/callback` appended, then recreate the container so it picks up the new `.env` values (`docker compose restart` doesn't reload `env_file` — only recreating the container does):

```bash
pnpm docker:web:recreate
```

If you're using Paystack, there's no per-request callback field — instead set the webhook URL in the Paystack dashboard (**Settings > API Keys & Webhooks**) to `<tunnel-url>/api/paystack/webhook`.

> This URL is random and changes every time the `tunnel` container restarts, with no access control in front of it — fine for a test session, not for anything you'll come back to later. See **"Using your own domain instead"** below for that.

**3. Try it:** open the tunnel URL in a browser. You'll see the splash page and package picker exactly as a subscriber would — pick a package, enter a phone number, and complete the STK push (use Safaricom's documented sandbox test numbers/PINs if you're on Daraja sandbox).

**4. (Optional) try the admin dashboard:** `<tunnel-url>/admin/login`, password = whatever you set `ADMIN_PASSWORD` to. Search the phone number you just paid with to see its payment history and (for Paystack) issue a refund.

### What doesn't need real infra

Everything above runs against this app's own Postgres only. Payment will succeed, but the RADIUS-provisioning step right after it will fail on purpose — `RADIUS_DATABASE_URL` is just a placeholder, so there's nothing real to write to — and the session ends up `FAILED` rather than `PROVISIONED` (the actual error is logged in the `RadiusProvisionLog` table, not swallowed). That's expected for a Quickstart run. To wire up the real network side (FreeRADIUS/daloRADIUS + OPNsense) so provisioning and auto-login actually complete, see [`docs/INSTALL.md`](docs/INSTALL.md).

> **Trying the production build instead of dev mode?** The `web` service above runs `pnpm dev` with hot reload, built from the [`Dockerfile`](Dockerfile)'s `dev` stage. There's also a `web-prod` service, built from the same Dockerfile's multi-stage `build`/`runner` stages (Next.js standalone output, no dev dependencies, runs as a non-root user) — the same image used in a real deployment (see [`docs/INSTALL.md`](docs/INSTALL.md)). To run it locally instead:
> ```bash
> pnpm docker:web:stop
> pnpm docker:web-prod:build
> ```
> Only one of `web` / `web-prod` can be up at a time (both bind port 3000) — `pnpm docker:web:stop` / `pnpm docker:web-prod:stop` stops either one.

## Using your own domain instead of the ephemeral tunnel

Once you're past "just trying it out," swap the ephemeral tunnel for a **named Cloudflare Tunnel** on a domain you control — same URL across restarts, sitting behind Cloudflare's network rather than a random public hostname. Needs a domain already added to a (free) Cloudflare account.

See [`docs/INSTALL.md`'s "Alternative: named tunnel"](docs/INSTALL.md#alternative-named-tunnel-stable-domain-no-random-restart-url) for the one-time setup walkthrough (authenticate, create the tunnel, route the subdomain, write `.cloudflared/config.yml`) — it's written for the production `web-prod` service, but for this dev Quickstart just point `config.yml`'s `service:` at `http://web:3000` instead. Once that's done:

```bash
pnpm docker:web:recreate
pnpm docker:named-tunnel
```

> **Running on the same host as FreeRADIUS/daloRADIUS** (the real-deployment topology, recommended for an actual hotspot site)? That's exactly what [`docs/INSTALL.md`](docs/INSTALL.md) walks through end to end, using the production `web-prod` service instead of the dev `web` service shown above.

## Running a new instance against a real daloRADIUS install

See [`docs/INSTALL.md`](docs/INSTALL.md) for the full runbook: deciding where this app runs relative to the RADIUS database, creating a least-privilege RADIUS database user, getting the code onto the target machine, and wiring OPNsense to redirect to it. Once `RADIUS_DATABASE_URL` points at a real install, run `pnpm radius:pull` to replace the hand-written `prisma/radius/schema.prisma` with the real, introspected schema.

## Status

A first real instance has been run end to end against a real daloRADIUS/OPNsense setup, with a live payment (both Daraja sandbox and a live Paystack charge) through to RADIUS provisioning. Not yet built: active RADIUS CoA/Disconnect (passive `Session-Timeout` + cleanup job only — see [`docs/RADIUS-INTEGRATION.md`](docs/RADIUS-INTEGRATION.md)), and per-staff admin accounts (`/admin` currently uses one shared password — see [`docs/ADMIN.md`](docs/ADMIN.md)).

## License

[MIT](LICENSE)
