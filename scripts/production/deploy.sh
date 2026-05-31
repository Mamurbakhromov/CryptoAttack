#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${CRYPTOATTACK_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
SCRIPT_DIR="$ROOT_DIR/scripts/production"
ENV_FILE="${CRYPTOATTACK_ENV_FILE:-$ROOT_DIR/.env}"
DEPLOY_BRANCH="${CRYPTOATTACK_DEPLOY_BRANCH:-main}"
STATE_DIR="${CRYPTOATTACK_STATE_DIR:-/var/lib/cryptoattack}"

fail() {
  echo "deploy: $*" >&2
  exit 1
}

check_migration_status() {
  local require_clean="$1"
  local output

  if ! output="$(DATABASE_STORAGE_ENABLED=true pnpm db:status 2>&1)"; then
    printf '%s\n' "$output" >&2
    fail "database migration status check failed"
  fi

  printf '%s\n' "$output"

  if grep -q 'checksum-mismatch' <<<"$output"; then
    fail "database migration checksum mismatch detected"
  fi

  if [[ "$require_clean" == "true" ]] && grep -Eq 'Migrations: [0-9]+ applied, [1-9][0-9]* pending' <<<"$output"; then
    fail "database migrations are still pending after migrate"
  fi
}

[[ -f "$ENV_FILE" ]] || fail "missing env file at $ENV_FILE"

set -a
# shellcheck source=/dev/null
. "$ENV_FILE"
set +a

cd "$ROOT_DIR"

if [[ -n "$(git status --short --untracked-files=no)" ]]; then
  fail "tracked files are modified; commit or discard local production changes before deploying"
fi

previous_sha="$(git rev-parse HEAD)"
mkdir -p "$STATE_DIR"
printf '%s\n' "$previous_sha" > "$STATE_DIR/deploy-previous-sha"

git fetch origin "$DEPLOY_BRANCH"
if git show-ref --verify --quiet "refs/heads/$DEPLOY_BRANCH"; then
  git switch "$DEPLOY_BRANCH"
else
  git switch -c "$DEPLOY_BRANCH" --track "origin/$DEPLOY_BRANCH"
fi
git merge --ff-only "origin/$DEPLOY_BRANCH"

new_sha="$(git rev-parse HEAD)"

"$SCRIPT_DIR/preflight.sh"
docker compose --env-file "$ENV_FILE" up -d postgres
"$SCRIPT_DIR/backup-postgres.sh"

pnpm install --frozen-lockfile
pnpm audit:prod
pnpm test
pnpm typecheck
pnpm build

check_migration_status false
DATABASE_STORAGE_ENABLED=true pnpm db:migrate
DATABASE_STORAGE_ENABLED=true pnpm db:verify
check_migration_status true

pm2 startOrReload ecosystem.config.cjs --env production
"$SCRIPT_DIR/smoke.sh" "${WEB_ORIGIN:-}"
pm2 save

printf '%s\n' "$new_sha" > "$STATE_DIR/deploy-current-sha"

echo "deploy: ok $previous_sha -> $new_sha"
