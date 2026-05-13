create extension if not exists timescaledb;
create extension if not exists pgcrypto;

create table if not exists schema_migrations (
  version text primary key,
  filename text not null,
  checksum text not null,
  applied_at timestamptz not null default now()
);

create table if not exists raw_events (
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
  primary key (raw_event_id, received_at)
);

select create_hypertable('raw_events', 'received_at', chunk_time_interval => interval '1 day', if_not_exists => true);

create unique index if not exists raw_events_payload_idempotency_idx on raw_events (provider, payload_hash, received_at);
create unique index if not exists raw_events_provider_event_id_idempotency_idx on raw_events (provider, provider_event_id, received_at) where provider_event_id is not null;
create index if not exists raw_events_received_at_idx on raw_events (received_at desc);
create index if not exists raw_events_feed_keys_idx on raw_events using gin (feed_keys);
create index if not exists raw_events_payload_gin_idx on raw_events using gin (raw_payload jsonb_path_ops);
create index if not exists raw_events_chapter_category_time_idx on raw_events (provider_chapter, provider_category, received_at desc);

create table if not exists normalized_events (
  event_id text not null,
  raw_event_id uuid,
  raw_received_at timestamptz,
  feed_key text not null,
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
  severity text not null check (severity in ('info', 'warning', 'critical')),
  endpoint text not null,
  parser_status text not null check (parser_status in ('parsed', 'parser_needs_sample', 'not_applicable')),
  amount_metric jsonb,
  normalized_payload jsonb not null,
  inserted_at timestamptz not null default now(),
  primary key (event_id, received_at)
);

select create_hypertable('normalized_events', 'received_at', chunk_time_interval => interval '1 day', if_not_exists => true);

create index if not exists normalized_events_feed_time_idx on normalized_events (feed_key, received_at desc);
create index if not exists normalized_events_chapter_category_time_idx on normalized_events (chapter, category, received_at desc);
create index if not exists normalized_events_coins_idx on normalized_events using gin (coins);
create index if not exists normalized_events_filters_idx on normalized_events using gin (filters);
create index if not exists normalized_events_raw_event_idx on normalized_events (raw_event_id, raw_received_at);
create index if not exists normalized_events_parser_status_idx on normalized_events (parser_status, received_at desc);

create table if not exists event_entries (
  entry_id uuid not null default gen_random_uuid(),
  event_id text not null,
  event_received_at timestamptz not null,
  received_at timestamptz not null,
  feed_key text not null,
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
  notified_at timestamptz,
  threshold text,
  href text,
  raw_line text not null,
  entry_payload jsonb not null,
  inserted_at timestamptz not null default now(),
  primary key (entry_id, received_at)
);

select create_hypertable('event_entries', 'received_at', chunk_time_interval => interval '1 day', if_not_exists => true);

create index if not exists event_entries_coin_time_idx on event_entries (coin, received_at desc) where coin is not null;
create index if not exists event_entries_feed_coin_time_idx on event_entries (feed_key, coin, received_at desc) where coin is not null;
create index if not exists event_entries_feed_time_idx on event_entries (feed_key, received_at desc);
create index if not exists event_entries_event_idx on event_entries (event_id, event_received_at);
create index if not exists event_entries_exchange_time_idx on event_entries (exchange, received_at desc) where exchange is not null;
create index if not exists event_entries_direction_time_idx on event_entries (direction, received_at desc);

create table if not exists price_ticks (
  tick_id uuid not null default gen_random_uuid(),
  source text not null,
  exchange text not null,
  market text not null,
  symbol text not null,
  coin text not null,
  quote_asset text,
  ts timestamptz not null,
  price_usd numeric not null,
  volume_24h_base numeric,
  volume_24h_quote numeric,
  price_change_percent_24h double precision,
  open_interest numeric,
  open_interest_value_usd numeric,
  tick_payload jsonb not null default '{}'::jsonb,
  inserted_at timestamptz not null default now(),
  primary key (tick_id, ts)
);

select create_hypertable('price_ticks', 'ts', chunk_time_interval => interval '6 hours', if_not_exists => true);

create unique index if not exists price_ticks_source_symbol_time_idx on price_ticks (source, exchange, market, symbol, ts);
create index if not exists price_ticks_coin_time_idx on price_ticks (coin, ts desc);
create index if not exists price_ticks_symbol_time_idx on price_ticks (exchange, market, symbol, ts desc);
create index if not exists price_ticks_source_time_idx on price_ticks (source, ts desc);

create table if not exists score_config_versions (
  score_config_version text primary key,
  description text not null,
  config jsonb not null,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  retired_at timestamptz
);

create unique index if not exists score_config_versions_one_active_idx on score_config_versions (active) where active;

create table if not exists score_snapshots (
  score_snapshot_id uuid not null default gen_random_uuid(),
  score_config_version text not null references score_config_versions(score_config_version),
  ts timestamptz not null,
  window_minutes integer not null check (window_minutes > 0),
  coin text not null,
  bull_score double precision not null check (bull_score between 0 and 100),
  bear_score double precision not null check (bear_score between 0 and 100),
  net_score double precision not null check (net_score between -100 and 100),
  confidence_score double precision not null check (confidence_score between 0 and 100),
  event_count integer not null default 0,
  evidence_count integer not null default 0,
  dominant_signal text,
  market_regime text,
  rank_bull integer,
  rank_bear integer,
  rank_net integer,
  previous_net_score double precision,
  net_score_delta double precision,
  snapshot_payload jsonb not null default '{}'::jsonb,
  computed_at timestamptz not null default now(),
  primary key (score_snapshot_id, ts)
);

select create_hypertable('score_snapshots', 'ts', chunk_time_interval => interval '7 days', if_not_exists => true);

create unique index if not exists score_snapshots_idempotency_idx on score_snapshots (score_config_version, ts, window_minutes, coin);
create index if not exists score_snapshots_top_bull_idx on score_snapshots (score_config_version, window_minutes, ts desc, bull_score desc);
create index if not exists score_snapshots_top_bear_idx on score_snapshots (score_config_version, window_minutes, ts desc, bear_score desc);
create index if not exists score_snapshots_rising_idx on score_snapshots (score_config_version, window_minutes, ts desc, net_score_delta desc);
create index if not exists score_snapshots_coin_time_idx on score_snapshots (coin, ts desc);

create table if not exists coin_score_current (
  score_config_version text not null references score_config_versions(score_config_version),
  window_minutes integer not null check (window_minutes > 0),
  coin text not null,
  latest_score_ts timestamptz not null,
  bull_score double precision not null check (bull_score between 0 and 100),
  bear_score double precision not null check (bear_score between 0 and 100),
  net_score double precision not null check (net_score between -100 and 100),
  confidence_score double precision not null check (confidence_score between 0 and 100),
  rank_bull integer,
  rank_bear integer,
  rank_net integer,
  dominant_signal text,
  market_regime text,
  updated_at timestamptz not null default now(),
  primary key (score_config_version, window_minutes, coin)
);

create index if not exists coin_score_current_top_bull_idx on coin_score_current (score_config_version, window_minutes, bull_score desc);
create index if not exists coin_score_current_top_bear_idx on coin_score_current (score_config_version, window_minutes, bear_score desc);
create index if not exists coin_score_current_net_idx on coin_score_current (score_config_version, window_minutes, net_score desc);
create index if not exists coin_score_current_updated_idx on coin_score_current (updated_at desc);

create table if not exists score_evidence (
  evidence_id uuid primary key default gen_random_uuid(),
  score_snapshot_id uuid,
  score_config_version text not null,
  score_ts timestamptz not null,
  window_minutes integer not null check (window_minutes > 0),
  coin text not null,
  event_id text,
  event_received_at timestamptz,
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
  inserted_at timestamptz not null default now()
);

create index if not exists score_evidence_coin_score_idx on score_evidence (score_config_version, coin, score_ts desc);
create index if not exists score_evidence_score_time_idx on score_evidence (score_config_version, score_ts desc);
create index if not exists score_evidence_signal_idx on score_evidence (signal_key, score_ts desc);
create index if not exists score_evidence_event_idx on score_evidence (event_id, event_received_at);
create index if not exists score_evidence_feed_time_idx on score_evidence (feed_key, score_ts desc);

create table if not exists forward_returns (
  event_id text not null,
  event_received_at timestamptz not null,
  coin text not null,
  horizon_minutes integer not null check (horizon_minutes > 0),
  base_ts timestamptz not null,
  base_price_usd numeric,
  future_ts timestamptz,
  future_price_usd numeric,
  return_pct double precision,
  max_return_pct double precision,
  min_return_pct double precision,
  status text not null check (status in ('pending', 'ready', 'missing_price', 'error')),
  computed_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  primary key (event_id, event_received_at, coin, horizon_minutes)
);

select create_hypertable('forward_returns', 'event_received_at', chunk_time_interval => interval '7 days', if_not_exists => true);

create index if not exists forward_returns_coin_time_idx on forward_returns (coin, event_received_at desc);
create index if not exists forward_returns_horizon_status_idx on forward_returns (horizon_minutes, status, event_received_at desc);
create index if not exists forward_returns_event_idx on forward_returns (event_id, event_received_at);

create table if not exists ingestion_errors (
  ingestion_error_id uuid primary key default gen_random_uuid(),
  failed_at timestamptz not null default now(),
  stage text not null,
  raw_event_id uuid,
  raw_received_at timestamptz,
  event_id text,
  event_received_at timestamptz,
  feed_key text,
  retry_count integer not null default 0,
  error_code text,
  error_message text not null,
  payload jsonb,
  resolved_at timestamptz
);

create index if not exists ingestion_errors_failed_idx on ingestion_errors (failed_at desc);
create index if not exists ingestion_errors_stage_idx on ingestion_errors (stage, failed_at desc);
create index if not exists ingestion_errors_feed_idx on ingestion_errors (feed_key, failed_at desc) where feed_key is not null;
