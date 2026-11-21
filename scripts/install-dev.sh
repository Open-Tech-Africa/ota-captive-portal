#!/usr/bin/env bash
# One-command local development setup: Postgres plus the hot-reloading `web` container,
# migrations, seed packages, and an optional ephemeral public tunnel.
#
#   ./scripts/install-dev.sh            # or: pnpm install:dev
#   ./scripts/install-dev.sh --tunnel   # also start a trycloudflare.com quick tunnel
#
# Safe to re-run: it rebuilds what changed, applies only new migrations, and seeds only an
# empty database.
# Every docker command it runs is a package.json script (see scripts/lib.sh).

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

WITH_TUNNEL=0
WITH_SEED=1
ENV_CREATED=0
TUNNEL_URL=""

usage() {
  cat <<'EOF'
Usage: scripts/install-dev.sh [options]

Options:
  --tunnel     Also start an ephemeral Cloudflare quick tunnel (pnpm docker:tunnel)
  --no-seed    Skip seeding the default packages
  -h, --help   Show this help
EOF
}

while (($#)); do
  case "$1" in
    --tunnel) WITH_TUNNEL=1 ;;
    --no-seed) WITH_SEED=0 ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      die "unknown option: $1"
      ;;
  esac
  shift
done

preflight
bootstrap_env

missing="$(missing_env_vars | paste -sd ' ' -)"
if [[ -n "$missing" ]]; then
  warn "these required .env vars are empty: $missing"
  warn "the dev server will start, but pages that read env will error until you fill them in"
fi

step "Stopping web-prod if it's running (it shares port 3000)"
run_script docker:web-prod:stop

step "Starting Postgres and the dev web container"
run_script docker:dev

# The web container regenerates both Prisma clients on startup (Dockerfile `dev` CMD) into the
# bind-mounted src/generated. Wait for the server so that has finished before seeding, which
# loads the client; otherwise seed can race it and pick up a half-written or host-only client.
step "Waiting for the dev server"
wait_for_http "http://localhost:3000" 240 web || die "the dev server didn't start; see: docker compose logs web"

step "Applying database migrations"
run_script docker:dev:migrate

if [[ "$WITH_SEED" == 1 ]]; then
  step "Seeding default packages"
  if packages_table_empty; then
    run_script docker:dev:seed
  else
    info "packages already exist, skipping (seeding would overwrite edits made in /admin)"
  fi
fi

if [[ "$WITH_TUNNEL" == 1 ]]; then
  step "Starting the quick tunnel"
  run_script docker:tunnel
  print_tunnel_url tunnel
fi

step "Done"
info "portal:  http://localhost:3000"
info "admin:   http://localhost:3000/admin  (password: ADMIN_PASSWORD in .env)"
info "logs:    docker compose logs -f web"
if [[ -n "$TUNNEL_URL" ]]; then
  info "tunnel:  $TUNNEL_URL"
  info "         put it in .env as APP_BASE_URL (and MPESA_CALLBACK_URL + /api/mpesa/callback),"
  info "         then run: pnpm docker:web:recreate"
fi
if [[ "$ENV_CREATED" == 1 ]]; then
  info ""
  info "A new .env was created. Fill in your payment, RADIUS and OPNsense values, then run"
  info "pnpm docker:web:recreate so the container picks them up."
fi
