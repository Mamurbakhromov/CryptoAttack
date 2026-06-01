#!/usr/bin/env bash
# =====================================================================
# VM da yangilash skripti: pull -> install -> build -> migrate -> restart
# Ishlatish (repo ildizidan yoki istalgan joydan):
#   bash deploy/deploy.sh
# =====================================================================
set -euo pipefail

# Repo ildiziga o'tamiz (skript joylashgan joyga nisbatan).
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

SERVICE="cryptoattack-dashboard"

echo "==> [1/6] Git pull (fast-forward)"
git pull --ff-only

echo "==> [2/6] Postgres ishlayotganiga ishonch (docker compose)"
docker compose up -d postgres

echo "==> [3/6] Bog'liqliklarni o'rnatish"
pnpm install --frozen-lockfile

echo "==> [4/6] Build (server + web)"
pnpm build

echo "==> [5/6] DB migratsiyalari"
pnpm db:migrate

echo "==> [6/6] Xizmatni qayta ishga tushirish"
sudo systemctl restart "$SERVICE"
sleep 2
sudo systemctl --no-pager --lines=15 status "$SERVICE" || true

echo
echo "==> Health tekshiruvi:"
curl -fsS http://127.0.0.1:3001/health && echo
echo "==> Tayyor. Loglar: journalctl -u $SERVICE -f"
