alter table raw_events set (
  timescaledb.compress,
  timescaledb.compress_orderby = 'received_at desc',
  timescaledb.compress_segmentby = 'provider, endpoint, provider_chapter, provider_category'
);

alter table price_ticks set (
  timescaledb.compress,
  timescaledb.compress_orderby = 'ts desc',
  timescaledb.compress_segmentby = 'source, exchange, market, symbol'
);

alter table score_snapshots set (
  timescaledb.compress,
  timescaledb.compress_orderby = 'ts desc',
  timescaledb.compress_segmentby = 'score_config_version, window_minutes, coin'
);
