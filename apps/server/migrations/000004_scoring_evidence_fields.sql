alter table score_evidence drop constraint if exists score_evidence_side_check;
alter table score_evidence add constraint score_evidence_side_check check (side in ('bull', 'bear', 'risk', 'confidence'));

alter table score_evidence add column if not exists evidence_key text;
alter table score_evidence add column if not exists rule_key text;
alter table score_evidence add column if not exists contribution double precision;
alter table score_evidence add column if not exists confidence_impact double precision not null default 0;
alter table score_evidence add column if not exists impact text;
alter table score_evidence add column if not exists source text not null default 'event';
alter table score_evidence add column if not exists source_event_ids text[] not null default '{}';

update score_evidence
set rule_key = coalesce(rule_key, signal_key),
    contribution = coalesce(contribution, points),
    evidence_key = coalesce(evidence_key, encode(digest(score_config_version || ':' || score_ts::text || ':' || window_minutes::text || ':' || coin || ':' || coalesce(signal_key, '') || ':' || side || ':' || coalesce(event_id, '') || ':' || coalesce(entry_id::text, ''), 'sha256'), 'hex'));

alter table score_evidence alter column rule_key set not null;
alter table score_evidence alter column contribution set not null;
alter table score_evidence alter column evidence_key set not null;

create unique index if not exists score_evidence_key_idx on score_evidence (evidence_key);
create index if not exists score_evidence_rule_idx on score_evidence (rule_key, score_ts desc);
create index if not exists score_evidence_side_rule_idx on score_evidence (side, rule_key, score_ts desc);

alter table score_snapshots add column if not exists score_hash text;
alter table score_snapshots add column if not exists evidence_hash text;
create index if not exists score_snapshots_hash_idx on score_snapshots (score_config_version, window_minutes, coin, score_hash);
