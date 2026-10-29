# Installing a new instance

A runbook for getting this app running on a new machine or a new hotspot site — written from what actually happened setting up the first test instance (a Proxmox LXC clone of the daloRADIUS box), not a theoretical checklist. If your situation differs, the principles still apply; adjust the specific commands.

## 1. Decide where it runs, relative to the RADIUS database

This is the one decision that changes everything else. Pick one:

- **A — Same host as FreeRADIUS/daloRADIUS** (recommended for a real WISP site, and what the test instance uses). The app reaches MariaDB over `127.0.0.1`, no VPN, no exposed DB port. Use [`docker-compose.lxc.yml`](../docker-compose.lxc.yml).
- **B — A different host from FreeRADIUS/daloRADIUS.** You need a VPN (WireGuard) or SSH tunnel from wherever the app runs into the RADIUS DB's network, or you expose MariaDB's port and firewall it tightly (not recommended). Use the regular [`docker-compose.yml`](../docker-compose.yml) and point `RADIUS_DATABASE_URL` at the tunnel/VPN address. See [`RADIUS-INTEGRATION.md`](RADIUS-INTEGRATION.md).

Everything below assumes **A** unless noted.

## 2. Prerequisites on the target machine

- Docker Engine + the `docker compose` plugin (not the old standalone `docker-compose`).
- If the target is an **LXC container** (Proxmox or otherwise): it must have nesting enabled, or Docker inside it won't start. On Proxmox: `pct set <vmid> --features nesting=1,keyctl=1` (or set it in the container's Options before first boot).
- No internet access required long-term, but **the first `docker compose build` needs to pull base images** (`node:22-alpine`, `postgres:17-alpine`) and `pnpm install` needs the npm registry. If the machine sits on a walled-garden network (see §3), you'll need temporary access for this one step.

Install Docker if it's missing:

```bash
curl -fsSL https://get.docker.com | sh
```

## 3. If the machine has no general internet access

This happened on the first test instance: it sits on the hotspot's own VLAN, which is deliberately walled off (no DNS, can't even ping its own gateway) — the same restriction that will apply to real subscriber devices. To get through this just for initial setup, on Proxmox:

```bash
# Add a temporary NIC on a network that does have internet (e.g. the management bridge)
pct set <vmid> -net1 name=eth1,bridge=vmbr0,ip=dhcp,type=veth
pct exec <vmid> -- dhclient eth1
pct exec <vmid> -- bash -c 'echo "nameserver 1.1.1.1" > /etc/resolv.conf'
```

Do the Docker install and first `docker compose build` with that NIC attached. Afterward, either remove it (`pct set <vmid> -delete net1`) so the box matches the real network it serves, or leave it for easier future rebuilds/code updates — that's a judgment call based on how often you expect to redeploy.

## 4. Get the code onto the machine

If you have direct SSH into the target:

```bash
rsync -avz --exclude 'node_modules' --exclude '.next' --exclude 'src/generated' \
  --exclude '.env' --exclude '.git' --exclude 'tsconfig.tsbuildinfo' \
  ./ user@target:/path/to/wisp-captive-portal/
```

If the target is a **Proxmox LXC you don't have direct SSH into** (common — the container itself may have no route out, as in §3), go through the Proxmox host, which can see the container's filesystem directly:

```bash
# hop 1: your machine -> Proxmox host
rsync -avz --exclude 'node_modules' --exclude '.next' --exclude 'src/generated' \
  --exclude '.env' --exclude '.git' --exclude 'tsconfig.tsbuildinfo' \
  ./ root@<proxmox-host>:/root/wisp-captive-portal/

# hop 2: Proxmox host -> the LXC's rootfs (find the exact path with `pct config <vmid>` -> rootfs storage, then `zfs list` or the storage's mount convention)
ssh root@<proxmox-host> "rsync -a --delete --exclude node_modules --exclude .next --exclude src/generated --exclude .env \
  /root/wisp-captive-portal/ /<storage-mount>/subvol-<vmid>-disk-0/root/wisp-captive-portal/ && \
  chown -R 100000:100000 /<storage-mount>/subvol-<vmid>-disk-0/root/wisp-captive-portal"
```

The `chown -R 100000:100000` matters for an **unprivileged** LXC: the container's root (uid 0 inside) is remapped to uid 100000 on the host, so files copied in as the host's real root need that ownership to be usable as root inside the container.

## 5. Create the RADIUS database user

Don't reuse daloRADIUS's own `raduser` or `root` — create a dedicated, least-privilege user for this app, scoped to exactly the tables it touches (see [`RADIUS-INTEGRATION.md`](RADIUS-INTEGRATION.md)):

```sql
CREATE USER IF NOT EXISTS 'wispportal'@'127.0.0.1' IDENTIFIED BY '<generate with: openssl rand -base64 24>';
GRANT SELECT, INSERT, UPDATE, DELETE ON raddb.radcheck      TO 'wispportal'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE ON raddb.radreply      TO 'wispportal'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE ON raddb.radusergroup  TO 'wispportal'@'127.0.0.1';
GRANT SELECT ON raddb.radacct TO 'wispportal'@'127.0.0.1';
GRANT SELECT ON raddb.nas     TO 'wispportal'@'127.0.0.1';
FLUSH PRIVILEGES;
```

Add `'wispportal'@'localhost'` too if anything will connect over a Unix socket rather than TCP. Verify it works before moving on:

```bash
mysql -h 127.0.0.1 -u wispportal -p raddb -e "SELECT 1;"
```

If the database name or table layout differs from `raddb`'s standard FreeRADIUS schema, run `pnpm radius:pull` once `RADIUS_DATABASE_URL` is set (next step) to regenerate [`prisma/radius/schema.prisma`](../prisma/radius/schema.prisma) from what's actually there, rather than assuming it matches.

## 6. Configure `.env`

```bash
cp .env.example .env
```

Fill in at minimum:
- `RADIUS_DATABASE_URL` — using the user from §5, e.g. `mysql://wispportal:<password>@127.0.0.1:3306/raddb`
- `DATABASE_URL` — for topology A (host networking), `postgres://portal:portal_dev_password@localhost:5435/wisp_portal` matches `docker-compose.lxc.yml`'s published port
- `CRON_SECRET` — `openssl rand -base64 32`
- `MPESA_*` — real (sandbox is fine to start) Safaricom Daraja credentials; see [`MPESA-INTEGRATION.md`](MPESA-INTEGRATION.md)
- `OPNSENSE_CAPTIVE_PORTAL_BASE_URL` / `OPNSENSE_DEFAULT_ZONE_ID` — see [`OPNSENSE-SETUP.md`](OPNSENSE-SETUP.md)

`chmod 600 .env` — it holds real credentials.

## 7. Build and start

Topology A (same host as the RADIUS DB):

```bash
docker compose -f docker-compose.lxc.yml up -d --build
```

Topology B (different host):

```bash
docker compose up -d --build
```

## 8. Run migrations and seed packages

```bash
docker compose -f docker-compose.lxc.yml exec -T web pnpm db:migrate --name init
docker compose -f docker-compose.lxc.yml exec -T web pnpm db:seed
```

(Drop `--name init` after the first instance — that flag is only for naming a brand-new migration; subsequent instances just need `pnpm db:migrate` to apply the migrations already committed to the repo, not create new ones.)

## 9. Verify

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/   # expect 200
docker compose -f docker-compose.lxc.yml logs web --tail 40
```

Then confirm it's reachable from wherever subscribers actually connect (e.g. the hotspot VLAN interface's IP, not just `localhost`).

## 10. Wire up OPNsense

This app being up doesn't do anything until OPNsense redirects unauthenticated clients to it and is configured to authenticate against the same FreeRADIUS this instance writes to. Follow [`OPNSENSE-SETUP.md`](OPNSENSE-SETUP.md).

## Redeploying after a code change

Repeat §4's rsync, then:

```bash
docker compose -f docker-compose.lxc.yml up -d --build web
```

If `prisma/app/schema.prisma` changed, also run `pnpm db:migrate` again (§8) before restarting.

## Troubleshooting

- **`curl`/DNS just hangs inside the container, nothing times out cleanly** — almost certainly a walled-garden network (§3), not a broken container. Check `cat /etc/resolv.conf` and whether the gateway even answers ICMP/TCP at all.
- **Docker daemon won't start inside an LXC** — nesting isn't enabled. `pct config <vmid> | grep features` should show `nesting=1`.
- **Prisma errors about missing/unexpected columns on the radius side** — the hand-maintained `prisma/radius/schema.prisma` doesn't match this site's actual daloRADIUS schema. Run `pnpm radius:pull` against the real `RADIUS_DATABASE_URL` and commit the diff.
- **RADIUS provisioning fails silently (session ends `FAILED`)** — check `RadiusProvisionLog` rows in the app's own Postgres DB for the actual error; it's logged there, not just swallowed.
