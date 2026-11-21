#!/usr/bin/env bash
# One-command production install/upgrade: Postgres plus the `web-prod` image (Next.js standalone,
# non-root), migrations, seed packages, and optionally a Cloudflare tunnel in front of it.
#
#   ./scripts/install-prod.sh                  # or: pnpm install:prod
#   ./scripts/install-prod.sh --named-tunnel   # stable tunnel on your own domain (recommended)
#   ./scripts/install-prod.sh --tunnel         # ephemeral trycloudflare.com URL, for testing only
#
# Re-run it after `git pull` to upgrade: it rebuilds the image, applies new migrations only, and
# seeds only an empty database. Every docker command it runs is a package.json script (see scripts/lib.sh).
# See docs/INSTALL.md for the full deployment runbook (RADIUS topology, OPNsense, DNS).

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

TUNNEL_MODE=""
WITH_SEED=1
ENV_CREATED=0
TUNNEL_URL=""

usage() {
  cat <<'EOF'
Usage: scripts/install-prod.sh [options]

Options:
  --named-tunnel  Also start the named Cloudflare Tunnel (pnpm docker:named-tunnel);
                  needs ./.cloudflared set up first, see docs/INSTALL.md
  --tunnel        Also start an ephemeral quick tunnel (pnpm docker:tunnel-prod), testing only
  --no-seed       Skip seeding the default packages
  -h, --help      Show this help
EOF
}

while (($#)); do
  case "$1" in
    --tunnel) TUNNEL_MODE="quick" ;;
    --named-tunnel) TUNNEL_MODE="named" ;;
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

if [[ "$ENV_CREATED" == 1 ]]; then
  info ""
  info "A new .env was created with generated secrets. Fill in the rest (see the comments in it"
  info "and docs/INSTALL.md), then re-run this script."
  exit 1
fi

step "Validating .env"
missing="$(missing_env_vars | paste -sd ' ' -)"
[[ -z "$missing" ]] || die "these required .env vars are empty: $missing"
placeholders="$(placeholder_env_vars | paste -sd ' ' -)"
[[ -z "$placeholders" ]] || die "these .env vars still have .env.example placeholder values: $placeholders"
info "required vars are set"

if [[ "$TUNNEL_MODE" == "named" && ! -d .cloudflared ]]; then
  die "--named-tunnel needs ./.cloudflared (credentials + config.yml); see docs/INSTALL.md"
fi

step "Stopping the dev web container if it's running (it shares port 3000)"
run_script docker:web:stop

step "Applying database migrations"
# Runs in a one-off container from the full dev image: the production image has no Prisma CLI.
run_script docker:db
run_script docker:prod:migrate

if [[ "$WITH_SEED" == 1 ]]; then
  step "Seeding default packages"
  if packages_table_empty; then
    run_script docker:prod:seed
  else
    info "packages already exist, skipping (seeding would overwrite edits made in /admin)"
  fi
fi

step "Building and starting web-prod"
run_script docker:prod

case "$TUNNEL_MODE" in
  quick)
    step "Starting the quick tunnel"
    warn "quick tunnel URLs change on every restart; use --named-tunnel for a real deployment"
    run_script docker:tunnel-prod
    print_tunnel_url tunnel-prod
    ;;
  named)
    step "Starting the named tunnel"
    run_script docker:named-tunnel
    ;;
esac

step "Waiting for web-prod"
wait_for_http "http://localhost:3000" 120 web-prod || true

step "Done"
info "local:   http://localhost:3000"
info "public:  $(env_get APP_BASE_URL)"
info "logs:    docker compose logs -f web-prod"
if [[ -n "$TUNNEL_URL" ]]; then
  info "tunnel:  $TUNNEL_URL"
  info "         update APP_BASE_URL (and MPESA_CALLBACK_URL) in .env to match, then run:"
  info "         pnpm docker:web-prod:recreate"
fi
info "upgrade: git pull && ./scripts/install-prod.sh"
