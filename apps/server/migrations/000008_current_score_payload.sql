alter table coin_score_current add column if not exists snapshot_payload jsonb not null default '{}'::jsonb;

update coin_score_current c
set snapshot_payload = coalesce((
  select s.snapshot_payload
  from score_snapshots s
  where s.score_config_version = c.score_config_version
    and s.window_minutes = c.window_minutes
    and s.coin = c.coin
  order by s.ts desc
  limit 1
), '{}'::jsonb)
where c.snapshot_payload = '{}'::jsonb;
