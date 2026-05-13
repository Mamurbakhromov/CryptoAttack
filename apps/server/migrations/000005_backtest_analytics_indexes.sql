create index if not exists score_snapshots_backtest_idx
  on score_snapshots (score_config_version, window_minutes, ts desc, coin)
  include (score_snapshot_id, bull_score, bear_score, net_score, confidence_score);

create index if not exists score_evidence_backtest_idx
  on score_evidence (score_config_version, window_minutes, score_ts desc, side, coin)
  include (score_snapshot_id, event_id, event_received_at, rule_key, contribution, confidence_impact, source_received_at);

create index if not exists score_evidence_snapshot_backtest_idx
  on score_evidence (score_snapshot_id, side, rule_key)
  include (event_id, event_received_at, coin, contribution, confidence_impact, source_received_at);

create index if not exists forward_returns_backtest_event_idx
  on forward_returns (event_id, event_received_at, coin, horizon_minutes, status)
  include (return_pct, max_return_pct, min_return_pct, exchange, market);
