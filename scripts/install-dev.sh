#!/usr/bin/env bash
# One-command local development setup: Postgres plus the hot-reloading `web` container,
# migrations, seed packages, and an optional ephemeral public tunnel.
#
#   ./scripts/install-dev.sh            # or: pnpm install:dev
#   ./scripts/install-dev.sh --tunnel   # also start a trycloudflare.com quick tunnel
#
# On a fresh checkout it asks for every .env value it needs (payment keys, URLs, ...); RADIUS and
# OPNsense can stay placeholders for local testing.
#
# Safe to re-run: it rebuilds what changed, applies only new migrations, and seeds only an
# empty database.
# Every docker command it runs is a package.json script (see scripts/lib.sh).

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

WITH_TUNNEL=0
WITH_SEED=1
ENV_CREATED=0
TUNNEL_URL=""
FORCE_CONFIGURE=0
NO_PROMPT=0

usage() {
  cat <<'EOF'
Usage: scripts/install-dev.sh [options]

Options:
  --tunnel     Also start an ephemeral Cloudflare quick tunnel (pnpm docker:tunnel)
  --no-seed    Skip seeding the default packages
  --configure  Ask for every .env value again, even if .env is already complete
  --no-prompt  Never ask questions (CI/automation); use .env as it is
  -h, --help   Show this help
EOF
}

while (($#)); do
  case "$1" in
    --tunnel) WITH_TUNNEL=1 ;;
    --no-seed) WITH_SEED=0 ;;
    --configure) FORCE_CONFIGURE=1 ;;
    --no-prompt) NO_PROMPT=1 ;;
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

URL_FROM_TUNNEL="$WITH_TUNNEL"

preflight
bootstrap_env
maybe_configure_env dev
validate_env dev

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
  if [[ -n "$TUNNEL_URL" ]]; then
    step "Pointing the portal at the tunnel URL"
    apply_tunnel_url "$TUNNEL_URL"
    run_script docker:web:recreate
    wait_for_http "http://localhost:3000" 240 web || true
  fi
fi

step "Done"
info "portal:  http://localhost:3000"
info "admin:   http://localhost:3000/admin  (password: ADMIN_PASSWORD in .env)"
info "logs:    docker compose logs -f web"
if [[ -n "$TUNNEL_URL" ]]; then
  info "public:  $TUNNEL_URL  (changes every time the tunnel restarts; re-run with --tunnel)"
fi
print_payment_reminder
info "change settings: ./scripts/install-dev.sh --configure"
