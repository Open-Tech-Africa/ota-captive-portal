#!/usr/bin/env bash
# Shared helpers for scripts/install-dev.sh and scripts/install-prod.sh.
#
# package.json is the single source of truth for every docker command. These helpers run its
# scripts through `pnpm run` when pnpm is installed. Otherwise they resolve the script text from
# package.json with jq and expand nested `pnpm <script>` calls themselves. That lets a fresh
# server with only Docker (no Node/pnpm) install the portal.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [[ -t 1 ]]; then
  C_BOLD=$'\033[1m' C_DIM=$'\033[2m' C_RED=$'\033[31m' C_GREEN=$'\033[32m' C_YELLOW=$'\033[33m' C_RESET=$'\033[0m'
else
  C_BOLD="" C_DIM="" C_RED="" C_GREEN="" C_YELLOW="" C_RESET=""
fi

step() { printf '\n%s==>%s %s%s%s\n' "$C_GREEN" "$C_RESET" "$C_BOLD" "$*" "$C_RESET"; }
info() { printf '    %s\n' "$*"; }
warn() { printf '%swarning:%s %s\n' "$C_YELLOW" "$C_RESET" "$*" >&2; }
die() {
  printf '%serror:%s %s\n' "$C_RED" "$C_RESET" "$*" >&2
  exit 1
}

# ---------------------------------------------------------------------------------------------
# Running package.json scripts
# ---------------------------------------------------------------------------------------------

USE_PNPM=0

detect_runner() {
  if command -v pnpm >/dev/null 2>&1; then
    USE_PNPM=1
  elif ! command -v jq >/dev/null 2>&1; then
    die "need either pnpm or jq to read package.json scripts (e.g. 'sudo apt install jq')"
  fi
}

# Print the raw command for a package.json script, or nothing if it doesn't exist.
script_cmd() {
  jq -r --arg name "$1" '.scripts[$name] // empty' package.json
}

# Run a package.json script by name, like `pnpm run <name>`.
run_script() {
  local name="$1"
  if [[ "$USE_PNPM" == 1 ]]; then
    printf '%s$ pnpm %s%s\n' "$C_DIM" "$name" "$C_RESET"
    pnpm run --silent "$name"
    return
  fi

  local cmd
  cmd="$(script_cmd "$name")"
  [[ -n "$cmd" ]] || die "package.json has no script named '$name'"

  # Expand `a && b && c` chains, recursing into `pnpm <script>` parts so nested scripts work
  # without pnpm installed.
  local part
  local -a parts=()
  while [[ "$cmd" == *" && "* ]]; do
    parts+=("${cmd%% && *}")
    cmd="${cmd#* && }"
  done
  parts+=("$cmd")

  for part in "${parts[@]}"; do
    if [[ "$part" =~ ^pnpm\ (run\ )?([A-Za-z0-9:_-]+)$ ]] && [[ -n "$(script_cmd "${BASH_REMATCH[2]}")" ]]; then
      run_script "${BASH_REMATCH[2]}"
    else
      printf '%s$ %s%s\n' "$C_DIM" "$part" "$C_RESET"
      bash -c "$part"
    fi
  done
}

# ---------------------------------------------------------------------------------------------
# Preflight checks
# ---------------------------------------------------------------------------------------------

preflight() {
  step "Checking prerequisites"
  command -v docker >/dev/null 2>&1 || die "Docker is not installed: https://docs.docker.com/engine/install/"
  docker info >/dev/null 2>&1 || die "can't talk to the Docker daemon (is it running, and is your user in the 'docker' group?)"
  docker compose version >/dev/null 2>&1 ||
    die "the Docker Compose plugin is missing ('docker compose', not the old 'docker-compose')"
  command -v openssl >/dev/null 2>&1 || die "openssl is required to generate secrets"
  detect_runner
  info "docker: $(docker --version | sed 's/^Docker version //')"
  info "compose: $(docker compose version --short)"
  if [[ "$USE_PNPM" == 1 ]]; then
    info "runner: pnpm $(pnpm --version)"
  else
    info "runner: jq (pnpm not found; reading package.json directly)"
  fi
}

# ---------------------------------------------------------------------------------------------
# .env bootstrap and validation
# ---------------------------------------------------------------------------------------------

env_get() {
  # Value of KEY in .env, with surrounding quotes and trailing `# comment` stripped.
  local line
  line="$(grep -E "^$1=" .env | tail -n1 || true)"
  line="${line#*=}"
  line="${line%%#*}"
  line="$(printf '%s' "$line" | sed -E 's/[[:space:]]+$//; s/^"(.*)"$/\1/; s/^'"'"'(.*)'"'"'$/\1/')"
  printf '%s' "$line"
}

env_set() {
  local key="$1" value="$2"
  local escaped
  escaped="$(printf '%s' "$value" | sed -e 's/[\/&|]/\\&/g')"
  if grep -qE "^$key=" .env; then
    sed -i.bak -E "s|^$key=.*|$key=$escaped|" .env && rm -f .env.bak
  else
    printf '%s=%s\n' "$key" "$value" >>.env
  fi
}

# Create .env from .env.example if it doesn't exist, generating fresh secrets.
bootstrap_env() {
  step "Preparing .env"
  if [[ -f .env ]]; then
    info ".env already exists, leaving it alone"
  else
    cp .env.example .env
    chmod 600 .env
    env_set CRON_SECRET "$(openssl rand -base64 32)"
    env_set ADMIN_PASSWORD "$(openssl rand -base64 18)"
    info "created .env from .env.example (chmod 600)"
    info "generated CRON_SECRET and ADMIN_PASSWORD"
    ENV_CREATED=1
  fi

  # Older .env files may still be missing these; fill them so the app can boot.
  if [[ -z "$(env_get CRON_SECRET)" ]]; then
    env_set CRON_SECRET "$(openssl rand -base64 32)"
    info "CRON_SECRET was empty, generated one"
  fi
  if [[ -z "$(env_get ADMIN_PASSWORD)" ]]; then
    env_set ADMIN_PASSWORD "$(openssl rand -base64 18)"
    info "ADMIN_PASSWORD was empty, generated one"
  fi
}

# Print the names of required vars (per src/lib/env.ts) that are empty in .env.
missing_env_vars() {
  local provider key
  local -a required=(RADIUS_DATABASE_URL APP_BASE_URL OPNSENSE_CAPTIVE_PORTAL_BASE_URL)
  provider="$(env_get PAYMENT_PROVIDER)"
  if [[ "${provider:-mpesa}" == "mpesa" ]]; then
    required+=(MPESA_ENV MPESA_CONSUMER_KEY MPESA_CONSUMER_SECRET MPESA_SHORTCODE MPESA_PASSKEY MPESA_CALLBACK_URL)
  else
    required+=(PAYSTACK_SECRET_KEY)
  fi
  for key in "${required[@]}"; do
    [[ -n "$(env_get "$key")" ]] || printf '%s\n' "$key"
  done
}

# Print the names of vars still set to an .env.example placeholder.
placeholder_env_vars() {
  local key
  for key in APP_BASE_URL MPESA_CALLBACK_URL; do
    [[ "$(env_get "$key")" == *portal.example.com* ]] && printf '%s\n' "$key"
  done
  [[ "$(env_get RADIUS_DATABASE_URL)" == *wispportal:changeme@* ]] && printf '%s\n' RADIUS_DATABASE_URL
  return 0
}

# ---------------------------------------------------------------------------------------------
# Database state
# ---------------------------------------------------------------------------------------------

# True when the Package table has no rows. prisma/app/seed.ts upserts with `update: pkg`, so
# re-running it would overwrite price/speed edits made in /admin/packages; the installers only
# seed a fresh database.
packages_table_empty() {
  local count
  count="$(docker compose exec -T db psql -U portal -d wisp_portal -tAc 'select count(*) from "Package"' 2>/dev/null || echo 0)"
  [[ "${count//[[:space:]]/}" == "0" ]]
}

# ---------------------------------------------------------------------------------------------
# Waiting on services
# ---------------------------------------------------------------------------------------------

wait_for_http() {
  local url="$1" timeout="${2:-180}" waited=0
  info "waiting for $url (up to ${timeout}s)"
  until curl -fsS -o /dev/null --max-time 5 "$url" 2>/dev/null; do
    if ((waited >= timeout)); then
      warn "$url didn't answer within ${timeout}s; check the logs with: docker compose logs -f $3"
      return 1
    fi
    sleep 3
    waited=$((waited + 3))
  done
  info "up after ~${waited}s"
}

# Print the trycloudflare URL for a quick-tunnel service once it appears in its logs.
print_tunnel_url() {
  local service="$1" url="" waited=0
  info "waiting for the $service URL"
  while ((waited < 60)); do
    url="$(docker compose logs "$service" 2>/dev/null | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -n1 || true)"
    [[ -n "$url" ]] && break
    sleep 2
    waited=$((waited + 2))
  done
  if [[ -z "$url" ]]; then
    warn "no tunnel URL yet; check: docker compose logs $service | grep trycloudflare"
    return
  fi
  TUNNEL_URL="$url"
  info "public URL: ${C_BOLD}$url${C_RESET}"
}
