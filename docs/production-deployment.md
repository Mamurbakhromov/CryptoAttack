# Production Deployment

This runbook is for a single Ubuntu 24.04 VPS running CryptoAttack from `/opt/cryptoattack/current` on `main`.

Production defaults:

- Node 24 LTS with `pnpm@9.15.4`.
- Caddy owns public `80/443` and proxies to `127.0.0.1:3001`.
- PM2 runs one backend process because ingestion queues are in-process.
- TimescaleDB runs locally through Docker Compose and binds Postgres to `127.0.0.1`.
- `DATABASE_MIGRATIONS_ON_START=false`; migrations run explicitly during deploy.
- `DASHBOARD_AUTH_TOKEN` is for dashboard/API reads. `DASHBOARD_ADMIN_TOKEN` is separate and required for destructive storage reset routes.
- Durable event storage is enabled.

## 1. Server Bootstrap

Point DNS for the dashboard domain at the VPS before enabling Caddy HTTPS.

Install system packages:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg git ufw
```

Install Docker from Docker's apt repository:

```bash
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}") stable" | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER"
```

Log out and back in so the Docker group membership applies.

Install Caddy from the official package repository:

```bash
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf "https://dl.cloudsmith.io/public/caddy/stable/gpg.key" | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf "https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt" | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update
sudo apt-get install -y caddy
```

Install Node 24, pnpm, and PM2:

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs
corepack enable
corepack prepare pnpm@9.15.4 --activate
sudo npm install -g pm2
```

Create runtime directories:

```bash
sudo install -d -o "$USER" -g "$USER" -m 750 /opt/cryptoattack
sudo install -d -o "$USER" -g "$USER" -m 750 /var/lib/cryptoattack
sudo install -d -o "$USER" -g "$USER" -m 750 /var/lib/cryptoattack/data
sudo install -d -o "$USER" -g "$USER" -m 700 /var/backups/cryptoattack/postgres
```

Open only SSH, HTTP, and HTTPS publicly:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

## 2. First Launch

Clone the repository after this branch has been merged to `main`:

```bash
git clone <repo-url> /opt/cryptoattack/current
cd /opt/cryptoattack/current
git checkout main
```

Create production env:

```bash
cp deploy/env.production.example .env
chmod 600 .env
```

Generate secrets:

```bash
openssl rand -base64 48 | tr "+/" "-_" | tr -d "="
openssl rand -base64 48 | tr "+/" "-_" | tr -d "="
openssl rand -hex 32
```

Edit `.env` and replace every placeholder. Use different values for:

- `CRYPTOATTACK_API_KEY`
- `DASHBOARD_AUTH_TOKEN`
- `DASHBOARD_ADMIN_TOKEN`
- `POSTGRES_PASSWORD`
- the password inside `DATABASE_URL`
- `WEB_ORIGIN=https://your-real-domain`

Keep these production flags:

```bash
NODE_ENV=production
MOCK_CRYPTOATTACK=false
SERVER_HOST=127.0.0.1
DASHBOARD_AUTH_ENABLED=true
DATABASE_STORAGE_ENABLED=true
DATABASE_REQUIRED_ON_START=true
DATABASE_MIGRATIONS_ON_START=false
TIMESCALE_COMPRESSION_ENABLED=false
```

Start TimescaleDB:

```bash
docker compose up -d postgres
docker compose ps
```

Install, verify, and build:

```bash
nvm install
nvm use
corepack enable
corepack prepare pnpm@9.15.4 --activate
pnpm install --frozen-lockfile
pnpm audit --audit-level moderate
pnpm test
pnpm typecheck
pnpm build
```

Run migrations explicitly:

```bash
DATABASE_STORAGE_ENABLED=true pnpm db:status
DATABASE_STORAGE_ENABLED=true pnpm db:migrate
DATABASE_STORAGE_ENABLED=true pnpm db:verify
```

Start the app with PM2:

```bash
pm2 startOrReload ecosystem.config.cjs --env production
pm2 save
pm2 status
```

Install Caddy config:

```bash
sudo cp deploy/caddy/Caddyfile.example /etc/caddy/Caddyfile
sudo sed -i "s/cryptoattack.example.com/your-real-domain/g" /etc/caddy/Caddyfile
sudo sed -i "s/ops@example.com/your-email@example.com/g" /etc/caddy/Caddyfile
sudo caddy fmt --overwrite /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Run production checks:

```bash
./scripts/production/preflight.sh
./scripts/production/smoke.sh
```

## 3. Repeat Deploy

Deploy only from `main`:

```bash
cd /opt/cryptoattack/current
./scripts/production/deploy.sh
```

The deploy script:

- records the previous SHA in `/var/lib/cryptoattack/deploy-previous-sha`;
- fetches and fast-forwards `origin/main`;
- runs preflight checks;
- starts local Postgres if needed;
- creates and verifies a custom-format Postgres dump;
- runs install, dependency audit, tests, typecheck, and build;
- checks for migration checksum mismatches, runs migrations, then verifies no migrations remain pending;
- reloads PM2;
- runs HTTP/API/SSE smoke checks;
- saves PM2 state.

The script intentionally does not auto-rollback database schema if deploy smoke fails. Use the backup file only after deciding that a destructive database restore is required.

## 4. Manual Backup

Create a verified logical dump:

```bash
cd /opt/cryptoattack/current
./scripts/production/backup-postgres.sh
```

The backup lands in `/var/backups/cryptoattack/postgres` with `600` permissions and is checked with `pg_restore --list`.

Copy the dump offsite after it is created. Examples:

```bash
rsync -av --chmod=600 /var/backups/cryptoattack/postgres/cryptoattack-*.dump backup-user@backup-host:/secure/cryptoattack/
aws s3 cp /var/backups/cryptoattack/postgres/cryptoattack-YYYYMMDDTHHMMSSZ.dump s3://your-private-bucket/cryptoattack/
```

Do not rely on local-only backups as the only disaster recovery path.

## 5. Restore Database

Restoring a dump is destructive. Stop app writers first:

```bash
cd /opt/cryptoattack/current
pm2 stop cryptoattack-dashboard
docker compose up -d postgres
```

Set the backup path:

```bash
BACKUP_FILE=/var/backups/cryptoattack/postgres/cryptoattack-YYYYMMDDTHHMMSSZ.dump
```

Drop and recreate the database, then restore:

```bash
set -a
. ./.env
set +a

docker compose exec -T postgres psql -U "$POSTGRES_USER" -d postgres -v db="$POSTGRES_DB" <<'SQL'
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = :'db';
DROP DATABASE IF EXISTS :"db";
CREATE DATABASE :"db";
SQL

cat "$BACKUP_FILE" | docker compose exec -T postgres pg_restore \
  -U "$POSTGRES_USER" \
  -d "$POSTGRES_DB" \
  --no-owner \
  --no-acl

DATABASE_STORAGE_ENABLED=true pnpm db:status
pm2 startOrReload ecosystem.config.cjs --env production
./scripts/production/smoke.sh
pm2 save
```

After restore, inspect `/api/storage/status`. Storage health may be `healthy` immediately, or it may show as waiting for fresh live data.

## 6. Code Rollback

Rollback code to the previous recorded SHA:

```bash
cd /opt/cryptoattack/current
./scripts/production/rollback.sh
```

Rollback to a specific SHA:

```bash
./scripts/production/rollback.sh <sha>
```

The rollback script checks out the target SHA, installs locked dependencies, rebuilds, reloads PM2, runs smoke checks, and saves PM2. It does not roll back database schema or data.

Database rollback must be a deliberate restore from a verified pre-deploy dump.

## 7. Smoke Checks

The script performs these checks:

```bash
curl https://your-real-domain/health
curl -H "Authorization: Bearer $DASHBOARD_AUTH_TOKEN" https://your-real-domain/api/status
curl -H "Authorization: Bearer $DASHBOARD_AUTH_TOKEN" https://your-real-domain/api/storage/status
timeout 20s curl -N -H "Authorization: Bearer $DASHBOARD_AUTH_TOKEN" https://your-real-domain/api/stream
```

If using the browser dashboard, enter the dashboard token in the URL or local development configuration as before. Destructive storage reset controls stay hidden until a separate admin token is entered locally in the dashboard.

## 8. Admin Routes

Read routes use the dashboard token when `DASHBOARD_AUTH_ENABLED=true`.

Destructive maintenance routes require both:

- dashboard authorization;
- `DASHBOARD_ADMIN_TOKEN` via `x-dashboard-admin-token` or `adminToken` query parameter.

Routes:

- `DELETE /api/storage/events`
- `DELETE /api/storage/history/older-than-7-days`
- `DELETE /api/storage/all-data`

Prefer the dashboard UI admin-token unlock for manual maintenance. The seven-day cleanup button deletes durable history and raw log lines older than seven days while keeping recent data. Do not put admin tokens in shared screenshots, URLs, shell history, or reverse-proxy logs.

## 9. Troubleshooting

Preflight fails on Node:

- Run `nvm install && nvm use`, or install NodeSource 24.x, then re-run `corepack prepare pnpm@9.15.4 --activate`.

Deploy fails on dependency audit:

- Run `pnpm audit --audit-level moderate` locally on Node 24 and update or override the affected dependency before deploying.

Deploy fails on migration verification:

- Run `DATABASE_STORAGE_ENABLED=true pnpm db:status`.
- If output contains `checksum-mismatch`, stop and restore the original migration file rather than editing production `schema_migrations`.
- If migrations are pending after `db:migrate`, inspect the migration error before restarting PM2.

Preflight fails on `.env` permissions:

- Run `chmod 600 /opt/cryptoattack/current/.env`.

Postgres is unavailable:

- Check `docker compose ps`.
- Check `docker compose logs --tail=100 postgres`.
- Confirm `DATABASE_URL` password matches `POSTGRES_PASSWORD`.
- Confirm Postgres binds to `127.0.0.1:${POSTGRES_PORT}` only.

Migrations are pending after deploy:

- Run `DATABASE_STORAGE_ENABLED=true pnpm db:migrate`.
- Re-check with `DATABASE_STORAGE_ENABLED=true pnpm db:status`.
- Do not enable `DATABASE_MIGRATIONS_ON_START` in production unless you intentionally want startup to mutate schema.

Caddy HTTPS does not come up:

- Confirm DNS points to the VPS.
- Run `sudo caddy validate --config /etc/caddy/Caddyfile`.
- Run `sudo journalctl -u caddy -n 100 --no-pager`.
- Confirm UFW allows `80/tcp` and `443/tcp`.

SSE connects then stalls:

- Confirm `/api/status` counters and `lastEventTime` are moving.
- Confirm Caddy uses `flush_interval -1`.
- Check `pm2 logs cryptoattack-dashboard`.

PM2 process dies after restart:

- Run `pm2 logs cryptoattack-dashboard`.
- Confirm `.env` has `DATABASE_REQUIRED_ON_START=true` only when Postgres is healthy.
- Confirm `CRYPTOATTACK_API_KEY` is present and `MOCK_CRYPTOATTACK=false`.

## References

- [Node release schedule](https://github.com/nodejs/release)
- [Docker Engine on Ubuntu](https://docs.docker.com/engine/install/ubuntu/)
- [Caddy install docs](https://caddyserver.com/docs/install)
- [Caddy reverse_proxy docs](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)
- [PM2 process management](https://pm2.io/docs/runtime/guide/process-management/)
- [PM2 ecosystem file docs](https://pm2.io/docs/runtime/reference/ecosystem-file/)
- [TimescaleDB Docker tags](https://hub.docker.com/r/timescale/timescaledb/tags)
