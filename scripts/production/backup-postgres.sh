#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${CRYPTOATTACK_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
ENV_FILE="${CRYPTOATTACK_ENV_FILE:-$ROOT_DIR/.env}"
BACKUP_DIR="${CRYPTOATTACK_BACKUP_DIR:-/var/backups/cryptoattack/postgres}"

fail() {
  echo "backup-postgres: $*" >&2
  exit 1
}

[[ -f "$ENV_FILE" ]] || fail "missing env file at $ENV_FILE"

set -a
# shellcheck source=/dev/null
. "$ENV_FILE"
set +a

cd "$ROOT_DIR"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_file="$BACKUP_DIR/cryptoattack-$timestamp.dump"
tmp_file="$backup_file.incomplete"
trap 'rm -f "$tmp_file"' ERR

docker compose --env-file "$ENV_FILE" up -d postgres >/dev/null

docker compose --env-file "$ENV_FILE" exec -T postgres sh -c \
  'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --compress=9 --no-owner --no-acl' \
  > "$tmp_file"

chmod 600 "$tmp_file"

if command -v pg_restore >/dev/null 2>&1; then
  pg_restore --list "$tmp_file" >/dev/null
else
  docker compose --env-file "$ENV_FILE" exec -T postgres sh -c \
    'tmp="$(mktemp)"; cat > "$tmp"; pg_restore --list "$tmp" >/dev/null; rm -f "$tmp"' \
    < "$tmp_file"
fi

mv "$tmp_file" "$backup_file"
echo "backup-postgres: created $backup_file"
