#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${CRYPTOATTACK_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
ENV_FILE="${CRYPTOATTACK_ENV_FILE:-$ROOT_DIR/.env}"

fail() {
  echo "smoke: $*" >&2
  exit 1
}

[[ -f "$ENV_FILE" ]] || fail "missing env file at $ENV_FILE"

set -a
# shellcheck source=/dev/null
. "$ENV_FILE"
set +a

BASE_URL="${1:-${CRYPTOATTACK_BASE_URL:-${WEB_ORIGIN:-}}}"
[[ -n "$BASE_URL" ]] || fail "provide a base URL or set WEB_ORIGIN"
BASE_URL="${BASE_URL%/}"

AUTH_ARGS=()
if [[ "${DASHBOARD_AUTH_ENABLED:-false}" == "true" ]]; then
  [[ -n "${DASHBOARD_AUTH_TOKEN:-}" ]] || fail "DASHBOARD_AUTH_TOKEN is required for authenticated smoke checks"
  AUTH_ARGS=(-H "Authorization: Bearer $DASHBOARD_AUTH_TOKEN")
fi

curl -fsS --max-time 15 "$BASE_URL/health" >/dev/null
curl -fsS --max-time 15 "${AUTH_ARGS[@]}" "$BASE_URL/api/status" >/dev/null
curl -fsS --max-time 15 "${AUTH_ARGS[@]}" "$BASE_URL/api/storage/status" >/dev/null
curl -fsS --max-time 15 "${AUTH_ARGS[@]}" "$BASE_URL/api/scores/top?side=net&limit=5" >/dev/null

sse_output="$(mktemp)"
trap 'rm -f "$sse_output"' EXIT

set +e
timeout 20s curl -fsS -N "${AUTH_ARGS[@]}" "$BASE_URL/api/stream" > "$sse_output"
sse_status=$?
set -e

if [[ "$sse_status" -ne 0 && "$sse_status" -ne 124 ]]; then
  fail "SSE smoke failed with curl status $sse_status"
fi

grep -Eq '^(event:|data:)' "$sse_output" || fail "SSE stream did not emit event or data lines within 20 seconds"

echo "smoke: ok"
