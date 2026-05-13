import type { QueryResult, QueryResultRow } from 'pg';

import { diagnoseRuleFlags } from '../backtest/metrics.js';
import type {
  BacktestBucketQuery,
  BacktestBucketRow,
  BacktestCoinQuery,
  BacktestCoinReadModel,
  BacktestCoinResultRow,
  BacktestMetricRow,
  BacktestQuery,
  BacktestRuleRow,
  BacktestRulesQuery,
  BacktestSeparationRow,
  BacktestSide,
  BacktestSummaryQuery,
  BacktestThresholdRow
} from '../backtest/types.js';

export interface BacktestPool {
  query<T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<T>>;
}

interface MetricQueryRow extends QueryResultRow {
  score_config_version: string;
  window_minutes: number | string;
  horizon_minutes: number | string;
  side: BacktestSide;
  total_count: number | string;
  sample_count: number | string;
  pending_count: number | string;
  missing_label_count: number | string;
  average_forward_return_pct: number | string | null;
  median_forward_return_pct: number | string | null;
  win_rate: number | string | null;
  loss_rate: number | string | null;
  average_max_adverse_move_pct: number | string | null;
  median_max_adverse_move_pct: number | string | null;
  average_score: number | string | null;
  average_confidence_score: number | string | null;
  status_counts: Record<string, number | string> | string | null;
}

interface ThresholdQueryRow extends QueryResultRow {
  score_config_version: string;
  window_minutes: number | string;
  horizon_minutes: number | string;
  side: BacktestSide;
  threshold: number | string;
  sample_count: number | string;
  precision: number | string | null;
  win_rate: number | string | null;
  loss_rate: number | string | null;
  average_forward_return_pct: number | string | null;
  median_forward_return_pct: number | string | null;
}

interface BucketQueryRow extends QueryResultRow {
  score_config_version: string;
  window_minutes: number | string;
  horizon_minutes: number | string;
  side: BacktestSide;
  bucket_type: 'score' | 'confidence';
  bucket_start: number | string;
  bucket_end: number | string;
  sample_count: number | string;
  average_score: number | string | null;
  average_confidence_score: number | string | null;
  average_forward_return_pct: number | string | null;
  median_forward_return_pct: number | string | null;
  win_rate: number | string | null;
  loss_rate: number | string | null;
  average_max_adverse_move_pct: number | string | null;
}

interface SeparationQueryRow extends QueryResultRow {
  score_config_version: string;
  window_minutes: number | string;
  horizon_minutes: number | string;
  threshold: number | string;
  bull_sample_count: number | string;
  bear_sample_count: number | string;
  bull_average_return_pct: number | string | null;
  bear_average_return_pct: number | string | null;
  spread_pct: number | string | null;
  bull_win_rate: number | string | null;
  bear_win_rate: number | string | null;
  conflict_count: number | string;
}

interface RuleQueryRow extends QueryResultRow {
  score_config_version: string;
  window_minutes: number | string;
  horizon_minutes: number | string;
  rule_key: string;
  side: 'bull' | 'bear' | 'risk' | 'confidence';
  sample_count: number | string;
  evidence_count: number | string;
  average_contribution: number | string | null;
  average_confidence_impact: number | string | null;
  average_forward_return_pct: number | string | null;
  median_forward_return_pct: number | string | null;
  win_rate: number | string | null;
  loss_rate: number | string | null;
  average_max_adverse_move_pct: number | string | null;
  lift_vs_all_signals: number | string | null;
}

interface CoinQueryRow extends QueryResultRow {
  total: number | string;
  score_snapshot_id: string;
  score_ts: Date | string;
  score_config_version: string;
  window_minutes: number | string;
  horizon_minutes: number | string;
  coin: string;
  bull_score: number | string;
  bear_score: number | string;
  net_score: number | string;
  confidence_score: number | string;
  market_regime: string | null;
  dominant_signal: string | null;
  score_value: number | string;
  return_pct: number | string | null;
  directional_return_pct: number | string | null;
  max_return_pct: number | string | null;
  min_return_pct: number | string | null;
  max_adverse_move_pct: number | string | null;
  status: string;
  label_count: number | string;
  top_rules: string[] | string | null;
}

interface BuiltQuery {
  sql: string;
  values: unknown[];
}

export class BacktestRepository {
  constructor(private readonly pool: BacktestPool) {}

  async getSummary(input: BacktestQuery): Promise<BacktestMetricRow[]> {
    const query = buildSummaryQuery(input);
    const result = await this.pool.query<MetricQueryRow>(query.sql, query.values);
    return result.rows.map(metricRowToReadModel);
  }

  async getPrecisionByThreshold(input: BacktestSummaryQuery): Promise<BacktestThresholdRow[]> {
    const query = buildPrecisionQuery(input);
    const result = await this.pool.query<ThresholdQueryRow>(query.sql, query.values);
    return result.rows.map(thresholdRowToReadModel);
  }

  async getScoreBuckets(input: BacktestBucketQuery): Promise<BacktestBucketRow[]> {
    const query = buildBucketQuery(input, 'score');
    const result = await this.pool.query<BucketQueryRow>(query.sql, query.values);
    return result.rows.map(bucketRowToReadModel);
  }

  async getConfidenceBuckets(input: BacktestBucketQuery): Promise<BacktestBucketRow[]> {
    const query = buildBucketQuery(input, 'confidence');
    const result = await this.pool.query<BucketQueryRow>(query.sql, query.values);
    return result.rows.map(bucketRowToReadModel);
  }

  async getBullBearSeparation(input: BacktestSummaryQuery): Promise<BacktestSeparationRow[]> {
    const query = buildSeparationQuery(input);
    const result = await this.pool.query<SeparationQueryRow>(query.sql, query.values);
    return result.rows.map(separationRowToReadModel);
  }

  async getRulePerformance(input: BacktestRulesQuery): Promise<BacktestRuleRow[]> {
    const query = buildRulePerformanceQuery(input);
    const result = await this.pool.query<RuleQueryRow>(query.sql, query.values);
    return result.rows.map((row) => ruleRowToReadModel(row, input.minSamples));
  }

  async getCoinBacktest(input: BacktestCoinQuery): Promise<BacktestCoinReadModel> {
    const query = buildCoinQuery(input);
    const result = await this.pool.query<CoinQueryRow>(query.sql, query.values);
    const rows = result.rows.map(coinRowToReadModel);
    const total = Number(result.rows[0]?.total ?? 0);
    return {
      total,
      results: rows,
      summary: summarizeCoinRows(input, rows)
    };
  }
}

function buildSummaryQuery(input: BacktestQuery): BuiltQuery {
  const values: unknown[] = [];
  const samplesCte = buildSamplesCte(input, values);

  return {
    values,
    sql: `with ${samplesCte},
          status_counts as (
            select horizon_minutes, jsonb_object_agg(status, count)::jsonb as status_counts
            from (
              select horizon_minutes, status, count(*)::int as count
              from samples
              group by horizon_minutes, status
            ) counts
            group by horizon_minutes
          ),
          metric_rows as (
            select score_config_version,
                   window_minutes,
                   horizon_minutes,
                   side,
                   count(*)::int as total_count,
                   count(*) filter (where status = 'ready' and directional_return_pct is not null)::int as sample_count,
                   count(*) filter (where status = 'pending')::int as pending_count,
                   count(*) filter (where status <> 'ready')::int as missing_label_count,
                   avg(directional_return_pct) filter (where status = 'ready') as average_forward_return_pct,
                   percentile_cont(0.5) within group (order by directional_return_pct) filter (where status = 'ready') as median_forward_return_pct,
                   avg((directional_return_pct > 0)::int) filter (where status = 'ready' and directional_return_pct is not null) as win_rate,
                   avg((directional_return_pct < 0)::int) filter (where status = 'ready' and directional_return_pct is not null) as loss_rate,
                   avg(max_adverse_move_pct) filter (where status = 'ready') as average_max_adverse_move_pct,
                   percentile_cont(0.5) within group (order by max_adverse_move_pct) filter (where status = 'ready' and max_adverse_move_pct is not null) as median_max_adverse_move_pct,
                   avg(score_value) filter (where status = 'ready') as average_score,
                   avg(confidence_score) filter (where status = 'ready') as average_confidence_score
            from samples
            group by score_config_version, window_minutes, horizon_minutes, side
          )
          select metric_rows.*, coalesce(status_counts.status_counts, '{}'::jsonb) as status_counts
          from metric_rows
          left join status_counts using (horizon_minutes)
          order by horizon_minutes asc`
  };
}

function buildPrecisionQuery(input: BacktestSummaryQuery): BuiltQuery {
  const values: unknown[] = [];
  const samplesCte = buildSamplesCte(input, values);
  const thresholdsParam = addParam(values, input.thresholds);

  return {
    values,
    sql: `with ${samplesCte}, thresholds as (
            select unnest(${thresholdsParam}::double precision[]) as threshold
          )
          select score_config_version,
                 window_minutes,
                 horizon_minutes,
                 side,
                 threshold,
                 count(*) filter (where status = 'ready' and directional_return_pct is not null and score_value >= threshold)::int as sample_count,
                 avg((directional_return_pct > 0)::int) filter (where status = 'ready' and directional_return_pct is not null and score_value >= threshold) as precision,
                 avg((directional_return_pct > 0)::int) filter (where status = 'ready' and directional_return_pct is not null and score_value >= threshold) as win_rate,
                 avg((directional_return_pct < 0)::int) filter (where status = 'ready' and directional_return_pct is not null and score_value >= threshold) as loss_rate,
                 avg(directional_return_pct) filter (where status = 'ready' and score_value >= threshold) as average_forward_return_pct,
                 percentile_cont(0.5) within group (order by directional_return_pct) filter (where status = 'ready' and score_value >= threshold) as median_forward_return_pct
          from samples
          cross join thresholds
          group by score_config_version, window_minutes, horizon_minutes, side, threshold
          order by horizon_minutes asc, threshold asc`
  };
}

function buildBucketQuery(input: BacktestBucketQuery, bucketType: 'score' | 'confidence'): BuiltQuery {
  const values: unknown[] = [];
  const samplesCte = buildSamplesCte(input, values);
  const bucketSize = bucketType === 'score' ? input.bucketSize : input.confidenceBucketSize;
  const bucketSizeParam = addParam(values, bucketSize);
  const minSamplesParam = addParam(values, input.minSamples);
  const bucketValue = bucketType === 'score' ? 'score_value' : 'confidence_score';

  return {
    values,
    sql: `with ${samplesCte}, bucketed as (
            select *,
                   least(100 - ${bucketSizeParam}::int, greatest(0, floor(${bucketValue} / ${bucketSizeParam}::int) * ${bucketSizeParam}::int))::int as bucket_start
            from samples
          )
          select score_config_version,
                 window_minutes,
                 horizon_minutes,
                 side,
                 ${addParam(values, bucketType)}::text as bucket_type,
                 bucket_start,
                 least(100, bucket_start + ${bucketSizeParam}::int)::int as bucket_end,
                 count(*) filter (where status = 'ready' and directional_return_pct is not null)::int as sample_count,
                 avg(score_value) filter (where status = 'ready') as average_score,
                 avg(confidence_score) filter (where status = 'ready') as average_confidence_score,
                 avg(directional_return_pct) filter (where status = 'ready') as average_forward_return_pct,
                 percentile_cont(0.5) within group (order by directional_return_pct) filter (where status = 'ready') as median_forward_return_pct,
                 avg((directional_return_pct > 0)::int) filter (where status = 'ready' and directional_return_pct is not null) as win_rate,
                 avg((directional_return_pct < 0)::int) filter (where status = 'ready' and directional_return_pct is not null) as loss_rate,
                 avg(max_adverse_move_pct) filter (where status = 'ready') as average_max_adverse_move_pct
          from bucketed
          group by score_config_version, window_minutes, horizon_minutes, side, bucket_start
          having count(*) filter (where status = 'ready' and directional_return_pct is not null) >= ${minSamplesParam}
          order by horizon_minutes asc, bucket_start asc`
  };
}

function buildSeparationQuery(input: BacktestSummaryQuery): BuiltQuery {
  const values: unknown[] = [];
  const thresholdParam = addParam(values, input.separationThreshold);
  const horizonParam = addParam(values, input.horizonsMinutes);
  const where = buildSnapshotWhere(input, values, input.scoreConfigVersion);
  const evidenceExists = buildEvidenceExistsCondition(input, values, 's', false);

  return {
    values,
    sql: `with base as (
            select s.score_config_version,
                   s.window_minutes,
                   s.score_snapshot_id::text,
                   s.bull_score,
                   s.bear_score,
                   horizon.horizon_minutes,
                   coalesce(fr.status, 'missing_label') as status,
                   fr.return_pct
            from score_snapshots s
            cross join unnest(${horizonParam}::int[]) as horizon(horizon_minutes)
            left join forward_returns fr
              on ${scoreLabelJoinCondition('s', 'horizon')}
            where ${where.join(' and ')}
              and ${evidenceExists}
          )
          select score_config_version,
                 window_minutes,
                 horizon_minutes,
                 ${thresholdParam}::double precision as threshold,
                 count(*) filter (where status = 'ready' and bull_score >= ${thresholdParam} and return_pct is not null)::int as bull_sample_count,
                 count(*) filter (where status = 'ready' and bear_score >= ${thresholdParam} and return_pct is not null)::int as bear_sample_count,
                 avg(return_pct) filter (where status = 'ready' and bull_score >= ${thresholdParam}) as bull_average_return_pct,
                 avg(return_pct) filter (where status = 'ready' and bear_score >= ${thresholdParam}) as bear_average_return_pct,
                 (avg(return_pct) filter (where status = 'ready' and bull_score >= ${thresholdParam}) - avg(return_pct) filter (where status = 'ready' and bear_score >= ${thresholdParam})) as spread_pct,
                 avg((return_pct > 0)::int) filter (where status = 'ready' and bull_score >= ${thresholdParam} and return_pct is not null) as bull_win_rate,
                 avg((return_pct < 0)::int) filter (where status = 'ready' and bear_score >= ${thresholdParam} and return_pct is not null) as bear_win_rate,
                 count(*) filter (where bull_score >= ${thresholdParam} and bear_score >= ${thresholdParam})::int as conflict_count
          from base
          group by score_config_version, window_minutes, horizon_minutes
          order by horizon_minutes asc`
  };
}

function buildRulePerformanceQuery(input: BacktestRulesQuery): BuiltQuery {
  const values: unknown[] = [];
  const horizonParam = addParam(values, input.horizonsMinutes);
  const where = buildSnapshotWhere(input, values, input.scoreConfigVersion);
  where.push("e.side in ('bull', 'bear', 'risk', 'confidence')");
  if (input.ruleSide) where.push(`e.side = ${addParam(values, input.ruleSide)}`);
  if (input.ruleKey) where.push(`e.rule_key = ${addParam(values, input.ruleKey)}`);
  if (input.minContribution > 0) where.push(`abs(e.contribution) >= ${addParam(values, input.minContribution)}`);
  where.push(...buildEvidenceMetadataConditions(input, values, 'e'));
  const limitParam = addParam(values, input.limit);
  const multiplier = `case when e.side = 'bull' then 1 when e.side in ('bear', 'risk') then -1 when s.net_score > 0 then 1 when s.net_score < 0 then -1 else 0 end`;

  return {
    values,
    sql: `with rule_samples as (
            select e.rule_key,
                   e.side,
                   e.contribution,
                   e.confidence_impact,
                   s.score_config_version,
                   s.window_minutes,
                   s.net_score,
                   horizon.horizon_minutes,
                   coalesce(fr.status, 'missing_label') as status,
                   case when fr.status = 'ready' and fr.return_pct is not null then (${multiplier}) * fr.return_pct else null end as directional_return_pct,
                   case
                     when fr.status <> 'ready' then null
                     when (${multiplier}) > 0 and fr.min_return_pct is not null then least(0, fr.min_return_pct)
                     when (${multiplier}) < 0 and fr.max_return_pct is not null then least(0, -fr.max_return_pct)
                     else null
                   end as max_adverse_move_pct
            from score_snapshots s
            join score_evidence e
              on e.score_snapshot_id = s.score_snapshot_id
             and e.score_config_version = s.score_config_version
             and e.window_minutes = s.window_minutes
             and e.coin = s.coin
             and e.score_ts = s.ts
             and e.source_received_at <= s.ts
            cross join unnest(${horizonParam}::int[]) as horizon(horizon_minutes)
            left join forward_returns fr
              on ${scoreLabelJoinCondition('s', 'horizon')}
            where ${where.join(' and ')}
          ), overall as (
            select horizon_minutes,
                   avg((directional_return_pct > 0)::int) filter (where status = 'ready' and directional_return_pct is not null) as overall_win_rate
            from rule_samples
            group by horizon_minutes
          )
          select r.score_config_version,
                 r.window_minutes,
                 r.horizon_minutes,
                 r.rule_key,
                 r.side,
                 count(*) filter (where r.status = 'ready' and r.directional_return_pct is not null)::int as sample_count,
                 count(*)::int as evidence_count,
                 avg(r.contribution) as average_contribution,
                 avg(r.confidence_impact) as average_confidence_impact,
                 avg(r.directional_return_pct) filter (where r.status = 'ready') as average_forward_return_pct,
                 percentile_cont(0.5) within group (order by r.directional_return_pct) filter (where r.status = 'ready') as median_forward_return_pct,
                 avg((r.directional_return_pct > 0)::int) filter (where r.status = 'ready' and r.directional_return_pct is not null) as win_rate,
                 avg((r.directional_return_pct < 0)::int) filter (where r.status = 'ready' and r.directional_return_pct is not null) as loss_rate,
                 avg(r.max_adverse_move_pct) filter (where r.status = 'ready') as average_max_adverse_move_pct,
                 (avg((r.directional_return_pct > 0)::int) filter (where r.status = 'ready' and r.directional_return_pct is not null) - max(o.overall_win_rate)) as lift_vs_all_signals
          from rule_samples r
          left join overall o using (horizon_minutes)
          group by r.score_config_version, r.window_minutes, r.horizon_minutes, r.rule_key, r.side
          order by sample_count desc, average_forward_return_pct asc nulls last, r.rule_key asc
          limit ${limitParam}`
  };
}

function buildCoinQuery(input: BacktestCoinQuery): BuiltQuery {
  const values: unknown[] = [];
  const horizonParam = addParam(values, input.horizonsMinutes);
  const where = buildSnapshotWhere(input, values, input.scoreConfigVersion);
  where.push(`s.coin = ${addParam(values, input.coin.toUpperCase())}`);
  const evidenceExists = buildEvidenceExistsCondition(input, values, 's', true);
  const orderBy = coinOrderBy(input.sort);
  const limitParam = addParam(values, input.limit);
  const offsetParam = addParam(values, input.offset);
  const multiplier = directionMultiplierSql(input.side);
  const scoreValue = scoreValueSql(input.side);

  return {
    values,
    sql: `with samples as (
            select s.score_snapshot_id::text,
                   s.ts as score_ts,
                   s.score_config_version,
                   s.window_minutes,
                   s.coin,
                   s.bull_score,
                   s.bear_score,
                   s.net_score,
                   s.confidence_score,
                   s.market_regime,
                   s.dominant_signal,
                   ${scoreValue} as score_value,
                   horizon.horizon_minutes,
                   coalesce(fr.status, 'missing_label') as status,
                   fr.return_pct,
                   fr.max_return_pct,
                   fr.min_return_pct,
                   case when fr.status = 'ready' and fr.return_pct is not null then (${multiplier}) * fr.return_pct else null end as directional_return_pct,
                   case
                     when fr.status <> 'ready' then null
                     when (${multiplier}) > 0 and fr.min_return_pct is not null then least(0, fr.min_return_pct)
                     when (${multiplier}) < 0 and fr.max_return_pct is not null then least(0, -fr.max_return_pct)
                     else null
                   end as max_adverse_move_pct,
                    coalesce(top_rules.top_rules, '{}'::text[]) as top_rules
             from score_snapshots s
             cross join unnest(${horizonParam}::int[]) as horizon(horizon_minutes)
             left join forward_returns fr
               on ${scoreLabelJoinCondition('s', 'horizon')}
             left join lateral (
               select array_agg(rule_key order by abs(contribution) desc, source_received_at desc) filter (where rule_key is not null) as top_rules
               from score_evidence rules
               where rules.score_snapshot_id = s.score_snapshot_id
                 and rules.score_config_version = s.score_config_version
                 and rules.window_minutes = s.window_minutes
                 and rules.coin = s.coin
                 and rules.score_ts = s.ts
             ) top_rules on ${input.includeRules ? 'true' : 'false'}
             where ${where.join(' and ')}
               and ${evidenceExists}
           ), counted as (
             select *,
                    count(*) over ()::int as total,
                    case when status = 'ready' and directional_return_pct is not null then 1 else 0 end as label_count
             from samples
           )
          select *
          from counted
          order by ${orderBy}
          limit ${limitParam} offset ${offsetParam}`
  };
}

function buildSamplesCte(input: BacktestQuery, values: unknown[]): string {
  const horizonParam = addParam(values, input.horizonsMinutes);
  const where = buildSnapshotWhere(input, values, input.scoreConfigVersion);
  const scoreValue = scoreValueSql(input.side);
  const multiplier = directionMultiplierSql(input.side);
  const evidenceExists = buildEvidenceExistsCondition(input, values, 's', true);

  return `samples as (
            select s.score_config_version,
                   s.window_minutes,
                   s.score_snapshot_id::text,
                   s.ts as score_ts,
                   s.coin,
                   s.confidence_score,
                   ${scoreValue} as score_value,
                   ${addParam(values, input.side)}::text as side,
                   horizon.horizon_minutes,
                   coalesce(fr.status, 'missing_label') as status,
                   fr.return_pct,
                   fr.max_return_pct,
                   fr.min_return_pct,
                   case when fr.status = 'ready' and fr.return_pct is not null then (${multiplier}) * fr.return_pct else null end as directional_return_pct,
                   case
                     when fr.status <> 'ready' then null
                     when (${multiplier}) > 0 and fr.min_return_pct is not null then least(0, fr.min_return_pct)
                     when (${multiplier}) < 0 and fr.max_return_pct is not null then least(0, -fr.max_return_pct)
                     else null
                   end as max_adverse_move_pct
            from score_snapshots s
            cross join unnest(${horizonParam}::int[]) as horizon(horizon_minutes)
            left join forward_returns fr
              on ${scoreLabelJoinCondition('s', 'horizon')}
            where ${where.join(' and ')}
              and ${evidenceExists}
          )`;
}

function buildSnapshotWhere(input: BacktestQuery, values: unknown[], scoreConfigVersion: string): string[] {
  const where = [`s.score_config_version = ${addParam(values, scoreConfigVersion)}`, `s.window_minutes = ${addParam(values, input.windowMinutes)}`];
  if (input.from) where.push(`s.ts >= ${addParam(values, input.from)}`);
  if (input.to) where.push(`s.ts < ${addParam(values, input.to)}`);
  if (input.minConfidence > 0) where.push(`s.confidence_score >= ${addParam(values, input.minConfidence)}`);
  if (input.minAbsScore > 0) where.push(`${scoreValueSql(input.side)} >= ${addParam(values, input.minAbsScore)}`);
  return where;
}

function buildEvidenceExistsCondition(input: BacktestQuery, values: unknown[], snapshotAlias: string, includeSide: boolean): string {
  const conditions = [
    `e.score_snapshot_id = ${snapshotAlias}.score_snapshot_id`,
    `e.score_config_version = ${snapshotAlias}.score_config_version`,
    `e.window_minutes = ${snapshotAlias}.window_minutes`,
    `e.coin = ${snapshotAlias}.coin`,
    `e.score_ts = ${snapshotAlias}.ts`,
    `e.source_received_at <= ${snapshotAlias}.ts`
  ];
  if (includeSide) conditions.push(evidenceSideCondition(input.side));
  conditions.push(...buildEvidenceMetadataConditions(input, values, 'e'));
  return `exists (select 1 from score_evidence e where ${conditions.join(' and ')})`;
}

function buildEvidenceMetadataConditions(input: Pick<BacktestQuery, 'exchange' | 'market'>, values: unknown[], alias: string): string[] {
  const conditions: string[] = [];
  if (input.exchange) conditions.push(`lower(coalesce(${alias}.evidence_payload->>'exchange', '')) = ${addParam(values, input.exchange.toLowerCase())}`);
  if (input.market) {
    const marketParam = addParam(values, input.market.toLowerCase());
    conditions.push(`(
      lower(coalesce(${alias}.evidence_payload->>'market', '')) = ${marketParam}
      or (${marketParam} = 'spot' and ${alias}.feed_key like '%spot%')
      or (${marketParam} = 'perpetual' and (${alias}.feed_key like '%derivatives%' or ${alias}.feed_key like '%oi%' or ${alias}.feed_key like '%funding%'))
    )`);
  }
  return conditions;
}

function scoreLabelJoinCondition(snapshotAlias: string, horizonAlias: string): string {
  return `fr.event_id = 'score:' || ${snapshotAlias}.score_snapshot_id::text
             and fr.event_received_at = ${snapshotAlias}.ts
             and fr.coin = ${snapshotAlias}.coin
             and fr.horizon_minutes = ${horizonAlias}.horizon_minutes
             and fr.base_ts >= ${snapshotAlias}.ts`;
}

function evidenceSideCondition(side: BacktestSide): string {
  if (side === 'bull') return "e.side = 'bull'";
  if (side === 'bear') return "e.side in ('bear', 'risk')";
  return "e.side in ('bull', 'bear', 'risk')";
}

function scoreValueSql(side: BacktestSide): string {
  if (side === 'bull') return 's.bull_score';
  if (side === 'bear') return 's.bear_score';
  return 'abs(s.net_score)';
}

function directionMultiplierSql(side: BacktestSide): string {
  if (side === 'bull') return '1';
  if (side === 'bear') return '-1';
  return 'case when s.net_score > 0 then 1 when s.net_score < 0 then -1 else 0 end';
}

function coinOrderBy(sort: BacktestCoinQuery['sort']): string {
  if (sort === 'return_desc') return 'directional_return_pct desc nulls last, score_ts desc';
  if (sort === 'return_asc') return 'directional_return_pct asc nulls last, score_ts desc';
  if (sort === 'abs_score_desc') return 'score_value desc, score_ts desc';
  return 'score_ts desc, horizon_minutes asc';
}

function summarizeCoinRows(input: BacktestCoinQuery, rows: BacktestCoinResultRow[]): BacktestMetricRow | null {
  if (!rows.length) return null;
  const ready = rows.filter((row) => row.status === 'ready' && row.directionalReturnPct !== null);
  const directionalReturns = ready.map((row) => row.directionalReturnPct).filter(isNumber);
  const adverseMoves = ready.map((row) => row.maxAdverseMovePct).filter(isNumber);
  const statusCounts: Record<string, number> = {};
  for (const row of rows) statusCounts[row.status] = (statusCounts[row.status] ?? 0) + 1;
  return {
    scoreConfigVersion: input.scoreConfigVersion,
    windowMinutes: input.windowMinutes,
    horizonMinutes: input.horizonsMinutes[0] ?? 0,
    side: input.side,
    totalCount: rows.length,
    sampleCount: ready.length,
    pendingCount: rows.filter((row) => row.status === 'pending').length,
    missingLabelCount: rows.filter((row) => row.status !== 'ready').length,
    averageForwardReturnPct: average(directionalReturns),
    medianForwardReturnPct: median(directionalReturns),
    winRate: ratio(directionalReturns.filter((value) => value > 0).length, ready.length),
    lossRate: ratio(directionalReturns.filter((value) => value < 0).length, ready.length),
    averageMaxAdverseMovePct: average(adverseMoves),
    medianMaxAdverseMovePct: median(adverseMoves),
    averageScore: average(ready.map((row) => row.score)),
    averageConfidenceScore: average(ready.map((row) => row.confidenceScore)),
    statusCounts
  };
}

function metricRowToReadModel(row: MetricQueryRow): BacktestMetricRow {
  return {
    scoreConfigVersion: row.score_config_version,
    windowMinutes: Number(row.window_minutes),
    horizonMinutes: Number(row.horizon_minutes),
    side: row.side,
    totalCount: Number(row.total_count),
    sampleCount: Number(row.sample_count),
    pendingCount: Number(row.pending_count),
    missingLabelCount: Number(row.missing_label_count),
    averageForwardReturnPct: numberOrNull(row.average_forward_return_pct),
    medianForwardReturnPct: numberOrNull(row.median_forward_return_pct),
    winRate: numberOrNull(row.win_rate),
    lossRate: numberOrNull(row.loss_rate),
    averageMaxAdverseMovePct: numberOrNull(row.average_max_adverse_move_pct),
    medianMaxAdverseMovePct: numberOrNull(row.median_max_adverse_move_pct),
    averageScore: numberOrNull(row.average_score),
    averageConfidenceScore: numberOrNull(row.average_confidence_score),
    statusCounts: statusCounts(row.status_counts)
  };
}

function thresholdRowToReadModel(row: ThresholdQueryRow): BacktestThresholdRow {
  return {
    scoreConfigVersion: row.score_config_version,
    windowMinutes: Number(row.window_minutes),
    horizonMinutes: Number(row.horizon_minutes),
    side: row.side,
    threshold: Number(row.threshold),
    sampleCount: Number(row.sample_count),
    precision: numberOrNull(row.precision),
    winRate: numberOrNull(row.win_rate),
    lossRate: numberOrNull(row.loss_rate),
    averageForwardReturnPct: numberOrNull(row.average_forward_return_pct),
    medianForwardReturnPct: numberOrNull(row.median_forward_return_pct)
  };
}

function bucketRowToReadModel(row: BucketQueryRow): BacktestBucketRow {
  return {
    scoreConfigVersion: row.score_config_version,
    windowMinutes: Number(row.window_minutes),
    horizonMinutes: Number(row.horizon_minutes),
    side: row.side,
    bucketType: row.bucket_type,
    bucketStart: Number(row.bucket_start),
    bucketEnd: Number(row.bucket_end),
    sampleCount: Number(row.sample_count),
    averageScore: numberOrNull(row.average_score),
    averageConfidenceScore: numberOrNull(row.average_confidence_score),
    averageForwardReturnPct: numberOrNull(row.average_forward_return_pct),
    medianForwardReturnPct: numberOrNull(row.median_forward_return_pct),
    winRate: numberOrNull(row.win_rate),
    lossRate: numberOrNull(row.loss_rate),
    averageMaxAdverseMovePct: numberOrNull(row.average_max_adverse_move_pct)
  };
}

function separationRowToReadModel(row: SeparationQueryRow): BacktestSeparationRow {
  return {
    scoreConfigVersion: row.score_config_version,
    windowMinutes: Number(row.window_minutes),
    horizonMinutes: Number(row.horizon_minutes),
    threshold: Number(row.threshold),
    bullSampleCount: Number(row.bull_sample_count),
    bearSampleCount: Number(row.bear_sample_count),
    bullAverageReturnPct: numberOrNull(row.bull_average_return_pct),
    bearAverageReturnPct: numberOrNull(row.bear_average_return_pct),
    spreadPct: numberOrNull(row.spread_pct),
    bullWinRate: numberOrNull(row.bull_win_rate),
    bearWinRate: numberOrNull(row.bear_win_rate),
    conflictCount: Number(row.conflict_count)
  };
}

function ruleRowToReadModel(row: RuleQueryRow, minSamples: number): BacktestRuleRow {
  const sampleCount = Number(row.sample_count);
  const averageForwardReturnPct = numberOrNull(row.average_forward_return_pct);
  const winRate = numberOrNull(row.win_rate);
  const liftVsAllSignals = numberOrNull(row.lift_vs_all_signals);
  return {
    scoreConfigVersion: row.score_config_version,
    windowMinutes: Number(row.window_minutes),
    horizonMinutes: Number(row.horizon_minutes),
    ruleKey: row.rule_key,
    side: row.side,
    sampleCount,
    evidenceCount: Number(row.evidence_count),
    averageContribution: numberOrNull(row.average_contribution),
    averageConfidenceImpact: numberOrNull(row.average_confidence_impact),
    averageForwardReturnPct,
    medianForwardReturnPct: numberOrNull(row.median_forward_return_pct),
    winRate,
    lossRate: numberOrNull(row.loss_rate),
    averageMaxAdverseMovePct: numberOrNull(row.average_max_adverse_move_pct),
    liftVsAllSignals,
    flags: diagnoseRuleFlags({ sampleCount, averageForwardReturnPct, winRate, liftVsAllSignals, minSamples })
  };
}

function coinRowToReadModel(row: CoinQueryRow): BacktestCoinResultRow {
  const directionalReturnPct = numberOrNull(row.directional_return_pct);
  return {
    scoreSnapshotId: row.score_snapshot_id,
    scoreTs: normalizeDbDate(row.score_ts),
    scoreConfigVersion: row.score_config_version,
    windowMinutes: Number(row.window_minutes),
    horizonMinutes: Number(row.horizon_minutes),
    coin: row.coin,
    bullScore: Number(row.bull_score),
    bearScore: Number(row.bear_score),
    netScore: Number(row.net_score),
    confidenceScore: Number(row.confidence_score),
    marketRegime: row.market_regime,
    dominantSignal: row.dominant_signal,
    score: Number(row.score_value),
    returnPct: numberOrNull(row.return_pct),
    directionalReturnPct,
    maxReturnPct: numberOrNull(row.max_return_pct),
    minReturnPct: numberOrNull(row.min_return_pct),
    maxAdverseMovePct: numberOrNull(row.max_adverse_move_pct),
    status: row.status,
    hit: directionalReturnPct === null ? null : directionalReturnPct > 0,
    labelCount: Number(row.label_count),
    topRules: stringArray(row.top_rules)
  };
}

function addParam(values: unknown[], value: unknown): string {
  values.push(value);
  return `$${values.length}`;
}

function numberOrNull(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function statusCounts(value: MetricQueryRow['status_counts']): Record<string, number> {
  if (!value) return {};
  const parsed = typeof value === 'string' ? JSON.parse(value) as Record<string, number | string> : value;
  return Object.fromEntries(Object.entries(parsed).map(([key, count]) => [key, Number(count)]));
}

function stringArray(value: string[] | string | null): string[] {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  if (value.startsWith('{') && value.endsWith('}')) return value.slice(1, -1).split(',').filter(Boolean);
  return [value];
}

function average(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  const right = sorted[midpoint];
  if (right === undefined) return null;
  if (sorted.length % 2) return right;
  const left = sorted[midpoint - 1];
  return left === undefined ? right : (left + right) / 2;
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

function isNumber(value: number | null): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizeDbDate(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
