alter table forward_returns drop constraint if exists forward_returns_pkey;

create unique index if not exists forward_returns_event_horizon_null_entry_idx
  on forward_returns (event_id, event_received_at, coin, horizon_minutes)
  where entry_id is null;
