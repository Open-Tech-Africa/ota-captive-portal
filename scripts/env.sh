#!/usr/bin/env bash
# .env helpers for the installers, sourced by scripts/lib.sh:
#   - env_get / env_set: read and write single values safely (quoting, inline comments, perms)
#   - bootstrap_env:     create .env from .env.example with generated secrets
#   - configure_env:     walk the user through every var src/lib/env.ts needs, with validation
#   - validate_env:      final check before anything starts (warn in dev, refuse in prod)
#
# Not prompted, on purpose: DATABASE_URL (docker-compose.yml sets it for the containers),
# CRON_SECRET (generated), RADIUS_CLEANUP_GRACE_MINUTES (has a sensible default).

# ---------------------------------------------------------------------------------------------
# Reading and writing values
# ---------------------------------------------------------------------------------------------

# Value of KEY in .env: unquoted, with any trailing `  # comment` removed. Empty if unset.
env_get() {
  local line value
  line="$(grep -E "^$1=" .env 2>/dev/null | tail -n1 || true)"
  value="${line#*=}"
  case "$value" in
    \'*)
      value="${value#\'}"
      value="${value%%\'*}"
      ;;
    \"*)
      value="${value#\"}"
      value="${value%\"*}"
      value="${value//\\\"/\"}"
      value="${value//\\\$/\$}"
      value="${value//\\\\/\\}"
      ;;
    *)
      value="${value%%[[:space:]]#*}"
      value="${value%"${value##*[![:space:]]}"}"
      ;;
  esac
  printf '%s' "$value"
}

# Quote a value for .env only when it needs it (spaces, #, $, quotes...).
env_quote() {
  local value="$1"
  if [[ "$value" =~ ^[A-Za-z0-9_./:@+=,%-]*$ ]]; then
    printf '%s' "$value"
  elif [[ "$value" != *"'"* ]]; then
    printf "'%s'" "$value"
  else
    value="${value//\\/\\\\}"
    value="${value//\"/\\\"}"
    value="${value//\$/\\\$}"
    printf '"%s"' "$value"
  fi
}

# Set KEY=VALUE in .env, replacing the existing line or appending. Keeps the file's permissions.
env_set() {
  local key="$1" quoted
  quoted="$(env_quote "$2")"
  ENV_KEY="$key" ENV_VALUE="$quoted" awk '
    BEGIN { key = ENVIRON["ENV_KEY"]; line = key "=" ENVIRON["ENV_VALUE"]; done = 0 }
    index($0, key "=") == 1 { if (!done) print line; done = 1; next }
    { print }
    END { if (!done) print line }
  ' .env >.env.tmp
  cat .env.tmp >.env
  rm -f .env.tmp
}

# True when VALUE is one of .env.example's placeholders rather than something real.
is_placeholder() {
  [[ "$1" == *portal.example.com* || "$1" == *wispportal:changeme@* ]]
}

# ---------------------------------------------------------------------------------------------
# Creating .env
# ---------------------------------------------------------------------------------------------

# Create .env from .env.example if it doesn't exist, generating fresh secrets.
bootstrap_env() {
  step "Preparing .env"
  if [[ -f .env ]]; then
    info ".env already exists"
  else
    cp .env.example .env
    chmod 600 .env
    env_set CRON_SECRET "$(openssl rand -base64 32)"
    env_set ADMIN_PASSWORD "$(openssl rand -base64 18)"
    info "created .env from .env.example (chmod 600)"
    info "generated CRON_SECRET and ADMIN_PASSWORD"
    ENV_CREATED=1
  fi

  normalize_empty_values

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

# Older .env.example files had `KEY=   # comment` lines. Docker Compose reads those as the value
# "# comment", not as empty, so rewrite them to `KEY=` with the comment on the line above.
normalize_empty_values() {
  grep -qE '^[A-Za-z_][A-Za-z0-9_]*=[[:space:]]+#' .env || return 0
  awk '
    match($0, /^[A-Za-z_][A-Za-z0-9_]*=[ \t]+#/) {
      key = substr($0, 1, index($0, "=") - 1)
      comment = substr($0, RLENGTH)
      print comment
      print key "="
      next
    }
    { print }
  ' .env >.env.tmp
  cat .env.tmp >.env
  rm -f .env.tmp
  info "moved comments off empty values (Compose would have read them as the value)"
}

# ---------------------------------------------------------------------------------------------
# Validators: return 0 if the value is fine, else set VALIDATION_ERROR and return 1
# ---------------------------------------------------------------------------------------------

VALIDATION_ERROR=""

valid_http_url() {
  [[ "$1" =~ ^https?://[^[:space:]]+$ ]] || {
    VALIDATION_ERROR="must be a URL starting with http:// or https://"
    return 1
  }
}
valid_mysql_url() {
  [[ "$1" =~ ^mysql://[^[:space:]]+$ ]] || {
    VALIDATION_ERROR="must look like mysql://user:password@host:3306/raddb"
    return 1
  }
}
valid_real() {
  ! is_placeholder "$1" || {
    VALIDATION_ERROR="that's the .env.example placeholder; enter your real value"
    return 1
  }
}
valid_provider() {
  [[ "$1" == "paystack" || "$1" == "mpesa" ]] || {
    VALIDATION_ERROR="enter paystack or mpesa"
    return 1
  }
}
valid_mpesa_env() {
  [[ "$1" == "sandbox" || "$1" == "production" ]] || {
    VALIDATION_ERROR="enter sandbox or production"
    return 1
  }
}
valid_paystack_key() {
  [[ "$1" =~ ^sk_(test|live)_[A-Za-z0-9]+$ ]] || {
    VALIDATION_ERROR="must start with sk_test_ or sk_live_ (Paystack dashboard > Settings > API Keys & Webhooks)"
    return 1
  }
}
valid_bool() {
  [[ "$1" == "true" || "$1" == "false" ]] || {
    VALIDATION_ERROR="enter true or false"
    return 1
  }
}
valid_int() {
  [[ "$1" =~ ^[0-9]+$ ]] || {
    VALIDATION_ERROR="must be a whole number"
    return 1
  }
}
valid_password() {
  ((${#1} >= 8)) || {
    VALIDATION_ERROR="must be at least 8 characters"
    return 1
  }
}

# ---------------------------------------------------------------------------------------------
# Prompting
# ---------------------------------------------------------------------------------------------

# Prompts go to stderr and answers come from the terminal, so this works under `pnpm run` too.
# INSTALL_PROMPT_INPUT points it at a file of answers instead (one per line), for testing.
can_prompt() {
  [[ -n "${INSTALL_PROMPT_INPUT:-}" ]] && return 0
  { : </dev/tty; } 2>/dev/null
}

open_prompt_input() {
  exec 3<"${INSTALL_PROMPT_INPUT:-/dev/tty}"
}

close_prompt_input() {
  exec 3<&-
}

# Show a secret as its first 4 characters plus its length, never in full.
mask() {
  if ((${#1} <= 8)); then
    printf '%s' "********"
  else
    printf '%s… (%s chars)' "${1:0:4}" "${#1}"
  fi
}

# read_answer OUTVAR SECRET: read one line from the prompt input into OUTVAR.
# Its local has an unusual name so it can't shadow the caller's OUTVAR (printf -v would write to
# the local instead).
read_answer() {
  local __answer=""
  if [[ "$2" == 1 && -z "${INSTALL_PROMPT_INPUT:-}" ]]; then
    IFS= read -rs -u 3 __answer || true
    printf '\n' >&2
  else
    IFS= read -r -u 3 __answer || true
  fi
  printf -v "$1" '%s' "$__answer"
}

# confirm "Question?" y|n — yes/no question with a default, returns 0 for yes.
confirm() {
  local question="$1" default="$2" hint reply
  [[ "$default" == y ]] && hint="Y/n" || hint="y/N"
  while true; do
    printf '  %s [%s]: ' "$question" "$hint" >&2
    read_answer reply 0
    reply="${reply:-$default}"
    case "${reply,,}" in
      y | yes) return 0 ;;
      n | no) return 1 ;;
    esac
    printf '  %sanswer y or n%s\n' "$C_YELLOW" "$C_RESET" >&2
  done
}

section() {
  printf '\n  %s%s%s\n' "$C_BOLD" "$*" "$C_RESET" >&2
}

# prompt_var KEY "Label" [--help TEXT] [--default VALUE] [--prefer-default] [--secret]
#            [--validate "fn fn..."]
# Asks for KEY, offering its current .env value (or --default when the current value is empty or
# an .env.example placeholder, or always with --prefer-default) and keeping it on Enter. Loops
# until every validator passes, then writes the answer to .env.
prompt_var() {
  local key="$1" label="$2"
  shift 2
  local help="" default="" prefer_default=0 secret=0 validators="" current shown answer fn ok
  while (($#)); do
    case "$1" in
      --help) help="$2" && shift ;;
      --default) default="$2" && shift ;;
      --prefer-default) prefer_default=1 ;;
      --secret) secret=1 ;;
      --validate) validators="$2" && shift ;;
    esac
    shift
  done

  current="$(env_get "$key")"
  if [[ "$prefer_default" == 0 && -n "$current" ]] && { [[ -z "$default" ]] || ! is_placeholder "$current"; }; then
    default="$current"
  fi

  [[ -n "$help" ]] && printf '  %s%s%s\n' "$C_DIM" "$help" "$C_RESET" >&2
  while true; do
    shown="$default"
    [[ "$secret" == 1 && -n "$default" ]] && shown="$(mask "$default")"
    if [[ -n "$shown" ]]; then
      printf '  %s %s(%s)%s [%s]: ' "$label" "$C_DIM" "$key" "$C_RESET" "$shown" >&2
    else
      printf '  %s %s(%s)%s: ' "$label" "$C_DIM" "$key" "$C_RESET" >&2
    fi
    read_answer answer "$secret"
    answer="${answer:-$default}"

    ok=1
    if [[ -z "$answer" ]]; then
      VALIDATION_ERROR="required"
      ok=0
    else
      for fn in $validators; do
        "$fn" "$answer" || {
          ok=0
          break
        }
      done
    fi
    if [[ "$ok" == 1 ]]; then
      env_set "$key" "$answer"
      return
    fi
    printf '  %s%s%s\n' "$C_YELLOW" "$VALIDATION_ERROR" "$C_RESET" >&2
  done
}

# configure_env dev|prod — the interactive walkthrough. URL_FROM_TUNNEL=1 skips the public URL
# questions because the installer fills them in from the quick tunnel once it's up.
configure_env() {
  local mode="$1" provider base_url real_check="" url_check
  [[ "$mode" == prod ]] && real_check="valid_real"
  url_check="valid_http_url $real_check"

  step "Configuring .env"
  info "Press Enter to keep the value in [brackets]. Secrets are typed hidden and shown masked."
  [[ "$mode" == dev ]] &&
    info "Testing without WISP infrastructure? Keep the RADIUS and OPNsense placeholders."
  open_prompt_input

  section "Your hotspot"
  prompt_var SITE_NAME "Hotspot name, shown on the splash page" --default "Mamba WiFi"
  if [[ "${URL_FROM_TUNNEL:-0}" == 1 ]]; then
    info "APP_BASE_URL will be set to the tunnel URL once it's up"
  else
    local url_default="http://localhost:3000"
    [[ "$mode" == prod ]] && url_default=""
    prompt_var APP_BASE_URL "Public URL of this portal" --default "$url_default" \
      --help "Payment callbacks and webhooks are sent here, so a real deployment needs public HTTPS." \
      --validate "$url_check"
  fi
  base_url="$(env_get APP_BASE_URL)"

  section "Payments"
  prompt_var PAYMENT_PROVIDER "Payment provider: paystack or mpesa" --default paystack \
    --validate valid_provider
  provider="$(env_get PAYMENT_PROVIDER)"
  if [[ "$provider" == paystack ]]; then
    prompt_var PAYSTACK_SECRET_KEY "Paystack secret key" --secret --validate valid_paystack_key \
      --help "Paystack dashboard > Settings > API Keys & Webhooks. Use sk_test_... until you go live."
  else
    local mpesa_env_default=sandbox
    [[ "$mode" == prod ]] && mpesa_env_default=production
    prompt_var MPESA_ENV "Daraja environment: sandbox or production" \
      --default "$mpesa_env_default" --validate valid_mpesa_env \
      --help "Credentials come from your app on developer.safaricom.co.ke (M-Pesa Express)."
    prompt_var MPESA_CONSUMER_KEY "Consumer key" --secret
    prompt_var MPESA_CONSUMER_SECRET "Consumer secret" --secret
    prompt_var MPESA_SHORTCODE "Paybill/Till number" --default 174379 --validate valid_int
    prompt_var MPESA_PASSKEY "Passkey" --secret
    if [[ "${URL_FROM_TUNNEL:-0}" != 1 ]]; then
      prompt_var MPESA_CALLBACK_URL "STK callback URL" --default "$base_url/api/mpesa/callback" \
        --prefer-default --validate "$url_check"
    fi
  fi

  section "RADIUS database (FreeRADIUS/daloRADIUS MariaDB)"
  prompt_var RADIUS_DATABASE_URL "RADIUS database URL" --validate "valid_mysql_url $real_check" \
    --help "Same machine as this app? Use host.docker.internal, never localhost (docs/INSTALL.md §4)."

  section "OPNsense captive portal"
  prompt_var OPNSENSE_CAPTIVE_PORTAL_BASE_URL "Captive portal URL on the hotspot interface" \
    --validate "$url_check" \
    --help "The IP of the interface hotspot clients are on, plain HTTP, e.g. http://10.0.10.1:8000."

  section "Staff admin (/admin)"
  prompt_var ADMIN_PASSWORD "Admin password" --secret --validate valid_password \
    --help "Press Enter to keep the generated one; it's in .env if you need it later."

  section "Optional: OPNsense admin API (live sessions, force disconnect, speed limits)"
  local api_default=n
  [[ -n "$(env_get OPNSENSE_API_BASE_URL)" ]] && api_default=y
  if confirm "Set up the OPNsense admin API?" "$api_default"; then
    prompt_var OPNSENSE_API_BASE_URL "OPNsense admin URL (LAN/admin IP)" --validate valid_http_url \
      --help "System > Access > Users > your user > API keys. Not the hotspot interface URL."
    prompt_var OPNSENSE_API_KEY "API key" --secret
    prompt_var OPNSENSE_API_SECRET "API secret" --secret
    prompt_var OPNSENSE_CAPTIVE_PORTAL_ZONE_ID "Captive portal zone id" --default 0 --validate valid_int
    prompt_var OPNSENSE_API_ALLOW_SELF_SIGNED "Allow OPNsense's self-signed cert: true or false" \
      --default true --validate valid_bool

    local shaper_default=n
    [[ -n "$(env_get OPNSENSE_HOTSPOT_INTERFACE)" ]] && shaper_default=y
    if confirm "Enforce package speeds with OPNsense Traffic Shaper?" "$shaper_default"; then
      prompt_var OPNSENSE_HOTSPOT_INTERFACE "Hotspot interface name, e.g. opt1" \
        --help "Interfaces > Overview. OPNsense's internal name, not an IP."
    else
      env_set OPNSENSE_HOTSPOT_INTERFACE ""
    fi
  else
    local key
    for key in OPNSENSE_API_BASE_URL OPNSENSE_API_KEY OPNSENSE_API_SECRET OPNSENSE_HOTSPOT_INTERFACE; do
      env_set "$key" ""
    done
  fi

  close_prompt_input
  info ""
  info "saved .env"
}

# ---------------------------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------------------------

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

# Print the names of in-use vars still set to an .env.example placeholder. The public URL vars
# are skipped when URL_FROM_TUNNEL=1, since the installer sets those from the tunnel.
placeholder_env_vars() {
  local key
  local -a keys=(RADIUS_DATABASE_URL)
  if [[ "${URL_FROM_TUNNEL:-0}" != 1 ]]; then
    keys+=(APP_BASE_URL)
    [[ "$(env_get PAYMENT_PROVIDER)" == "mpesa" ]] && keys+=(MPESA_CALLBACK_URL)
  fi
  for key in "${keys[@]}"; do
    is_placeholder "$(env_get "$key")" && printf '%s\n' "$key"
  done
  return 0
}

# True when .env is missing something the given mode needs (prompting would help).
env_incomplete() {
  [[ -n "$(missing_env_vars)" ]] && return 0
  [[ "$1" == prod && -n "$(placeholder_env_vars)" ]]
}

# Prompt when .env is new, incomplete, or --configure was passed; otherwise leave it alone.
maybe_configure_env() {
  local mode="$1"
  if [[ "${NO_PROMPT:-0}" == 1 ]]; then
    return
  fi
  if [[ "${FORCE_CONFIGURE:-0}" == 1 || "${ENV_CREATED:-0}" == 1 ]] || env_incomplete "$mode"; then
    if can_prompt; then
      configure_env "$mode"
    else
      warn "no terminal to ask questions on; edit .env by hand or re-run interactively"
    fi
  else
    info ".env is complete; re-run with --configure to change it"
  fi
}

# Dev: warn about gaps. Prod: refuse to start with gaps or placeholders.
validate_env() {
  local mode="$1" missing placeholders
  step "Validating .env"
  missing="$(missing_env_vars | paste -sd ' ' -)"
  placeholders="$(placeholder_env_vars | paste -sd ' ' -)"

  if [[ "$mode" == dev ]]; then
    [[ -z "$missing" ]] || warn "empty required vars: $missing. Pages that need them will error until you fill them in (re-run with --configure)."
    info "checked"
    return
  fi

  [[ -z "$missing" ]] || die "these required .env vars are empty: $missing (re-run with --configure)"
  [[ -z "$placeholders" ]] || die "these .env vars still have .env.example placeholder values: $placeholders (re-run with --configure)"
  [[ "$(env_get PAYSTACK_SECRET_KEY)" == sk_test_* && "$(env_get PAYMENT_PROVIDER)" == paystack ]] &&
    warn "PAYSTACK_SECRET_KEY is a test key; no real money will move"
  [[ "$(env_get MPESA_ENV)" == sandbox && "$(env_get PAYMENT_PROVIDER)" == mpesa ]] &&
    warn "MPESA_ENV=sandbox; no real money will move"
  [[ "${URL_FROM_TUNNEL:-0}" == 1 || "$(env_get APP_BASE_URL)" == https://* ]] ||
    warn "APP_BASE_URL isn't HTTPS; Paystack and M-Pesa callbacks need a public HTTPS URL"
  info "required vars are set"
}

# Point APP_BASE_URL (and the M-Pesa callback) at a fresh quick-tunnel URL.
apply_tunnel_url() {
  local url="$1"
  env_set APP_BASE_URL "$url"
  info "APP_BASE_URL=$url"
  if [[ "$(env_get PAYMENT_PROVIDER)" == mpesa ]]; then
    env_set MPESA_CALLBACK_URL "$url/api/mpesa/callback"
    info "MPESA_CALLBACK_URL=$url/api/mpesa/callback"
  fi
}

# Paystack's webhook URL is configured in their dashboard, not here; remind the user where.
print_payment_reminder() {
  if [[ "$(env_get PAYMENT_PROVIDER)" == paystack ]]; then
    info "paystack: set the webhook URL in your Paystack dashboard (Settings > API Keys & Webhooks)"
    info "          to $(env_get APP_BASE_URL)/api/paystack/webhook"
  fi
}
