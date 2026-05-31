# CryptoAttack Realtime Dashboard

Low-latency Socket.IO collector and browser dashboard for CryptoAttack alerts.

The CryptoAttack API key is used only by the Node.js backend. Browsers receive normalized dashboard events from the backend over REST and SSE, and never connect directly to CryptoAttack.

## Features

- Two CryptoAttack Socket.IO clients: main endpoint plus fast Japan endpoint.
- In-memory ring buffers with TTL-based deduplication.
- Conservative normalization and routing for listings, delistings, buy top lists, OI gainers, OI alerts, and raw/unclassified debugging.
- SSE stream for immediate browser updates with REST snapshot, status, health, and event history endpoints.
- Mock mode for local live development without an API key.
- Optional dashboard auth token for API and SSE requests.
- Raw event preservation with asynchronous NDJSON logging.
- Daily exchange symbol cache for browsing public spot/perpetual listings by exchange.
- React, Vite, TypeScript, and Tailwind dashboard with pause/resume, highlighting, sound, notifications, and copy-coin actions.

## Architecture Summary

```text
CryptoAttack Socket.IO
  -> Node.js Fastify collector
  -> normalizer + dedupe + in-memory event store
  -> REST snapshots/status + SSE stream
  -> React dashboard
```

SSE is used because the UI is one-way real-time display. There is no browser-to-CryptoAttack connection and no API key exposure to frontend code.

## Setup

```bash
nvm install
nvm use
corepack enable
corepack prepare pnpm@9.15.4 --activate
pnpm install
cp .env.example .env
```

Use Node.js 24.x. The repository includes `.nvmrc`, `.node-version`, and `engine-strict=true` so dependency installation fails on unsupported Node versions.

## Environment Variables

All public variables are shown in `.env.example`.

Required for real CryptoAttack mode:

```bash
CRYPTOATTACK_API_KEY=CryptoAttack-your-real-key
MOCK_CRYPTOATTACK=false
```

Useful local mock mode:

```bash
MOCK_CRYPTOATTACK=true
CRYPTOATTACK_API_KEY=
```

Optional dashboard auth:

```bash
DASHBOARD_AUTH_ENABLED=true
DASHBOARD_AUTH_TOKEN=replace-with-a-dashboard-token
DASHBOARD_ADMIN_TOKEN=replace-with-a-separate-admin-token
```

When auth is enabled, pass the token as `?token=...` in the dashboard URL or set `VITE_DASHBOARD_AUTH_TOKEN` for local frontend development.

The admin token is separate from the dashboard token and is required for destructive storage reset routes.

Do not ship `VITE_DASHBOARD_AUTH_TOKEN` in production builds: Vite embeds it in browser JavaScript. Prefer same-origin backend serving with `DASHBOARD_AUTH_ENABLED=true`, a long random `DASHBOARD_AUTH_TOKEN`, HTTPS at the reverse proxy, and server-side token handling where possible.

Optional exchange-symbol cache:

```bash
EXCHANGE_SYMBOL_CACHE_ENABLED=true
EXCHANGE_SYMBOL_REFRESH_UTC_TIME=00:05
EXCHANGE_SYMBOL_REFRESH_ON_START=true
```

The backend fetches public symbol lists from Binance, Bybit, OKX, and Coinbase, persists them to `EXCHANGE_SYMBOL_CACHE_PATH`, and refreshes once per day at the configured UTC time.

Optional local TimescaleDB storage:

```bash
DATABASE_STORAGE_ENABLED=false
DATABASE_URL=postgres://cryptoattack:cryptoattack@127.0.0.1:5432/cryptoattack
DATABASE_SSL=false
DATABASE_POOL_MAX=10
DATABASE_REQUIRED_ON_START=false
DATABASE_MIGRATIONS_ON_START=false
DATABASE_STATEMENT_TIMEOUT_MS=5000
DATABASE_WRITE_QUEUE_MAX=10000
DATABASE_WRITE_MAX_RETRIES=3
DATABASE_WRITE_RETRY_BASE_MS=250
DATABASE_WRITE_RETRY_MAX_MS=5000
DATABASE_WRITE_DRAIN_TIMEOUT_MS=10000
RAW_EVENTS_RETENTION_DAYS=30
TIMESCALE_COMPRESSION_ENABLED=false
```

Storage is disabled by default, so tests, mock mode, and live SSE continue to run without Postgres. When `DATABASE_STORAGE_ENABLED=true`, `DATABASE_URL` must be a valid `postgres://` or `postgresql://` URL or the server fails before startup without printing the URL. In production, set `DATABASE_REQUIRED_ON_START=true` so the app cannot launch with Postgres unavailable.

The Docker Compose Postgres credentials in `.env.example` are local-only conveniences. Change `POSTGRES_PASSWORD`, `DATABASE_URL`, and all dashboard/API tokens before exposing any service beyond localhost.

Timescale retention policies are applied for `raw_events` when storage is enabled. Compression policies are added only when `TIMESCALE_COMPRESSION_ENABLED=true`; test backup and restore before enabling aggressive retention.

## Storage Setup

1. Start TimescaleDB with `docker compose up -d postgres`.
2. Enable storage with `DATABASE_STORAGE_ENABLED=true` and a local `DATABASE_URL`.
3. Run `DATABASE_STORAGE_ENABLED=true pnpm --filter @cryptoattack/server db:migrate`.
4. Check `DATABASE_STORAGE_ENABLED=true pnpm --filter @cryptoattack/server db:status`.
5. Optional: backfill `data/raw-events.ndjson` with `db:backfill`.

Storage is fail-open for the live dashboard after startup: in-memory buffers and SSE continue if async writes fail, and `/api/storage/status` reports queue depth, failed writes, migrations, and table-size estimates. Rows are durable after Postgres confirms the write; queued in-process write jobs are not durable across a process crash.

## Local TimescaleDB

Start the local Postgres 16 compatible TimescaleDB service:

```bash
docker compose up -d postgres
docker compose ps
```

Run migrations:

```bash
DATABASE_STORAGE_ENABLED=true pnpm --filter @cryptoattack/server db:migrate
DATABASE_STORAGE_ENABLED=true pnpm --filter @cryptoattack/server db:status
```

Backfill existing raw NDJSON logs into Postgres without printing raw event text:

```bash
DATABASE_STORAGE_ENABLED=true pnpm --filter @cryptoattack/server db:backfill -- --path ./data/raw-events.ndjson --limit 1000
```

The backfill command is idempotent and uses the same repository path as live durable ingestion. Omit `--limit` to scan the full file.

Use the same storage env vars when starting the server with durable storage enabled:

```bash
DATABASE_STORAGE_ENABLED=true pnpm --filter @cryptoattack/server dev
```

Local reset is destructive and guarded to localhost-style database hosts only:

```bash
DATABASE_STORAGE_ENABLED=true pnpm --filter @cryptoattack/server db:reset
DATABASE_STORAGE_ENABLED=true pnpm --filter @cryptoattack/server db:migrate
```

Full Docker volume reset is also destructive:

```bash
docker compose down -v
docker compose up -d postgres
DATABASE_STORAGE_ENABLED=true pnpm --filter @cryptoattack/server db:migrate
```

## Production Storage Operations

Production checklist:

```bash
docker compose up -d postgres
DATABASE_STORAGE_ENABLED=true pnpm db:status
DATABASE_STORAGE_ENABLED=true pnpm db:migrate
DATABASE_STORAGE_ENABLED=true pnpm db:status
pnpm build
pnpm start
```

Keep `DATABASE_MIGRATIONS_ON_START=false` in production unless you explicitly want startup to run schema changes. Back up before migrations and before shortening any retention window.

Health checks:

```bash
curl "http://127.0.0.1:3001/api/storage/status"
```

`/api/storage/status` reports DB connectivity, latest migration version, writer queue depth, failed writes, last successful write, and cheap table-size estimates.

Safe logical backup with `pg_dump`:

```bash
mkdir -p backups/postgres
chmod 700 backups/postgres
BACKUP_FILE="backups/postgres/cryptoattack-$(date -u +%Y%m%dT%H%M%SZ).dump"

docker compose exec -T postgres pg_dump \
  -U "$POSTGRES_USER" \
  -d "$POSTGRES_DB" \
  --format=custom \
  --compress=9 \
  --no-owner \
  --no-acl \
  > "$BACKUP_FILE"

chmod 600 "$BACKUP_FILE"
pg_restore --list "$BACKUP_FILE" >/dev/null
```

Restore from a custom-format dump. This is destructive to the target database, so stop app writers first:

```bash
pm2 stop cryptoattack-dashboard
docker compose up -d postgres

docker compose exec -T postgres psql -U "$POSTGRES_USER" -d postgres <<'SQL'
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = 'cryptoattack';

DROP DATABASE IF EXISTS cryptoattack;
CREATE DATABASE cryptoattack OWNER cryptoattack;
SQL

pg_restore --clean --if-exists --no-owner --no-acl --dbname "$DATABASE_URL" "$BACKUP_FILE"
DATABASE_STORAGE_ENABLED=true pnpm db:status
pm2 start cryptoattack-dashboard
```

Cold Docker volume backup is secondary to `pg_dump` and should only be taken while Postgres is stopped:

```bash
pm2 stop cryptoattack-dashboard
docker compose stop postgres
mkdir -p backups/volumes
chmod 700 backups/volumes

docker run --rm \
  -v cryptoattack_cryptoattack-postgres:/volume:ro \
  -v "$PWD/backups/volumes:/backup" \
  alpine \
  tar -czf "/backup/cryptoattack-postgres-volume-$(date -u +%Y%m%dT%H%M%SZ).tar.gz" -C /volume .

docker compose up -d postgres
pm2 start cryptoattack-dashboard
```

Treat database dumps, Docker volume backups, raw NDJSON logs, `DATABASE_URL`, `POSTGRES_PASSWORD`, `CRYPTOATTACK_API_KEY`, `DASHBOARD_AUTH_TOKEN`, and `DASHBOARD_ADMIN_TOKEN` as secrets. Do not commit them or paste them into logs, issues, PRs, or screenshots.

## Running Locally

### Mock Mode

```bash
MOCK_CRYPTOATTACK=true pnpm dev
```

Open:

```text
http://localhost:5173
```

The backend runs on `http://localhost:3001`. The frontend defaults to same-origin API calls; during Vite development, `/api` and `/health` are proxied to the backend. Set `VITE_API_BASE_URL` only when the API is hosted on a separate origin.

### Real CryptoAttack Mode

```bash
cp .env.example .env
```

Set:

```bash
CRYPTOATTACK_API_KEY=CryptoAttack-your-real-key
MOCK_CRYPTOATTACK=false
```

Then run:

```bash
pnpm dev
```

The backend creates exactly two CryptoAttack Socket.IO clients:

- `https://wss.cryptoattack.net` for `cex_alerts/all_derivatives_top`, `cex_alerts/all_spot_top`, `market_data/top_oi`, and `signals/oi_alerts`.
- `https://wss2.cryptoattack.net` for `cex_alerts/listings` and, when enabled, `cex_alerts/delistings`.

It refreshes active CryptoAttack subscriptions every `CRYPTOATTACK_RESUBSCRIBE_INTERVAL_MS` milliseconds to recover category streams that go stale while the socket remains connected.

If `MOCK_CRYPTOATTACK=false` and `CRYPTOATTACK_API_KEY` is empty, the backend fails fast with a clear startup error.

## Safe Real-Mode Smoke

Use this when you have a local CryptoAttack API key and want to validate live connectivity before capturing raw samples.

Set:

```bash
MOCK_CRYPTOATTACK=false
CRYPTOATTACK_API_KEY=CryptoAttack-your-real-key
SERVER_HOST=127.0.0.1
LOG_RAW_EVENTS=false
REPLAY_RAW_EVENTS_ON_START=false
EXCHANGE_SYMBOL_CACHE_ENABLED=false
```

Then run just the backend first:

```bash
pnpm --filter @cryptoattack/server dev
```

Check:

```bash
curl -s http://127.0.0.1:3001/api/status
curl -N http://127.0.0.1:3001/api/stream
```

Validate `sockets.main`, `sockets.fast`, subscription attempts, `lastNewsAt`, counters, and latency before turning raw logging back on for sample collection.

## Build

```bash
pnpm build
```

## Running Production

```bash
pnpm build
pnpm start
```

`pnpm start` starts the Fastify backend. If `apps/web/dist` exists, the backend serves the built frontend in addition to API and SSE routes. When the backend serves the built frontend, leave `VITE_API_BASE_URL` unset so the browser calls the same origin.

Recommended production settings:

```bash
NODE_ENV=production
MOCK_CRYPTOATTACK=false
CRYPTOATTACK_API_KEY=CryptoAttack-your-real-key
SERVER_HOST=127.0.0.1
SERVER_PORT=3001
WEB_ORIGIN=https://your-dashboard.example.com
DASHBOARD_AUTH_ENABLED=true
DASHBOARD_AUTH_TOKEN=replace-with-a-long-random-token
DASHBOARD_ADMIN_TOKEN=replace-with-a-different-long-random-token
DATABASE_STORAGE_ENABLED=true
DATABASE_REQUIRED_ON_START=true
DATABASE_MIGRATIONS_ON_START=false
LOG_RAW_EVENTS=true
RAW_EVENT_LOG_PATH=/var/lib/cryptoattack/data/raw-events.ndjson
```

For the full Ubuntu 24.04 + Caddy + PM2 + local TimescaleDB runbook, use `docs/production-deployment.md`.

## PM2 Production Option

Install PM2 on the VPS and start the built backend:

```bash
pnpm build
pm2 startOrReload ecosystem.config.cjs --env production
pm2 save
pm2 status
```

Useful PM2 commands:

```bash
pm2 logs cryptoattack-dashboard
pm2 restart cryptoattack-dashboard
pm2 stop cryptoattack-dashboard
```

## VPS And Reverse Proxy Notes

- Use an always-on VPS for low-latency alert delivery.
- Avoid serverless platforms for this collector because Socket.IO and SSE need long-lived connections.
- For listings and delistings, a Japan or Tokyo VPS may reduce latency to `https://wss2.cryptoattack.net`.
- Measure real latency from normalized events using `receivedAt - sourceTime`; the backend exposes latest and average latency in `/api/status`.
- Run the backend behind Caddy, Nginx, or another reverse proxy if exposing it publicly.
- `deploy/caddy/Caddyfile.example` contains the recommended Caddy HTTPS proxy.
- Keep SSE proxy buffering disabled. For Nginx, use `proxy_buffering off` on the `/api/stream` route.
- Terminate HTTPS at the reverse proxy and forward to the backend on `127.0.0.1:3001`.

## Retention

- `RAW_EVENTS_RETENTION_DAYS` controls raw event history.
- Retention policies are applied only when storage is enabled.
- Compression policies are applied only when `TIMESCALE_COMPRESSION_ENABLED=true`.
- Back up before lowering retention windows, because deleted chunks are not recoverable from the database itself.

## API

- `GET /health`
- `GET /api/status`
- `GET /api/storage/status`
- `GET /api/snapshot`
- `GET /api/events?feedKey=listings&limit=50`
- `GET /api/exchange-symbols?exchange=binance&market=spot&search=btc`
- `POST /api/exchange-symbols/refresh`
- `GET /api/spot-performance?exchange=binance&limit=10`
- `GET /api/binance/open-interest?coin=BTC&period=5m&limit=12`
- `GET /api/stream`
- `DELETE /api/storage/events`
- `DELETE /api/storage/history/older-than-7-days`
- `DELETE /api/storage/all-data`

Protected API routes require a dashboard token only when `DASHBOARD_AUTH_ENABLED=true`. `/health` remains public for uptime checks.
Destructive storage maintenance routes also require `DASHBOARD_ADMIN_TOKEN` through `x-dashboard-admin-token` or `adminToken`. The seven-day cleanup keeps recent data and deletes older durable history rows plus old raw NDJSON log lines.

API curl examples:

```bash
curl "http://127.0.0.1:3001/api/storage/status"
curl "http://127.0.0.1:3001/api/events?feedKey=listings&limit=50"
curl "http://127.0.0.1:3001/api/exchange-symbols?exchange=binance&market=spot&search=btc"
```

With dashboard auth enabled:

```bash
curl -H "Authorization: Bearer $DASHBOARD_AUTH_TOKEN" "http://127.0.0.1:3001/api/storage/status"
curl -N "http://127.0.0.1:3001/api/stream?token=$DASHBOARD_AUTH_TOKEN"
```

The SSE stream emits `snapshot`, `event`, `status`, `spot-performance`, `storage-status`, and `heartbeat` events.

## Raw NDJSON Logs

When `LOG_RAW_EVENTS=true`, the backend appends raw events asynchronously to `RAW_EVENT_LOG_PATH`.

Inspect recent raw samples:

```bash
pnpm start
```

Open `data/raw-events.ndjson` with your preferred editor or log tooling. Each line contains the raw payload, normalized event ids, feed keys, and server receive time.

Raw log write failures are caught and logged as warnings. They do not block in-memory storage or SSE delivery.

## Security Notes

- Never put a real CryptoAttack API key in committed files.
- `.env`, `data/`, and `backups/` are ignored by git.
- `.env.example` contains placeholders only.
- The frontend has no `CRYPTOATTACK_API_KEY` reference and receives normalized event data only.
- API responses do not include the CryptoAttack API key.
- The backend redacts API-key-shaped logger fields.
- React renders event `plainText` and extracts safe `http` or `https` links separately; it does not use `dangerouslySetInnerHTML` for CryptoAttack event HTML.
- If `DASHBOARD_AUTH_ENABLED=true`, API and SSE requests require `DASHBOARD_AUTH_TOKEN` by query token or `Authorization: Bearer` header where supported.
- Destructive storage reset routes require the separate `DASHBOARD_ADMIN_TOKEN`; the dashboard hides reset controls until an admin token is entered locally.
- Query-string SSE tokens can appear in browser history, reverse-proxy logs, and screenshots. Use HTTPS, keep logs private, and rotate tokens if exposed.
- `VITE_DASHBOARD_AUTH_TOKEN` is for local Vite development only because it is embedded in frontend assets.

## Reliability Notes

- Socket.IO clients use `transports: ['websocket']` and automatic reconnect.
- Subscriptions are sent after CryptoAttack emits `connected`.
- Reconnects reset subscription generation and resubscribe without duplicate subscribe storms.
- Browser EventSource reconnects SSE automatically.
- Malformed CryptoAttack payloads become `raw_unclassified` events and do not crash the server.
- Mock mode does not connect to CryptoAttack and can be used for local and deployment smoke tests.

## Troubleshooting

No live data in real mode:

- Check `CRYPTOATTACK_API_KEY` and confirm `MOCK_CRYPTOATTACK=false`.
- Check backend logs for `connect_error` or `disconnect` messages.
- Call `GET /api/status` and inspect `sockets.main`, `sockets.fast`, subscription attempts, and `lastNewsAt`.
- Confirm the CryptoAttack account has access to the requested chapters and categories.
- In real mode, leave `REPLAY_RAW_EVENTS_ON_START=false` unless you intentionally want to seed old raw-log events. Otherwise old mock/replay listing rows can look like live listings.

Dashboard works in mock mode but not real mode:

- Confirm outbound connectivity to `https://wss.cryptoattack.net` and `https://wss2.cryptoattack.net`.
- Confirm the backend process is running on an always-on host, not a serverless runtime.
- Check whether a reverse proxy is interrupting long-lived SSE connections.

Delistings never appear:

- Keep `ENABLE_DELISTINGS=true` to subscribe to the documented delistings category.
- Confirm the CryptoAttack account has access to `cex_alerts/delistings` on `wss2`.

Top buyer/OI widgets empty:

- Server-side filters for buy, 5 minute interval, gainers, thresholds, and exchanges are undocumented.
- This dashboard subscribes to the category and classifies locally from `filters` and text.
- Check `raw_unclassified` and `data/raw-events.ndjson` for real payload samples that need parser support.

Browser gets `401`:

- If dashboard auth is enabled, pass `?token=your-dashboard-token` or configure frontend auth token for local development.
- Confirm `DASHBOARD_AUTH_TOKEN` matches exactly.

SSE connects but updates stall:

- Check browser network tools for `/api/stream` reconnects.
- Ensure reverse proxy buffering is disabled for SSE.
- Confirm `/api/status` counters and `lastEventTime` are moving.

## Known CryptoAttack API Uncertainties

- CryptoAttack documents Socket.IO access, not raw WebSocket access.
- Category-specific subscribe filters such as buy, sell, 5 minute interval, gainers, exchanges, and thresholds are not documented.
- This project subscribes only with confirmed `chapter` and `category` fields, then classifies events server-side from `filters` and text.
- `cex_alerts/delistings` and `signals/oi_alerts` are implemented from the documented category list.
- If CryptoAttack confirms filter payload syntax later, add fields through the backend subscribe-extra config path after documenting the exact provider schema.
