# Durable Storage And Bull/Bear Scoring Architecture

## Purpose

This document describes the durable Postgres + TimescaleDB storage and transparent Bull/Bear scoring architecture. The durable path is optional and runs beside the current live dashboard behavior.

The current system remains the low-latency hot path:

```text
CryptoAttack Socket.IO
  -> normalizer/parser
  -> EventStore in-memory buffers + dedupe
  -> REST snapshot + SSE stream
  -> React dashboard
```

The new system adds durable storage and scoring beside that path:

```text
CryptoAttack Socket.IO
  -> normalizer/parser
  -> EventStore in-memory buffers + dedupe
  -> SSE live dashboard
        |
        +-> async database writer
              -> TimescaleDB hypertables
              -> scoring scheduler/workers
              -> score snapshots + evidence
              -> REST/SSE score APIs
              -> Scores dashboard
```

## Non-Negotiable Constraints

- The database must not block live in-memory storage or SSE delivery.
- Raw CryptoAttack payloads must be preserved without exposing API keys.
- Mock mode must keep working without Postgres.
- Real mode must still reconnect, resubscribe, and stream events when Postgres is unavailable.
- CryptoAttack API keys remain backend-only and must not appear in SQL rows, API responses, logs, screenshots, or frontend code.
- Use Postgres + TimescaleDB with explicit SQL migrations. Do not rely on implicit ORM schema generation.
- Do not assume undocumented CryptoAttack subscribe filters.
- Keep the existing feed keys and current UI behavior while adding historical APIs and Scores UI.

## Design Goals

- Durable historical event storage for queries, backfills, analytics, and parser regression samples.
- Fast recent-event queries using Timescale hypertables, compression, and retention policies.
- Transparent Bull/Bear scoring with explainable score evidence per coin and per calculation window.
- Efficient Top 10 Bull, Top 10 Bear, Rising Fast, Market Regime, Score Health, and coin-detail views.
- Reproducible score versions so rule changes can be deployed, compared, and backfilled safely.
- Operationally simple local setup through Docker Compose and SQL migrations.

## Storage Principles

- Store raw provider payloads once per provider event in `raw_events`.
- Store normalized routed events separately in `normalized_events`, because one raw payload can produce multiple feed events.
- Store parsed row-level entries in `event_entries`, because most scoring inputs are entry-level signals.
- Store score outputs in immutable-ish score tables keyed by score version, coin, and bucket time.
- Store score evidence separately so every Bull/Bear point can be explained in UI.
- Keep current in-memory `EventStore` as the live-serving source during phase 1 and 2. Historical APIs read from Postgres only when enabled.
- Prefer append-only writes for provider events and score evidence. Correct with replacement by deterministic keys when backfilling or recalculating.

## Database Technology

- Postgres 16 or newer.
- TimescaleDB 2.x extension enabled in the application database.
- `jsonb` for raw payloads and parser metadata.
- `numeric` for financial values where precision matters.
- `double precision` for derived scores and percent-like values.
- `timestamptz` for all event and bucket times.
- Explicit SQL migrations under `apps/server/migrations` or `apps/server/src/db/migrations`.

Recommended application packages:

- `pg` for direct Postgres access.
- `node-pg-migrate` or a small migration runner that records applied migration filenames in `schema_migrations`.
- Optional later: `pg-boss` or BullMQ only if a single-process async worker is no longer enough. The first implementation should use an in-process queue plus durable replay from Postgres to avoid adding Redis.

## Environment Variables

Primary storage and scoring variables:

```bash
DATABASE_URL=postgres://cryptoattack:cryptoattack@127.0.0.1:5432/cryptoattack
DATABASE_SSL=false
DATABASE_POOL_MAX=10
DATABASE_STORAGE_ENABLED=false
DATABASE_MIGRATIONS_ON_START=false
DATABASE_STATEMENT_TIMEOUT_MS=5000
DATABASE_WRITE_QUEUE_MAX=10000
DATABASE_WRITE_MAX_RETRIES=3
DATABASE_WRITE_RETRY_BASE_MS=250
DATABASE_WRITE_RETRY_MAX_MS=5000
DATABASE_WRITE_DRAIN_TIMEOUT_MS=10000
RAW_EVENTS_RETENTION_DAYS=30
PRICE_TICKS_RETENTION_DAYS=180
SCORE_SNAPSHOTS_RETENTION_DAYS=365
TIMESCALE_COMPRESSION_ENABLED=false
PRICE_COLLECTION_ENABLED=false
FORWARD_RETURN_HORIZONS_MINUTES=5,15,60,240,1440
SCORES_ENABLED=false
SCORES_RECALC_INTERVAL_MS=30000
SCORES_VERSION=flow-v2
SCORES_WINDOWS_MINUTES=5,15,60,240,1440
```

Behavior:

- `DATABASE_STORAGE_ENABLED=false` keeps the current app behavior exactly unchanged.
- If `DATABASE_STORAGE_ENABLED=true`, startup verifies Postgres connectivity. After startup, async ingestion failures do not block in-memory dashboard updates or SSE delivery.
- `DATABASE_MIGRATIONS_ON_START=false` is safer for production. Migrations should usually run via an explicit command.
- `SCORES_ENABLED=false` lets durable storage ship before scoring.
- `SCORES_VERSION=flow-v2` uses the intraday spot-led flow model. Set `SCORES_VERSION=rule-v1` to run the legacy rule-based scorer.

## SQL Schema Overview

### Extensions And Migrations

```sql
create extension if not exists timescaledb;
create extension if not exists pgcrypto;

create table if not exists schema_migrations (
  version text primary key,
  applied_at timestamptz not null default now()
);
```

### Feed And Coin Dimensions

`feed_definitions` makes feed metadata queryable while preserving the TypeScript `feedKeys` source of truth.

```sql
create table feed_definitions (
  feed_key text primary key,
  chapter text,
  category text,
  display_name text not null,
  scoring_enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table coins (
  coin text primary key,
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  sources text[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb
);
```

Coin symbols should be uppercase canonical ticker symbols without quote assets. Pair-level values remain on event entries.

### Raw Provider Events

`raw_events` stores the provider payload and basic routing metadata. It is a hypertable because it grows continuously.

```sql
create table raw_events (
  raw_event_id uuid not null default gen_random_uuid(),
  provider text not null default 'cryptoattack',
  endpoint text not null,
  provider_event_id text,
  provider_chapter text not null,
  provider_category text not null,
  provider_timestamp timestamptz,
  received_at timestamptz not null,
  raw_payload jsonb not null,
  payload_hash bytea not null,
  normalized_event_ids text[] not null default '{}',
  feed_keys text[] not null default '{}',
  parser_status text not null default 'not_applicable',
  inserted_at timestamptz not null default now(),
  primary key (raw_event_id, received_at),
  unique (received_at, payload_hash)
);

select create_hypertable('raw_events', 'received_at', if_not_exists => true);

create index raw_events_feed_keys_idx on raw_events using gin (feed_keys);
create index raw_events_payload_gin_idx on raw_events using gin (raw_payload jsonb_path_ops);
create index raw_events_chapter_category_time_idx on raw_events (provider_chapter, provider_category, received_at desc);
```

Rationale:

- `payload_hash` deduplicates exact raw payloads during replay/backfill without trusting provider ids.
- `provider_event_id` is optional because CryptoAttack events can arrive without stable ids.
- `normalized_event_ids` and `feed_keys` help diagnose parser behavior quickly.

### Normalized Events

`normalized_events` stores the same normalized event shape currently streamed to the frontend, minus secrets.

```sql
create table normalized_events (
  event_id text not null,
  feed_key text not null references feed_definitions(feed_key),
  raw_event_id uuid,
  raw_received_at timestamptz,
  chapter text not null,
  category text not null,
  title text not null,
  plain_text text not null,
  html_text text not null,
  coins text[] not null default '{}',
  filters text[] not null default '{}',
  event_timestamp timestamptz not null,
  source_time_ms bigint,
  received_at timestamptz not null,
  latency_ms integer,
  severity text not null,
  endpoint text not null,
  parser_status text not null,
  amount_metric jsonb,
  normalized_payload jsonb not null,
  inserted_at timestamptz not null default now(),
  primary key (event_id, received_at)
);

select create_hypertable('normalized_events', 'received_at', if_not_exists => true);

create index normalized_events_feed_time_idx on normalized_events (feed_key, received_at desc);
create index normalized_events_raw_event_idx on normalized_events (raw_event_id, raw_received_at);
create index normalized_events_coins_idx on normalized_events using gin (coins);
create index normalized_events_filters_idx on normalized_events using gin (filters);
create index normalized_events_parser_status_idx on normalized_events (parser_status, received_at desc);
```

Rationale:

- Primary key includes `received_at` to satisfy Timescale hypertable uniqueness constraints.
- `raw_event_id` and `raw_received_at` are logical references to `raw_events`; use indexes instead of cross-hypertable foreign keys for safer Timescale migrations.
- `normalized_payload` is the complete API-safe normalized event JSON for future compatibility and audits.
- Important scalar fields are duplicated for indexes and fast query predicates.

### Parsed Event Entries

`event_entries` stores parsed table rows/signals from `NormalizedEvent.entries`.

```sql
create table event_entries (
  entry_id uuid default gen_random_uuid(),
  event_id text not null,
  received_at timestamptz not null,
  feed_key text not null references feed_definitions(feed_key),
  rank integer,
  coin text,
  pair text,
  exchange text,
  market text,
  direction text,
  interval_label text,
  amount_usd numeric,
  amount_asset text,
  buy_usd numeric,
  sell_usd numeric,
  delta_usd numeric,
  buy_sell_ratio double precision,
  volume_24h_usd numeric,
  volume_24h_asset text,
  percent double precision,
  price_usd numeric,
  price_change_percent double precision,
  oi_change_15m_percent double precision,
  oi_change_30m_percent double precision,
  followup_price_change_percent double precision,
  total_alerts integer,
  threshold text,
  href text,
  raw_line text not null,
  entry_payload jsonb not null,
  inserted_at timestamptz not null default now(),
  primary key (entry_id, received_at)
);

select create_hypertable('event_entries', 'received_at', if_not_exists => true);

create index event_entries_coin_time_idx on event_entries (coin, received_at desc) where coin is not null;
create index event_entries_feed_coin_time_idx on event_entries (feed_key, coin, received_at desc) where coin is not null;
create index event_entries_event_idx on event_entries (event_id, received_at);
create index event_entries_exchange_time_idx on event_entries (exchange, received_at desc) where exchange is not null;
create index event_entries_direction_time_idx on event_entries (direction, received_at desc);
```

Rationale:

- The scorer should primarily read `event_entries`, not reparse text.
- `entry_payload` keeps full parser output even when new fields are added later.
- `market` should be derived conservatively from feed/filter/exchange context. Unknown is allowed.

### Ingestion State And Dead Letters

```sql
create table ingestion_failures (
  failure_id uuid primary key default gen_random_uuid(),
  failed_at timestamptz not null default now(),
  stage text not null,
  event_id text,
  feed_key text,
  error_message text not null,
  payload jsonb,
  retry_count integer not null default 0,
  resolved_at timestamptz
);

create table ingestion_watermarks (
  source text primary key,
  last_processed_at timestamptz,
  last_processed_id text,
  updated_at timestamptz not null default now()
);
```

Use `ingestion_failures` for malformed database writes, not malformed CryptoAttack events. Malformed provider payloads still become `raw_unclassified` normalized events where possible.

## Score Schema

### Score Versions

```sql
create table score_versions (
  score_version text primary key,
  description text not null,
  config jsonb not null,
  active boolean not null default false,
  created_at timestamptz not null default now()
);
```

Only one score version should be active for the main dashboard. Historical versions can remain queryable for comparison and backtesting.

### Score Buckets

`score_buckets` stores the final per-coin result for a calculation bucket.

```sql
create table score_buckets (
  score_version text not null references score_versions(score_version),
  bucket_at timestamptz not null,
  window_minutes integer not null,
  coin text not null,
  bull_score double precision not null,
  bear_score double precision not null,
  net_score double precision not null,
  confidence_score double precision not null,
  event_count integer not null,
  evidence_count integer not null,
  dominant_signal text,
  market_regime text,
  rank_bull integer,
  rank_bear integer,
  rank_net integer,
  previous_net_score double precision,
  net_score_delta double precision,
  computed_at timestamptz not null default now(),
  primary key (score_version, bucket_at, window_minutes, coin)
);

select create_hypertable('score_buckets', 'bucket_at', if_not_exists => true);

create index score_buckets_top_bull_idx on score_buckets (score_version, bucket_at desc, bull_score desc);
create index score_buckets_top_bear_idx on score_buckets (score_version, bucket_at desc, bear_score desc);
create index score_buckets_rising_idx on score_buckets (score_version, bucket_at desc, net_score_delta desc);
create index score_buckets_coin_time_idx on score_buckets (coin, bucket_at desc);
```

### Score Evidence

`score_evidence` is the explainability layer. Every score contribution gets a row.

```sql
create table score_evidence (
  evidence_id uuid default gen_random_uuid(),
  score_version text not null,
  bucket_at timestamptz not null,
  window_minutes integer not null,
  coin text not null,
  event_id text,
  entry_id uuid,
  feed_key text not null,
  signal_key text not null,
  side text not null check (side in ('bull', 'bear', 'confidence')),
  points double precision not null,
  weight double precision not null,
  decay_multiplier double precision not null,
  value numeric,
  unit text,
  reason text not null,
  source_received_at timestamptz not null,
  evidence_payload jsonb not null default '{}'::jsonb,
  inserted_at timestamptz not null default now(),
  primary key (evidence_id, bucket_at)
);

select create_hypertable('score_evidence', 'bucket_at', if_not_exists => true);

create index score_evidence_coin_bucket_idx on score_evidence (score_version, coin, bucket_at desc);
create index score_evidence_signal_idx on score_evidence (signal_key, bucket_at desc);
create index score_evidence_event_idx on score_evidence (event_id);
```

### Market Regime Snapshots

```sql
create table market_regime_snapshots (
  score_version text not null references score_versions(score_version),
  bucket_at timestamptz not null,
  regime text not null,
  bull_count integer not null,
  bear_count integer not null,
  neutral_count integer not null,
  aggregate_bull_score double precision not null,
  aggregate_bear_score double precision not null,
  aggregate_net_score double precision not null,
  confidence_score double precision not null,
  computed_at timestamptz not null default now(),
  primary key (score_version, bucket_at)
);

select create_hypertable('market_regime_snapshots', 'bucket_at', if_not_exists => true);
```

Regime values:

- `risk_on`: broad high-confidence positive net scores.
- `risk_off`: broad high-confidence negative net scores.
- `mixed`: meaningful Bull and Bear clusters coexist.
- `thin_data`: too few recent events for confident classification.
- `neutral`: no strong direction.

### Score Health

```sql
create table score_health_snapshots (
  bucket_at timestamptz primary key,
  score_version text not null,
  db_lag_ms integer,
  oldest_pending_write_age_ms integer,
  scoring_lag_ms integer,
  source_event_count_5m integer not null,
  parsed_event_count_5m integer not null,
  parser_needs_sample_count_5m integer not null,
  scored_coin_count integer not null,
  evidence_count integer not null,
  failure_count_5m integer not null,
  status text not null,
  notes jsonb not null default '{}'::jsonb,
  computed_at timestamptz not null default now()
);

select create_hypertable('score_health_snapshots', 'bucket_at', if_not_exists => true);
```

## Ingestion Lifecycle

### Live Event Handling

Current live flow in `apps/server/src/index.ts` should remain semantically intact:

1. CryptoAttack client receives raw event.
2. `normalizeCryptoAttackEvent` creates zero or more `NormalizedEvent` objects.
3. `EventStore.addEvents` dedupes and stores in memory.
4. `EventStore` emits `event`; `SseHub` broadcasts it.
5. Raw NDJSON append remains asynchronous when enabled.
6. New durable writer receives only the successfully stored normalized events.

Proposed addition:

```text
store.addEvents(events)
  -> storedEvents
  -> appendRawEvent(raw, storedEvents)
  -> durableIngest.enqueue(raw, storedEvents)
```

`durableIngest.enqueue` must be non-blocking and bounded. If its memory queue is full, it should drop into a database-disabled/degraded state, record metrics, and keep live delivery running.

### Durable Writer

The first implementation should use an in-process batch writer:

- Queue items in memory after `EventStore.addEvents` succeeds.
- Flush every `DATABASE_WRITE_FLUSH_INTERVAL_MS` or when `DATABASE_WRITE_BATCH_SIZE` is reached.
- Use one transaction per batch.
- Insert raw event row with `on conflict do nothing` by `(received_at, payload_hash)`.
- Insert normalized events with `on conflict do nothing` by `(event_id, received_at)`.
- Insert entries with generated `entry_id` values.
- Upsert `coins` from normalized `coins` and parsed entry `coin` values.
- On database error, write a compact failure row if possible; otherwise log a redacted warning and continue.

Do not wait on this writer before emitting SSE.

### Backpressure Strategy

- Maintain a bounded memory queue, default 10,000 items.
- Expose queue length and oldest queued item age in `/api/status` when database support is enabled.
- If queue exceeds the max, switch database health to `degraded` and drop oldest durable-write queue items, not live events.
- Rely on raw NDJSON backfill for recovery if durable writes fall behind.
- Later, if multi-process ingestion is needed, replace the in-process queue with `pg-boss` or BullMQ. Keep the same `DurableIngest` interface.

### Backfill From NDJSON

Backfill should read existing `apps/server/data/raw-events.ndjson` without requiring live CryptoAttack connectivity.

Command shape:

```bash
pnpm --filter @cryptoattack/server db:backfill -- --path ./data/raw-events.ndjson --since 2026-05-01T00:00:00Z --batch-size 500
```

Backfill flow:

1. Read NDJSON line by line.
2. Parse `{ receivedAt, normalizedEventIds, feedKeys, raw }`.
3. Normalize `raw` again using current parser code and the stored `receivedAt` as `receivedAtMs` when available.
4. Insert raw, normalized, and entry rows using the same durable writer repository methods.
5. Use `payload_hash`, `event_id`, and `received_at` to make reruns idempotent.
6. Record progress in `ingestion_watermarks`.
7. Print counts only, never raw payloads or API keys.

Backfill modes:

- `validate`: parse and count without writing.
- `insert`: write missing rows.
- `rescore`: do not rewrite events; recalculate score buckets for a date range.

## Retention And Compression

Estimated current raw log volume is about 15-20 MB/day normally and up to about 40 MB/day during busy periods. Timescale + compression can comfortably hold much longer history than NDJSON files, but retention should still be explicit.

Set compression options first. These settings should be tuned per table after observing real query patterns:

```sql
alter table raw_events set (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'provider_chapter, provider_category',
  timescaledb.compress_orderby = 'received_at desc'
);

alter table normalized_events set (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'feed_key',
  timescaledb.compress_orderby = 'received_at desc'
);

alter table event_entries set (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'feed_key, coin',
  timescaledb.compress_orderby = 'received_at desc'
);

alter table score_buckets set (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'score_version, coin',
  timescaledb.compress_orderby = 'bucket_at desc'
);

alter table score_evidence set (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'score_version, coin',
  timescaledb.compress_orderby = 'bucket_at desc'
);
```

Then add initial compression and retention policies:

```sql
select add_compression_policy('raw_events', interval '7 days', if_not_exists => true);
select add_compression_policy('normalized_events', interval '7 days', if_not_exists => true);
select add_compression_policy('event_entries', interval '7 days', if_not_exists => true);
select add_compression_policy('score_evidence', interval '14 days', if_not_exists => true);

select add_retention_policy('raw_events', interval '180 days', if_not_exists => true);
select add_retention_policy('normalized_events', interval '365 days', if_not_exists => true);
select add_retention_policy('event_entries', interval '365 days', if_not_exists => true);
select add_retention_policy('score_evidence', interval '180 days', if_not_exists => true);
select add_retention_policy('score_buckets', interval '730 days', if_not_exists => true);
```

Operational note: start with retention disabled or long retention in local development. Enable production retention only after verifying backups.

## Bull/Bear Scoring Model

### Score Outputs

Each coin gets these values per bucket:

- `bull_score`: positive pressure from bullish signals.
- `bear_score`: negative pressure from bearish signals.
- `net_score`: `bull_score - bear_score`.
- `confidence_score`: data quality and corroboration confidence from 0 to 100.
- `net_score_delta`: current `net_score` minus previous comparable bucket.
- `dominant_signal`: strongest evidence family for the current bucket.

Scores should be bounded to `0..100` for Bull/Bear and `-100..100` for Net.

### Score Windows

Default windows:

- 5 minutes: very fast momentum and alert pressure.
- 15 minutes: active trading window.
- 60 minutes: intraday context.
- 24 hours: background regime and slower onchain/funding context.

The dashboard should default to 15 minutes for Top Bull/Bear and use 5 minutes for Rising Fast. Coin detail should show all windows.

### Initial Signal Families

Use only signals available from existing normalized feeds and parsed entries.

Bullish contributors:

- `top_buy_pressure`: buy entries from `all_spot_top_buy_5m` and `all_derivatives_top_buy_5m`.
- `positive_price_alert`: positive price movement entries from `pricealerts`.
- `positive_volume_alert`: high-volume upward entries from `volalerts` when direction can be inferred.
- `flow_in`: inflow/positive flow entries from `flows_alert`, `onchain_24_all_flows`, and `onchain_1_all_flows` when direction is inflow.
- `oi_gainer`: `top_oi_gainers_60m` entries.
- `listing`: `listings` events, with low weight unless corroborated.

Bearish contributors:

- `top_sell_pressure`: sell entries from `all_spot_top_sell_5m` and `all_derivatives_top_sell_5m`.
- `negative_price_alert`: negative price movement entries from `pricealerts`.
- `flow_out`: outflow/negative flow entries from flow feeds when direction is outflow.
- `oi_loser`: `top_oi_losers_60m` entries.
- `delisting`: `delistings` events, high severity but low frequency.
- `funding_extreme`: `top_funding` entries when funding is unusually stretched and likely mean-reverting.

Confidence contributors:

- More distinct feeds confirming the same direction increases confidence.
- Recent parsed entries increase confidence.
- Parser statuses of `parser_needs_sample` reduce confidence.
- Conflicting strong Bull and Bear evidence reduces directional confidence but can still produce `mixed` regime.
- Older events decay confidence.

### Weighting Configuration

Weights should live in `score_versions.config`, not be hardcoded only in TypeScript.

Example config shape:

```json
{
  "windowsMinutes": [5, 15, 60, 1440],
  "halfLifeMinutes": {
    "pricealerts": 12,
    "volalerts": 15,
    "all_spot_top_buy_5m": 10,
    "all_derivatives_top_buy_5m": 10,
    "flows_alert": 30,
    "onchain_24_all_flows": 240,
    "top_funding": 120,
    "listings": 360,
    "delistings": 1440
  },
  "weights": {
    "top_buy_pressure": 14,
    "top_sell_pressure": 14,
    "positive_price_alert": 10,
    "negative_price_alert": 10,
    "positive_volume_alert": 8,
    "flow_in": 10,
    "flow_out": 10,
    "oi_gainer": 9,
    "oi_loser": 9,
    "listing": 6,
    "delisting": 25,
    "funding_extreme": 7
  },
  "caps": {
    "singleFeedMaxPoints": 45,
    "singleEventMaxPoints": 20,
    "scoreMax": 100
  }
}
```

### Contribution Formula

Each evidence row should use this conceptual formula:

```text
raw_points = base_weight * magnitude_multiplier * rank_multiplier * direction_multiplier
decayed_points = raw_points * pow(0.5, age_minutes / half_life_minutes)
capped_points = min(decayed_points, configured_cap)
```

Magnitude examples:

- Amount-based entries: use logarithmic scale, such as `log10(amount_usd + 1)` normalized against recent percentiles.
- Percent-based entries: use absolute percent movement with caps to avoid one bad parse dominating.
- Ranked top-list rows: rank 1 gets full weight, rank 10 gets lower weight.
- Delistings: fixed high bearish event weight because amount data may not exist.
- Listings: fixed low bullish event weight unless followed by buy/volume/price confirmation.

Conflict handling:

- Bull and Bear points are accumulated separately.
- Do not cancel evidence before storing it.
- Net score is derived only after both sides are calculated.
- Confidence is lower when both sides are high and close together.

### Score Calculation Flow

Run scoring on a schedule and after event batches:

1. Determine candidate coins from `event_entries` and `normalized_events.coins` changed since the last scoring watermark.
2. For each active window, query candidate coin evidence rows from the relevant lookback range.
3. Convert event entries into `score_evidence` rows using the active score version config.
4. Aggregate evidence into `score_buckets`.
5. Rank each bucket by `bull_score`, `bear_score`, and `net_score`.
6. Compute `market_regime_snapshots` from the latest bucket.
7. Compute `score_health_snapshots`.
8. Emit SSE `score-update` and `score-health` events to connected clients.

The scorer should be deterministic. Given the same score version config and same event tables, it should produce the same score buckets.

### Recalculation And Backtesting

Score recalculation command shape:

```bash
pnpm --filter @cryptoattack/server scores:recalculate -- --version v1 --from 2026-05-01T00:00:00Z --to 2026-05-05T00:00:00Z
```

Rules:

- Recalculate into the same `(score_version, bucket_at, window_minutes, coin)` keys with upserts.
- Delete/rewrite evidence for the requested version + range before recalculating, or use a deterministic evidence key if available.
- Never mutate raw or normalized event history during rescoring.
- Add a new `score_version` for behavior-changing formula changes.

## API Design

Existing APIs remain unchanged. Add new endpoints only when `DATABASE_STORAGE_ENABLED=true`; score endpoints can return `503` with a clear status when storage/scoring is disabled.

### Historical Events

```text
GET /api/history/events?feedKey=pricealerts&coin=BTC&from=...&to=...&limit=100&offset=0
GET /api/history/entries?coin=BTC&feedKey=flows_alert&from=...&to=...&limit=100
GET /api/history/raw-events?feedKey=raw_unclassified&from=...&to=...&limit=50
```

`raw-events` should require dashboard auth and should not be added until redaction and payload-size limits are in place.

### Score Summary

```text
GET /api/scores/summary?window=15m
```

Response shape:

```json
{
  "generatedAt": "2026-05-05T00:00:00.000Z",
  "scoreVersion": "v1",
  "bucketAt": "2026-05-05T00:00:00.000Z",
  "windowMinutes": 15,
  "topBull": [],
  "topBear": [],
  "risingFast": [],
  "marketRegime": {
    "regime": "mixed",
    "confidenceScore": 72
  },
  "health": {
    "status": "ok",
    "scoringLagMs": 1200
  }
}
```

### Coin Detail

```text
GET /api/scores/coins/:coin?window=15m&limitEvidence=100
```

Response sections:

- Current score bucket for each configured window.
- Score sparkline from recent buckets.
- Evidence grouped by signal family and side.
- Recent normalized events and parsed entries for that coin.
- Parser health affecting that coin.

### Score Evidence

```text
GET /api/scores/evidence?coin=BTC&window=15m&bucketAt=...
```

Evidence rows must include enough detail for the UI to show why points were added:

- feed key
- signal key
- side
- points
- weight
- decay multiplier
- value/unit
- reason
- source event time
- raw line or safe event title

### Score Health

```text
GET /api/scores/health
```

Return database writer state, queue length, scoring lag, parser status counts, score version, and latest bucket time.

## SSE Design

Keep existing SSE event names unchanged. Add score-specific events:

- `score-update`: latest summary payload after a scoring bucket is computed.
- `score-health`: latest health snapshot.
- `history-backfill-progress`: optional event for authenticated local admin views.

On SSE connect, after existing `snapshot`, `status`, and spot-performance cached events, the backend can send the latest score summary if scoring is enabled.

Do not stream raw payloads over SSE.

## Scores Dashboard Product

Add a dedicated `/scores` route after backend score APIs exist.

Required panels:

- Top 10 Bull: highest `bull_score`, with net score and strongest evidence.
- Top 10 Bear: highest `bear_score`, with net score and strongest evidence.
- Rising Fast: highest positive `net_score_delta` in the 5-minute or 15-minute window.
- Market Regime: current regime, confidence, aggregate Bull/Bear balance, and recent shift.
- Score Health: database/scorer status, parser-needs-sample rate, scoring lag, evidence count.
- Coin Detail: click any coin to inspect score timeline, evidence, and source events.

UI behavior:

- Keep existing global coin classification/exchange/market filters where meaningful.
- Market `Spot/Futures` filters should continue to affect only feeds where market context is reliable unless the score API explicitly supports market-scoped scoring.
- Show score evidence in plain language, not just numbers.
- Display score version and last computed time.
- Warn when scores are stale or confidence is low.
- Do not show raw provider JSON by default.

## Query Examples

Latest Top Bull:

```sql
select *
from score_buckets
where score_version = $1
  and window_minutes = $2
  and bucket_at = (
    select max(bucket_at)
    from score_buckets
    where score_version = $1 and window_minutes = $2
  )
order by bull_score desc, confidence_score desc
limit 10;
```

Coin evidence for a bucket:

```sql
select *
from score_evidence
where score_version = $1
  and coin = $2
  and window_minutes = $3
  and bucket_at = $4
order by abs(points) desc, source_received_at desc
limit $5;
```

Recent parser gaps:

```sql
select feed_key, count(*) as event_count
from normalized_events
where received_at > now() - interval '24 hours'
  and parser_status = 'parser_needs_sample'
group by feed_key
order by event_count desc;
```

## Local Development And Ops

### Docker Compose

Add a local compose service when implementation starts:

```yaml
services:
  postgres:
    image: timescale/timescaledb:latest-pg16
    ports:
      - "5432:5432"
    environment:
      POSTGRES_DB: cryptoattack
      POSTGRES_USER: cryptoattack
      POSTGRES_PASSWORD: cryptoattack
    volumes:
      - cryptoattack-postgres:/var/lib/postgresql/data

volumes:
  cryptoattack-postgres:
```

### Commands

Planned commands:

```bash
pnpm --filter @cryptoattack/server db:migrate
pnpm --filter @cryptoattack/server db:status
pnpm --filter @cryptoattack/server db:backfill -- --path ./data/raw-events.ndjson --mode validate
pnpm --filter @cryptoattack/server scores:recalculate -- --version v1 --from ... --to ...
```

### Backups

Production backup baseline:

- Daily `pg_dump` for schema and recent data.
- Volume snapshot or managed Postgres backup for full recovery.
- Retain raw NDJSON logs at least until database ingestion and backups have been verified.
- Test restore before enabling aggressive retention.

### Monitoring

Expose these through `/api/status` or `/api/scores/health` when enabled:

- Database connection state.
- Last successful write time.
- Write queue length.
- Oldest pending write age.
- Failed write count.
- Latest score bucket time.
- Scoring lag.
- Parser-needs-sample counts by feed.
- Raw event rate and normalized event rate.

## Testing Plan

### Database Tests

- Migration test against a local Timescale container.
- Repository tests for raw event insert idempotency.
- Repository tests for one raw event producing multiple normalized events.
- Entry insert tests for all existing parser entry fields.
- Coin upsert tests for first/last seen behavior.
- Retention/compression migration smoke test where feasible.

### Ingestion Tests

- `DATABASE_STORAGE_ENABLED=false` preserves all current tests and behavior.
- Database writer does not block `EventStore.addEvents` or SSE emission.
- Database write failure does not crash real or mock mode when fail-open is enabled.
- Queue overflow degrades durable storage but does not drop live SSE events.
- NDJSON backfill is idempotent.

### Scoring Tests

- Unit tests for every signal-family contribution.
- Unit tests for decay, caps, rank multipliers, and conflict handling.
- Snapshot-like tests for score evidence reasons.
- Integration test that known events produce expected Top Bull/Bear rankings.
- Rescore idempotency test over a fixed fixture range.
- Low-confidence tests when parser gaps or conflicting evidence are present.

### API And UI Tests

- REST tests for score summary, coin detail, evidence, and health.
- SSE test for `score-update` without changing existing event stream behavior.
- Frontend tests for Scores panels and stale/low-confidence states.
- Browser smoke adds `/scores` after UI is implemented.

### Existing Verification Must Continue Passing

After each implementation phase:

```bash
pnpm test
pnpm build
```

When frontend score UI is added, also run the existing browser smoke and extend it to cover `/scores`.

## Implementation Phases

### Phase 1: Durable Storage Foundation

- Add TimescaleDB Docker Compose for local development.
- Add database config with `DATABASE_STORAGE_ENABLED=false` default.
- Add explicit SQL migration runner.
- Create raw, normalized, entry, coin, failure, and watermark tables.
- Add repository layer with insert methods and tests.
- Keep runtime behavior unchanged when database is disabled.

### Phase 2: Async Live Ingestion

- Add `DurableIngest` interface and in-process batch writer.
- Enqueue stored events after `EventStore.addEvents` succeeds.
- Add database health metrics to status only when enabled.
- Fail open on database outage.
- Add tests proving SSE/live store are not blocked by database writes.

### Phase 3: NDJSON Backfill

- Add backfill CLI with `validate`, `insert`, and progress reporting.
- Reuse normalizer and repository code.
- Make reruns idempotent.
- Backfill existing `raw-events.ndjson` into local TimescaleDB.
- Compare counts by feed between NDJSON and database.

### Phase 4: Scoring Engine V1

- Add score schema migrations.
- Add `score_versions` seed for `v1`.
- Implement deterministic scoring functions with evidence output.
- Add scheduled scorer for recent buckets.
- Add rescore CLI for historical ranges.
- Add unit and integration tests with fixed fixtures.

### Phase 5: Score APIs And SSE

- Add `/api/scores/summary`.
- Add `/api/scores/coins/:coin`.
- Add `/api/scores/evidence`.
- Add `/api/scores/health`.
- Add SSE `score-update` and `score-health` events.
- Preserve existing API contracts.

### Phase 6: Scores Dashboard

- Add `/scores` route.
- Add Top 10 Bull, Top 10 Bear, Rising Fast, Market Regime, Score Health, and coin-detail panels.
- Show score explanations from `score_evidence`.
- Add stale/low-confidence warnings.
- Extend browser smoke to include `/scores`.

### Phase 7: Production Hardening

- Add backup/restore runbook.
- Tune Timescale compression and retention from observed volume.
- Add database/scorer operational alerts.
- Verify real-mode fail-open behavior.
- Add score-version rollout process and backtesting checklist.

## Open Decisions Before Coding

- Migration runner choice: `node-pg-migrate` versus a minimal custom SQL-file runner.
- Exact package for Postgres client: `pg` is the default recommendation.
- Whether production will run one Node process or multiple. Multiple processes may require durable queue coordination later.
- Initial retention duration for raw payloads after backups are verified.
- Whether score APIs should support market-scoped scoring in v1 or only global coin scoring.

## Acceptance Criteria For This Architecture Phase

- The current live dashboard architecture remains documented as the hot path.
- Postgres + TimescaleDB schema is concrete enough to implement through SQL migrations.
- Async ingestion has clear fail-open behavior.
- Bull/Bear scoring is transparent and evidence-backed.
- Backfill from existing NDJSON is idempotent and safe.
- Score APIs and dashboard panels are specified.
- Implementation phases are ordered so storage can ship before scoring and UI.
