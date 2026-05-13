create table if not exists raw_event_keys (
  idempotency_key text primary key,
  raw_event_id uuid not null,
  raw_received_at timestamptz not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists normalized_event_keys (
  event_id text primary key,
  received_at timestamptz not null,
  raw_event_id uuid,
  raw_received_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists event_entry_keys (
  entry_key text primary key,
  entry_id uuid not null,
  received_at timestamptz not null,
  event_id text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists raw_event_keys_raw_event_idx on raw_event_keys (raw_event_id, raw_received_at);
create index if not exists normalized_event_keys_raw_event_idx on normalized_event_keys (raw_event_id, raw_received_at);
create index if not exists event_entry_keys_event_idx on event_entry_keys (event_id, received_at);
