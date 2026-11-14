# Installing a new instance

A runbook for getting this app running on a new machine or a new hotspot site. If your situation
differs from what's written here, the principles still apply; adjust the specific commands.

> Just want to try the app, without a real RADIUS/OPNsense install? See the [README's Quickstart](../README.md#quickstart-try-it-now-no-domain-needed) instead — this doc is for wiring up an actual hotspot site.

## 1. Decide where it runs, relative to the RADIUS database

This is the one decision that changes a couple of env values later. Pick one:

- **A — Same host as FreeRADIUS/daloRADIUS** (recommended for a real WISP site). The app reaches
  MariaDB via `host.docker.internal` (the `web`/`web-prod` services already map that hostname to
  the host machine — see [`docker-compose.yml`](../docker-compose.yml)), no VPN, no exposing the DB
  port to anything beyond this one machine. This needs two things true on the RADIUS box that
  aren't the case by default on a lot of hardened installs:
  - MariaDB's `bind-address` (in `my.cnf`/`mariadb.conf.d/`) must accept connections from something
    other than `127.0.0.1` — either `0.0.0.0` (then firewall port 3306 to only the Docker bridge
    subnet, see §5) or the specific address Docker's bridge network uses on this host.
  - The RADIUS database user (§5) must be granted from that same reachable range, not just
    `127.0.0.1`/`localhost`.
- **B — A different host from FreeRADIUS/daloRADIUS.** You need a VPN (WireGuard) or SSH tunnel
  from wherever the app runs into the RADIUS DB's network, or you expose MariaDB's port and
  firewall it tightly (not recommended). Point `RADIUS_DATABASE_URL` at the tunnel/VPN address
  instead of `host.docker.internal`. See [`RADIUS-INTEGRATION.md`](RADIUS-INTEGRATION.md).

Everything below assumes **A** unless noted — it's the same [`docker-compose.yml`](../docker-compose.yml) either way, just a different `RADIUS_DATABASE_URL` value.

## 2. Prerequisites on the target machine

- Docker Engine + the `docker compose` plugin (not the old standalone `docker-compose`).
- `git` (to clone the repo in §3).
- **The first `docker compose build` needs to pull base images** (`node:22-alpine`,
  `postgres:17-alpine`) and `pnpm install` needs the npm registry. If the target machine sits on a
  network with no general internet access (e.g. a hotspot's own walled-off VLAN, deliberately cut
  off from the internet the same way subscriber devices are), get it temporary outbound access for
  this one step — a second NIC on a network that has internet, a temporary route, whatever's
  easiest for your setup — then do the Docker install and first build, then remove or keep that
  access depending on how often you expect to rebuild.

Install Docker if it's missing:

```bash
curl -fsSL https://get.docker.com | sh
```

## 3. Get the code onto the machine

```bash
git clone https://github.com/<your-fork-or-org>/ota-captive-portal.git
cd ota-captive-portal
```

## 4. Create the RADIUS database user

Don't reuse daloRADIUS's own `raduser` or `root` — create a dedicated, least-privilege user for
this app, scoped to exactly the tables it touches (see [`RADIUS-INTEGRATION.md`](RADIUS-INTEGRATION.md)):

```sql
CREATE USER IF NOT EXISTS 'wispportal'@'%' IDENTIFIED BY '<generate with: openssl rand -base64 24>';
GRANT SELECT, INSERT, UPDATE, DELETE ON raddb.radcheck      TO 'wispportal'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON raddb.radreply      TO 'wispportal'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON raddb.radusergroup  TO 'wispportal'@'%';
GRANT SELECT ON raddb.radacct TO 'wispportal'@'%';
GRANT SELECT ON raddb.nas     TO 'wispportal'@'%';
FLUSH PRIVILEGES;
```

`@'%'` rather than `@'127.0.0.1'` — for topology A (§1) the container reaches MariaDB over Docker's
bridge network, not loopback, so this user needs to be reachable from there. Lock this down with
your **firewall** instead of MySQL's host-matching: allow port 3306 only from Docker's bridge
subnet (find it with `docker network inspect <project>_default --format '{{(index .IPAM.Config 0).Subnet}}'`
once the stack's been started once), deny it from everywhere else. For topology B, scope `@'%'`
down to the actual VPN/tunnel peer address instead.

Verify the user works before moving on (run from the RADIUS box itself, over loopback):

```bash
mysql -h 127.0.0.1 -u wispportal -p raddb -e "SELECT 1;"
```

If the database name or table layout differs from `raddb`'s standard FreeRADIUS schema, run
`pnpm radius:pull` once `RADIUS_DATABASE_URL` is set (next step) to regenerate
[`prisma/radius/schema.prisma`](../prisma/radius/schema.prisma) from what's actually there, rather
than assuming it matches.

## 5. Configure `.env`

```bash
cp .env.example .env
```

Fill in at minimum:
- `RADIUS_DATABASE_URL` — `mysql://wispportal:<password>@host.docker.internal:3306/raddb` for
  topology A (§1), or your VPN/tunnel address for topology B
- `DATABASE_URL` — leave as-is; `docker-compose.yml` already points this at the `db` service for
  you regardless of topology
- `CRON_SECRET` — `openssl rand -base64 32`
- `MPESA_*` — real (sandbox is fine to start) Safaricom Daraja credentials; see [`MPESA-INTEGRATION.md`](MPESA-INTEGRATION.md)
- `OPNSENSE_CAPTIVE_PORTAL_BASE_URL` / `OPNSENSE_DEFAULT_ZONE_ID` — see [`OPNSENSE-SETUP.md`](OPNSENSE-SETUP.md)

`chmod 600 .env` — it holds real credentials. `APP_BASE_URL`/`MPESA_CALLBACK_URL` need the tunnel domain from the next step, so come back and fill those in after it.

## 6. Set up a public HTTPS tunnel for M-Pesa's callback

Safaricom's STK Push callback needs a real, publicly reachable HTTPS URL — `localhost` or a private IP is rejected outright (`400.002.02 Invalid CallBackURL`). Two ways to get one; most instances can just start with the first:

### Quick tunnel (no Cloudflare account or domain needed)

The same ephemeral Cloudflare quick tunnel the [README's Quickstart](../README.md#quickstart-try-it-now-no-domain-needed) uses, pointed at `web-prod` instead of the dev `web` service — nothing to set up beforehand:

```bash
docker compose --profile tunnel-prod up -d tunnel-prod
docker compose logs tunnel-prod | grep trycloudflare
```

Copy the printed `https://<random>.trycloudflare.com` URL into `.env` (§5) as `APP_BASE_URL`, and as `MPESA_CALLBACK_URL` with `/api/mpesa/callback` appended.

This URL is random and changes — along with any in-flight payment callbacks — every time the `tunnel-prod` container restarts, and there's no access control in front of it. Fine to run an actual site on for a while, but once it's a hotspot you're keeping up long-term, switch to a named tunnel instead:

### Alternative: named tunnel (stable domain, no random-restart URL)

A **named Cloudflare Tunnel** on a domain you control in Cloudflare — the URL and DNS record persist across restarts, instead of being reassigned every time. Needs a domain already added to a (free) Cloudflare account.

This only needs to be done **once per instance** — the tunnel and its DNS record persist. All of it runs via the `cloudflare/cloudflared` Docker image already used by [`docker-compose.yml`](../docker-compose.yml)'s `named-tunnel` service; nothing extra to install.

```bash
mkdir -p .cloudflared

# 1. Authenticate to your Cloudflare account — prints a URL, open it in a browser and approve
#    against the Cloudflare account that manages your domain, then pick that domain/zone.
#    Click it quickly: the login session can expire within a couple of minutes.
docker run --rm -v "$(pwd)/.cloudflared:/home/nonroot/.cloudflared" cloudflare/cloudflared:latest tunnel login

# 2. Create the named tunnel (choose any name; "wisp-portal" here)
docker run --rm -v "$(pwd)/.cloudflared:/home/nonroot/.cloudflared" cloudflare/cloudflared:latest tunnel create wisp-portal

# 3. Route your subdomain to it — adds the CNAME in your Cloudflare DNS automatically
docker run --rm -v "$(pwd)/.cloudflared:/home/nonroot/.cloudflared" cloudflare/cloudflared:latest \
  tunnel route dns wisp-portal <your-subdomain>.yourdomain.com
```

Then write `.cloudflared/config.yml` (the tunnel ID/credentials filename come from step 2's output):

```yaml
tunnel: <tunnel-id>
credentials-file: /home/nonroot/.cloudflared/<tunnel-id>.json

ingress:
  - hostname: <your-subdomain>.yourdomain.com
    service: http://web-prod:3000
  - service: http_status:404
```

Set `APP_BASE_URL` and `MPESA_CALLBACK_URL` in `.env` (§5) to `https://<your-subdomain>.yourdomain.com` (and `.../api/mpesa/callback` for the latter).

`.cloudflared/` is gitignored, same treatment as `.env` — it holds real credentials and is never checked out from a fresh clone; set it up fresh on each new instance.

## 7. Build and start

Whichever tunnel you set up in §6, naming the services explicitly like this — rather than a bare
`up -d` — avoids also starting the dev `web` service, which would otherwise collide with
`web-prod` on port 3000.

**With the quick tunnel:**

```bash
docker compose up -d db
docker compose --profile prod --profile tunnel-prod up -d --build web-prod tunnel-prod
```

**With the named tunnel:**

```bash
docker compose up -d db
docker compose --profile prod --profile named-tunnel up -d --build web-prod named-tunnel
```

## 8. Run migrations and seed packages

```bash
docker compose exec -T web-prod pnpm db:migrate --name init
docker compose exec -T web-prod pnpm db:seed
```

(Drop `--name init` after the first instance — that flag is only for naming a brand-new migration; subsequent instances just need `pnpm db:migrate` to apply the migrations already committed to the repo, not create new ones.)

## 9. Verify

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/   # expect 200
docker compose logs web-prod --tail 40
```

Then confirm it's reachable from wherever subscribers actually connect (e.g. the hotspot VLAN interface's IP, not just `localhost`).

## 10. Wire up OPNsense

This app being up doesn't do anything until OPNsense redirects unauthenticated clients to it and is configured to authenticate against the same FreeRADIUS this instance writes to. Follow [`OPNSENSE-SETUP.md`](OPNSENSE-SETUP.md).

## Redeploying after a code change

`git pull`, then:

```bash
docker compose --profile prod up -d --build web-prod
```

If `prisma/app/schema.prisma` changed, also run `pnpm db:migrate` again (§8) before restarting.

## Troubleshooting

- **`curl`/DNS just hangs inside the container, nothing times out cleanly** — likely a walled-garden network (§2), not a broken container. Check `cat /etc/resolv.conf` and whether the gateway even answers ICMP/TCP at all.
- **The app can't reach MariaDB at all (topology A)** — almost always MariaDB's `bind-address` still being `127.0.0.1`-only, which rejects anything arriving over Docker's bridge network regardless of what hostname you point `RADIUS_DATABASE_URL` at. Confirm with `mysql -h <docker-bridge-gateway-ip> -u wispportal -p raddb` from the host itself; if that fails the same way, it's the bind-address, not Docker or this app.
- **Prisma errors about missing/unexpected columns on the radius side** — the hand-maintained `prisma/radius/schema.prisma` doesn't match this site's actual daloRADIUS schema. Run `pnpm radius:pull` against the real `RADIUS_DATABASE_URL` and commit the diff.
- **RADIUS provisioning fails silently (session ends `FAILED`)** — check `RadiusProvisionLog` rows in the app's own Postgres DB for the actual error; it's logged there, not just swallowed.
