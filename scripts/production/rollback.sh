#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${CRYPTOATTACK_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
SCRIPT_DIR="$ROOT_DIR/scripts/production"
ENV_FILE="${CRYPTOATTACK_ENV_FILE:-$ROOT_DIR/.env}"
STATE_DIR="${CRYPTOATTACK_STATE_DIR:-/var/lib/cryptoattack}"
TARGET_SHA="${1:-}"

fail() {
  echo "rollback: $*" >&2
  exit 1
}

[[ -f "$ENV_FILE" ]] || fail "missing env file at $ENV_FILE"

set -a
# shellcheck source=/dev/null
. "$ENV_FILE"
set +a

cd "$ROOT_DIR"

if [[ -z "$TARGET_SHA" ]]; then
  [[ -f "$STATE_DIR/deploy-previous-sha" ]] || fail "missing $STATE_DIR/deploy-previous-sha; pass a SHA explicitly"
  TARGET_SHA="$(tr -d '[:space:]' < "$STATE_DIR/deploy-previous-sha")"
fi

[[ -n "$TARGET_SHA" ]] || fail "target SHA is empty"

if [[ -n "$(git status --short --untracked-files=no)" ]]; then
  fail "tracked files are modified; commit or discard local production changes before rolling back"
fi

current_sha="$(git rev-parse HEAD)"
printf '%s\n' "$current_sha" > "$STATE_DIR/deploy-rollback-from-sha"

git fetch --all --prune
git switch --detach "$TARGET_SHA"

pnpm install --frozen-lockfile
pnpm build

pm2 startOrReload ecosystem.config.cjs --env production
"$SCRIPT_DIR/smoke.sh" "${WEB_ORIGIN:-}"
pm2 save

echo "rollback: code rolled back $current_sha -> $TARGET_SHA"
echo "rollback: database schema/data was not rolled back; restore a verified dump manually only if needed"
