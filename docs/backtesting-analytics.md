# Backtesting Analytics

The backtest layer evaluates persisted score snapshots against persisted forward-return labels. It is read-only analytics: `forward_returns` are historical labels and are never used by the live scoring engine.

## Data Boundary

- Live scoring uses only events available at score time.
- Backtests join `score_snapshots` to `score_evidence` for evidence filters, then to score-snapshot `forward_returns` labels after the fact.
- Every backtest response includes `mode: "historical_backtest"` and a `labelWarning` to keep the historical label boundary explicit.
- Repository queries require `score_evidence.source_received_at <= score_snapshots.ts` so future evidence cannot leak into a scored snapshot.
- Forward-return labels used by backtests are keyed to the score snapshot (`event_id = "score:<score_snapshot_id>"`) and require `base_ts >= score_snapshots.ts`, so labels that already completed before score time are not counted.
- Partial labels are visible through `statusCounts`, `missingLabelCount`, and `pendingCount`; missing labels are not silently counted as losses.

## Horizons

Backtests support the same analysis horizons configured for forward-return labels through `FORWARD_RETURN_HORIZONS_MINUTES`. The default local configuration is:

- `5m`
- `15m`
- `1h`
- `4h`
- `24h`

If `horizonMinutes` is omitted, the API evaluates the configured horizons. Pass comma-separated values to narrow the analysis, for example `horizonMinutes=5,15,60`. Malformed lists such as `horizonMinutes=5,abc` are rejected instead of silently filtered.

## Metrics

- `averageForwardReturnPct`: mean directional return for ready labels.
- `medianForwardReturnPct`: median directional return for ready labels.
- `winRate`: share of ready labels with directional return above zero.
- `lossRate`: share of ready labels with directional return below zero.
- `averageMaxAdverseMovePct`: average adverse excursion when `min_return_pct` or `max_return_pct` is available.
- `sampleCount`: ready labeled observations included in the metric.
- `totalCount`: ready, pending, missing, and failed labels considered by the query.
- `precisionByThreshold`: cumulative win-rate/precision for score thresholds.
- `scoreBuckets`: performance by score-strength buckets. For `side=net`, buckets use `abs(net_score)`.
- `confidenceBuckets`: performance by confidence-score buckets.
- `bullBearSeparation`: spread between raw returns for high bull-score samples and high bear-score samples.
- `configComparison`: deltas between `scoreConfigVersion` and `compareScoreConfigVersion` over the same filters.
- `rules`: per-rule diagnostics with `weak`, `harmful`, `negative_lift`, or `thin_sample` flags.

Directional return is interpreted from the selected side:

- `side=bull`: `return_pct`
- `side=bear`: `-return_pct`
- `side=net`: `sign(net_score) * return_pct`

For adverse move:

- Bullish or net-long samples use `min_return_pct`.
- Bearish or net-short samples use `-max_return_pct`.
- Missing max adverse data remains `null`; it is not treated as zero.

## API

All backtest endpoints use the existing dashboard auth rules.

- `GET /api/backtest/summary`
- `GET /api/backtest/score-buckets`
- `GET /api/backtest/rules`
- `GET /api/backtest/coin/:coin`

Common query parameters:

- `scoreConfigVersion`, default current configured score version.
- `windowMinutes`, default `15` when configured.
- `horizonMinutes`, comma-separated, default from `FORWARD_RETURN_HORIZONS_MINUTES`.
- `side=bull|bear|net`, default `net`.
- `from` and `to`, ISO timestamps over `score_snapshots.ts`.
- `minConfidence`, default `0`.
- `minAbsScore`, default `0`.
- `exchange` and `market` when forward-return or evidence context supports it.

Examples:

```bash
curl "http://127.0.0.1:3001/api/backtest/summary?side=net&horizonMinutes=5,15,60&minConfidence=50"
curl "http://127.0.0.1:3001/api/backtest/score-buckets?bucketSize=10&horizonMinutes=60"
curl "http://127.0.0.1:3001/api/backtest/rules?minSamples=20&horizonMinutes=15"
curl "http://127.0.0.1:3001/api/backtest/coin/BTC?horizonMinutes=15&limit=50"
curl "http://127.0.0.1:3001/api/backtest/summary?scoreConfigVersion=rule-v1&compareScoreConfigVersion=rule-v2"
```

## CLI

Run a historical backtest from the server package:

```bash
pnpm --filter @cryptoattack/server backtest -- --horizon-minutes 5,15,60 --window-minutes 15 --side net --min-confidence 50
```

Or from the root package:

```bash
pnpm backtest -- --horizon-minutes 15 --from 2026-01-01T00:00:00Z --to 2026-02-01T00:00:00Z
```

The CLI requires `DATABASE_STORAGE_ENABLED=true` and a valid `DATABASE_URL`. It prints aggregate metrics, precision coverage, bucket counts, and rule diagnostic counts. Database URLs are redacted from error output.

## Interpretation

- Backtest metrics are only as good as label coverage. Check `sampleCount`, `missingLabelCount`, and `statusCounts` first.
- A high win rate with low `sampleCount` is not reliable; rule diagnostics flag these as `thin_sample`.
- `harmful` means the rule has enough samples, negative average directional return, and win rate below `45%`.
- `weak` means the rule has enough samples but no positive return edge or no positive lift versus all signals.
- Bull/bear separation should show positive spread: high bull scores should have better raw returns than high bear scores.
- Config comparisons are filter-sensitive. Compare versions over identical `windowMinutes`, horizons, score thresholds, and time ranges.
