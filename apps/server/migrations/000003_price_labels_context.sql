alter table price_ticks add column if not exists base_asset text;
update price_ticks set base_asset = coin where base_asset is null;
alter table price_ticks alter column base_asset set not null;

update price_ticks set quote_asset = 'USDT' where quote_asset is null;
alter table price_ticks alter column quote_asset set not null;

alter table price_ticks add column if not exists collected_at timestamptz not null default now();

create index if not exists price_ticks_base_asset_time_idx on price_ticks (base_asset, ts desc);
create index if not exists price_ticks_context_time_idx on price_ticks (exchange, market, symbol, ts desc);

alter table forward_returns add column if not exists entry_id uuid;
alter table forward_returns add column if not exists exchange text;
alter table forward_returns add column if not exists market text;
alter table forward_returns add column if not exists symbol text;
alter table forward_returns add column if not exists base_asset text;
alter table forward_returns add column if not exists quote_asset text;
alter table forward_returns add column if not exists target_ts timestamptz;
alter table forward_returns add column if not exists attempt_count integer not null default 0;
alter table forward_returns add column if not exists last_attempt_at timestamptz;
alter table forward_returns add column if not exists error_message text;

alter table forward_returns drop constraint if exists forward_returns_status_check;
alter table forward_returns add constraint forward_returns_status_check
  check (status in ('pending', 'ready', 'missing_price', 'missing_base_price', 'missing_future_price', 'expired', 'error'));

create unique index if not exists forward_returns_entry_horizon_idx on forward_returns (entry_id, event_received_at, horizon_minutes) where entry_id is not null;
create index if not exists forward_returns_target_status_idx on forward_returns (target_ts, status) where target_ts is not null;
create index if not exists forward_returns_context_idx on forward_returns (exchange, market, symbol, target_ts) where symbol is not null;
