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
# On first run it asks for every .env value production needs and refuses to start while any are
# empty or still .env.example placeholders. See docs/INSTALL.md for the full deployment runbook
# (RADIUS topology, OPNsense, DNS).

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

TUNNEL_MODE=""
WITH_SEED=1
ENV_CREATED=0
TUNNEL_URL=""
FORCE_CONFIGURE=0
NO_PROMPT=0

usage() {
  cat <<'EOF'
Usage: scripts/install-prod.sh [options]

Options:
  --named-tunnel  Also start the named Cloudflare Tunnel (pnpm docker:named-tunnel);
                  needs ./.cloudflared set up first, see docs/INSTALL.md
  --tunnel        Also start an ephemeral quick tunnel (pnpm docker:tunnel-prod), testing only
  --no-seed       Skip seeding the default packages
  --configure     Ask for every .env value again, even if .env is already complete
  --no-prompt     Never ask questions (CI/automation); fail if .env is incomplete
  -h, --help      Show this help
EOF
}

while (($#)); do
  case "$1" in
    --tunnel) TUNNEL_MODE="quick" ;;
    --named-tunnel) TUNNEL_MODE="named" ;;
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

URL_FROM_TUNNEL=0
[[ "$TUNNEL_MODE" == "quick" ]] && URL_FROM_TUNNEL=1

preflight
bootstrap_env
maybe_configure_env prod
validate_env prod

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
    if [[ -n "$TUNNEL_URL" ]]; then
      step "Pointing the portal at the tunnel URL"
      apply_tunnel_url "$TUNNEL_URL"
      run_script docker:web-prod:recreate
    else
      warn "APP_BASE_URL wasn't updated; payment callbacks won't reach this instance"
    fi
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
[[ -n "$TUNNEL_URL" ]] && info "         (quick tunnel: this URL changes every time the tunnel restarts)"
print_payment_reminder
info "upgrade: git pull && ./scripts/install-prod.sh"
info "change settings: ./scripts/install-prod.sh --configure"
