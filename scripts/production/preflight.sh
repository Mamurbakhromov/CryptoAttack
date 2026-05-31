#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${CRYPTOATTACK_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
ENV_FILE="${CRYPTOATTACK_ENV_FILE:-$ROOT_DIR/.env}"

fail() {
  echo "preflight: $*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 is required"
}

require_value() {
  local name="$1"
  local value="${!name:-}"
  if [[ -z "$value" || "$value" == *replace-with-* || "$value" == *cryptoattack.example.com* || "$value" == CryptoAttack-your-real-key ]]; then
    fail "$name must be set to a real production value"
  fi
}

require_flag() {
  local name="$1"
  local expected="$2"
  local value="${!name:-}"
  [[ "$value" == "$expected" ]] || fail "$name must be $expected"
}

[[ -f "$ENV_FILE" ]] || fail "missing env file at $ENV_FILE"

set -a
# shellcheck source=/dev/null
. "$ENV_FILE"
set +a

cd "$ROOT_DIR"

if [[ -r /etc/os-release ]]; then
  # shellcheck source=/dev/null
  . /etc/os-release
  [[ "${ID:-}" == "ubuntu" && "${VERSION_ID:-}" == "24.04" ]] || fail "expected Ubuntu 24.04, found ${PRETTY_NAME:-unknown OS}"
fi

require_command git
require_command node
require_command pnpm
require_command docker
require_command curl
require_command pm2
require_command caddy

node_major="$(node -p "Number(process.versions.node.split('.')[0])")"
[[ "$node_major" -eq 24 ]] || fail "Node 24.x is required; found $(node -v). Run nvm install && nvm use, or install NodeSource 24.x."

[[ -f "$ROOT_DIR/.node-version" ]] || fail ".node-version is required"
[[ -f "$ROOT_DIR/.nvmrc" ]] || fail ".nvmrc is required"
[[ "$(tr -d '[:space:]' < "$ROOT_DIR/.node-version")" == "24" ]] || fail ".node-version must be 24"
[[ "$(tr -d '[:space:]' < "$ROOT_DIR/.nvmrc")" == "24" ]] || fail ".nvmrc must be 24"
grep -qx 'engine-strict=true' "$ROOT_DIR/.npmrc" || fail ".npmrc must set engine-strict=true"

pnpm_version="$(pnpm --version)"
[[ "$pnpm_version" == "9.15.4" ]] || fail "pnpm 9.15.4 is required; found $pnpm_version"

docker compose version >/dev/null
docker info >/dev/null

mode="$(stat -c '%a' "$ENV_FILE" 2>/dev/null || true)"
[[ "$mode" == "600" || "$mode" == "400" ]] || fail "$ENV_FILE must be chmod 600 or 400"

if [[ -n "$(git status --short --untracked-files=no)" ]]; then
  fail "tracked files are modified; commit or discard local production changes before deploying"
fi

require_flag NODE_ENV production
require_flag MOCK_CRYPTOATTACK false
require_flag SERVER_HOST 127.0.0.1
require_flag DASHBOARD_AUTH_ENABLED true
require_flag DATABASE_STORAGE_ENABLED true
require_flag DATABASE_REQUIRED_ON_START true
require_flag DATABASE_MIGRATIONS_ON_START false
require_flag TIMESCALE_COMPRESSION_ENABLED false

require_value CRYPTOATTACK_API_KEY
require_value WEB_ORIGIN
require_value DASHBOARD_AUTH_TOKEN
require_value DASHBOARD_ADMIN_TOKEN
require_value POSTGRES_PASSWORD
require_value DATABASE_URL

[[ "${WEB_ORIGIN}" == https://* ]] || fail "WEB_ORIGIN must be an https:// URL"
[[ "${DATABASE_URL}" == postgres://* || "${DATABASE_URL}" == postgresql://* ]] || fail "DATABASE_URL must be postgres:// or postgresql://"

[[ -d /var/lib/cryptoattack/data ]] || fail "/var/lib/cryptoattack/data is missing"
[[ -w /var/lib/cryptoattack/data ]] || fail "/var/lib/cryptoattack/data is not writable by $(id -un)"
[[ -d /var/backups/cryptoattack/postgres ]] || fail "/var/backups/cryptoattack/postgres is missing"
[[ -w /var/backups/cryptoattack/postgres ]] || fail "/var/backups/cryptoattack/postgres is not writable by $(id -un)"

docker compose --env-file "$ENV_FILE" config >/dev/null

if [[ -f /etc/caddy/Caddyfile ]]; then
  caddy validate --config /etc/caddy/Caddyfile >/dev/null
fi

echo "preflight: ok"
