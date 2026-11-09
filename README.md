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

---

## Prerequisites

To try the app (Quickstart below):

- **Docker Engine** + the **Compose plugin** (`docker compose`, not the old standalone `docker-compose`)
- **git**
- Credentials for **one** payment rail — whichever you have to hand:
  - A free [Safaricom Daraja](https://developer.safaricom.co.ke/) sandbox app (instant, no business registration), or
  - A free [Paystack](https://dashboard.paystack.com/) test account

That's it — Postgres runs in a container, and you don't need a real RADIUS/OPNsense install or a domain name to see the payment flow work end to end (see "What doesn't need real infra" below). To wire this up to an actual hotspot, you'll additionally need the setup in [`docs/INSTALL.md`](docs/INSTALL.md).

## Quickstart (try it now, no domain needed)

```bash
git clone https://github.com/<your-fork-or-org>/ota-captive-portal.git
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
docker compose up -d db
docker compose up -d --build web
docker compose exec -T web pnpm db:migrate --name init
docker compose exec -T web pnpm db:seed
```

Confirm it's up: `curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/` → expect `200`.

**2. Get a public HTTPS URL** (M-Pesa and Paystack both need to reach this app over the internet to deliver their payment callback/webhook — `localhost` doesn't work for either):

```bash
docker compose --profile tunnel up -d
docker compose logs tunnel | grep trycloudflare
```

Copy the printed `https://<random>.trycloudflare.com` URL. Put it in `.env` as `APP_BASE_URL`, and as `MPESA_CALLBACK_URL` with `/api/mpesa/callback` appended, then:

```bash
docker compose up -d --force-recreate web
```

If you're using Paystack, there's no per-request callback field — instead set the webhook URL in the Paystack dashboard (**Settings > API Keys & Webhooks**) to `<tunnel-url>/api/paystack/webhook`.

> This URL is random and changes every time the `tunnel` container restarts, with no access control in front of it — fine for a test session, not for anything you'll come back to later. See **"Using your own domain instead"** below for that.

**3. Try it:** open the tunnel URL in a browser. You'll see the splash page and package picker exactly as a subscriber would — pick a package, enter a phone number, and complete the STK push (use Safaricom's documented sandbox test numbers/PINs if you're on Daraja sandbox).

**4. (Optional) try the admin dashboard:** `<tunnel-url>/admin/login`, password = whatever you set `ADMIN_PASSWORD` to. Search the phone number you just paid with to see its payment history and (for Paystack) issue a refund.

### What doesn't need real infra

Everything above runs against this app's own Postgres only. Payment will succeed, but the RADIUS-provisioning step right after it will fail on purpose — `RADIUS_DATABASE_URL` is just a placeholder, so there's nothing real to write to — and the session ends up `FAILED` rather than `PROVISIONED` (the actual error is logged in the `RadiusProvisionLog` table, not swallowed). That's expected for a Quickstart run. To wire up the real network side (FreeRADIUS/daloRADIUS + OPNsense) so provisioning and auto-login actually complete, see [`docs/INSTALL.md`](docs/INSTALL.md).

## Using your own domain instead of the ephemeral tunnel

Once you're past "just trying it out," swap the ephemeral tunnel for a **named Cloudflare Tunnel** on a domain you control — same URL across restarts, sitting behind Cloudflare's network rather than a random public hostname. Needs a domain already added to a (free) Cloudflare account.

```bash
mkdir -p .cloudflared

# 1. Authenticate — opens a URL; approve it against the Cloudflare account that manages your domain
docker run --rm -v "$(pwd)/.cloudflared:/home/nonroot/.cloudflared" cloudflare/cloudflared:latest tunnel login

# 2. Create the tunnel (any name)
docker run --rm -v "$(pwd)/.cloudflared:/home/nonroot/.cloudflared" cloudflare/cloudflared:latest tunnel create wisp-portal

# 3. Route your subdomain to it — adds the DNS record for you
docker run --rm -v "$(pwd)/.cloudflared:/home/nonroot/.cloudflared" cloudflare/cloudflared:latest \
  tunnel route dns wisp-portal portal.yourdomain.com
```

Write `.cloudflared/config.yml` (the tunnel ID/credentials filename come from step 2's output):

```yaml
tunnel: <tunnel-id>
credentials-file: /home/nonroot/.cloudflared/<tunnel-id>.json

ingress:
  - hostname: portal.yourdomain.com
    service: http://web:3000
  - service: http_status:404
```

Set `APP_BASE_URL` and `MPESA_CALLBACK_URL` in `.env` to `https://portal.yourdomain.com` (and `.../api/mpesa/callback` for the latter), then:

```bash
docker compose up -d --force-recreate web
docker compose --profile named-tunnel up -d
```

`.cloudflared/` is gitignored — it holds real credentials; set it up fresh per deployment, never commit it.

> **Running on the same host as FreeRADIUS/daloRADIUS** (the real-deployment topology, recommended for an actual hotspot site)? Use [`docker-compose.lxc.yml`](docker-compose.lxc.yml) instead, which host-networks everything so the app can reach MariaDB on `127.0.0.1`. See [`docs/INSTALL.md`](docs/INSTALL.md) for that full runbook, including this same named-tunnel setup adapted for host networking (`service: http://localhost:3000` instead of `http://web:3000`).

## Running a new instance against a real daloRADIUS install

See [`docs/INSTALL.md`](docs/INSTALL.md) for the full runbook: deciding where this app runs relative to the RADIUS database, creating a least-privilege RADIUS database user, getting the code onto the target machine, and wiring OPNsense to redirect to it. Once `RADIUS_DATABASE_URL` points at a real install, run `pnpm radius:pull` to replace the hand-written `prisma/radius/schema.prisma` with the real, introspected schema.

## Status

A first real instance has been run end to end against a real daloRADIUS/OPNsense setup, with a live payment (both Daraja sandbox and a live Paystack charge) through to RADIUS provisioning. Not yet built: active RADIUS CoA/Disconnect (passive `Session-Timeout` + cleanup job only — see [`docs/RADIUS-INTEGRATION.md`](docs/RADIUS-INTEGRATION.md)), and per-staff admin accounts (`/admin` currently uses one shared password — see [`docs/ADMIN.md`](docs/ADMIN.md)).
