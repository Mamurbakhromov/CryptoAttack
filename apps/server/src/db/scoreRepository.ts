import type { PoolClient, QueryResult, QueryResultRow } from 'pg';

import { scoreHalalCoinSymbols } from '../scoring/coinClassification.js';
import type { ScoreConfig, ScoreEvidenceOutput, ScoreResult, ScoreSide, ScoreSourceRow } from '../scoring/types.js';

export interface ScorePool {
  connect(): Promise<PoolClient>;
  query<T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<T>>;
}

interface CandidateCoinRow extends QueryResultRow {
  coin: string;
}

interface CurrentScoreRow extends QueryResultRow {
  bull_score: number | string;
  bear_score: number | string;
  net_score: number | string;
  confidence_score: number | string;
  dominant_signal: string | null;
  market_regime: string | null;
  latest_score_ts: Date | string;
}

interface SnapshotRow extends QueryResultRow {
  score_snapshot_id: string;
}

interface EntrySourceRow extends QueryResultRow {
  source: 'entry';
  event_id: string;
  event_received_at: Date | string;
  entry_id: string;
  feed_key: string;
  coin: string;
  parser_status: 'parsed' | 'parser_needs_sample' | 'not_applicable' | null;
  received_at: Date | string;
  rank: number | null;
  amount_usd: number | string | null;
  delta_usd: number | string | null;
  buy_usd: number | string | null;
  sell_usd: number | string | null;
  buy_sell_ratio: number | string | null;
  volume_24h_usd: number | string | null;
  percent: number | string | null;
  price_change_percent: number | string | null;
  oi_change_15m_percent: number | string | null;
  oi_change_30m_percent: number | string | null;
  total_alerts: number | null;
  direction: string | null;
  exchange: string | null;
  market: string | null;
  raw_line: string | null;
}

interface EventSourceRow extends QueryResultRow {
  source: 'event';
  event_id: string;
  event_received_at: Date | string;
  feed_key: string;
  coin: string;
  parser_status: 'parsed' | 'parser_needs_sample' | 'not_applicable';
  received_at: Date | string;
  title: string;
}

export type ScoreQuerySide = 'bull' | 'bear' | 'net';

export interface ScoreReadFilters {
  scoreConfigVersion: string;
  windowMinutes: number;
  side?: ScoreQuerySide;
  limit: number;
  minConfidence?: number;
  halal?: boolean;
  exchange?: string;
  market?: string;
  updatedSince?: string;
}

export interface CurrentScoresQuery extends ScoreReadFilters {
  coin?: string;
}

export interface ScoreTimelineQuery extends ScoreReadFilters {
  coin: string;
}

export interface ScoreEvidenceQuery extends ScoreReadFilters {
  coin: string;
}

export interface ScoreEvidenceSummary {
  total: number;
  topRuleKeys: string[];
  feedKeys: string[];
  sides: ScoreSide[];
}

export interface ScoreSummaryReadModel {
  coin: string;
  scoreConfigVersion: string;
  windowMinutes: number;
  latestScoreTs: string;
  bullScore: number;
  bearScore: number;
  netScore: number;
  confidenceScore: number;
  rank: number;
  updatedAt: string;
  dominantSignal: string | null;
  marketRegime: ScoreResult['marketRegime'] | null;
  primaryReason: string | null;
  riskTags: string[];
  evidenceSummary: ScoreEvidenceSummary;
  recentScoreDelta: number | null;
}

export interface ScoreTimelineReadModel {
  scoreSnapshotId: string;
  ts: string;
  coin: string;
  scoreConfigVersion: string;
  windowMinutes: number;
  bullScore: number;
  bearScore: number;
  netScore: number;
  confidenceScore: number;
  eventCount: number;
  evidenceCount: number;
  dominantSignal: string | null;
  marketRegime: ScoreResult['marketRegime'] | null;
  primaryReason: string | null;
  riskTags: string[];
  evidenceSummary: ScoreEvidenceSummary;
  previousNetScore: number | null;
  netScoreDelta: number | null;
  recentScoreDelta: number | null;
  scoreHash: string | null;
  evidenceHash: string | null;
  computedAt: string;
}

export interface ScoreEvidenceReadModel {
  evidenceKey: string;
  scoreSnapshotId: string | null;
  scoreTs: string;
  windowMinutes: number;
  coin: string;
  eventId: string | null;
  eventReceivedAt: string | null;
  entryId: string | null;
  feedKey: string;
  signalKey: string;
  ruleKey: string;
  side: ScoreSide;
  contribution: number;
  confidenceImpact: number;
  weight: number;
  decayMultiplier: number;
  value: number | null;
  unit: string | null;
  reason: string;
  source: 'entry' | 'event' | 'aggregate' | string;
  sourceEventIds: string[];
  sourceReceivedAt: string;
  payload: Record<string, unknown>;
}

export interface CurrentScoreConfigReadModel {
  scoreConfigVersion: string;
  description: string;
  config: ScoreConfig;
  active: boolean;
  activatedAt: string | null;
  retiredAt: string | null;
}

interface CurrentScoreReadRow extends QueryResultRow {
  score_config_version: string;
  window_minutes: number;
  coin: string;
  latest_score_ts: Date | string;
  bull_score: number | string;
  bear_score: number | string;
  net_score: number | string;
  confidence_score: number | string;
  rank: number | string;
  updated_at: Date | string;
  dominant_signal: string | null;
  market_regime: ScoreResult['marketRegime'] | null;
  primary_reason: string | null;
  risk_tags: string[] | string | null;
  evidence_total: number | string | null;
  top_rule_keys: string[] | string | null;
  feed_keys: string[] | string | null;
  sides: ScoreSide[] | string | null;
  recent_score_delta: number | string | null;
}

interface TimelineReadRow extends QueryResultRow {
  score_snapshot_id: string;
  ts: Date | string;
  coin: string;
  score_config_version: string;
  window_minutes: number;
  bull_score: number | string;
  bear_score: number | string;
  net_score: number | string;
  confidence_score: number | string;
  event_count: number | string;
  evidence_count: number | string;
  dominant_signal: string | null;
  market_regime: ScoreResult['marketRegime'] | null;
  primary_reason: string | null;
  risk_tags: string[] | string | null;
  evidence_total: number | string | null;
  top_rule_keys: string[] | string | null;
  feed_keys: string[] | string | null;
  sides: ScoreSide[] | string | null;
  previous_net_score: number | string | null;
  net_score_delta: number | string | null;
  recent_score_delta: number | string | null;
  score_hash: string | null;
  evidence_hash: string | null;
  computed_at: Date | string;
}

interface EvidenceReadRow extends QueryResultRow {
  evidence_key: string;
  score_snapshot_id: string | null;
  score_ts: Date | string;
  window_minutes: number;
  coin: string;
  event_id: string | null;
  event_received_at: Date | string | null;
  entry_id: string | null;
  feed_key: string;
  signal_key: string;
  rule_key: string;
  side: ScoreSide;
  points: number | string;
  contribution: number | string | null;
  confidence_impact: number | string | null;
  weight: number | string;
  decay_multiplier: number | string;
  value: number | string | null;
  unit: string | null;
  reason: string;
  source: string;
  source_event_ids: string[] | string | null;
  source_received_at: Date | string;
  evidence_payload: Record<string, unknown> | null;
}

interface CurrentScoreConfigRow extends QueryResultRow {
  score_config_version: string;
  description: string;
  config: ScoreConfig;
  active: boolean;
  activated_at: Date | string | null;
  retired_at: Date | string | null;
}

export class ScoreRepository {
  constructor(private readonly pool: ScorePool) {}

  async ensureScoreConfig(config: ScoreConfig): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query('update score_config_versions set active = false, retired_at = now() where active = true and score_config_version <> $1', [config.version]);
      await client.query(
        `insert into score_config_versions (score_config_version, description, config, active, activated_at)
         values ($1, $2, $3, true, now())
         on conflict (score_config_version) do update
         set description = excluded.description,
             config = excluded.config,
             active = true,
             activated_at = coalesce(score_config_versions.activated_at, now()),
             retired_at = null`,
        [config.version, config.description, config]
      );
      await client.query('commit');
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async getCandidateCoins(since: string, limit: number): Promise<string[]> {
    const result = await this.pool.query<CandidateCoinRow>(
      `select coin
       from (
         select upper(coin) as coin, max(received_at) as last_seen_at, count(*) as event_count
         from event_entries
         where coin is not null and received_at >= $1
         group by upper(coin)
         union all
         select upper(coin) as coin, max(received_at) as last_seen_at, count(*) as event_count
         from normalized_events, unnest(coins) as coin
         where received_at >= $1
         group by upper(coin)
       ) candidates
       where coin <> ''
       group by coin
       order by max(last_seen_at) desc, sum(event_count) desc
       limit $2`,
      [since, limit]
    );
    return result.rows.map((row) => row.coin);
  }

  async getScoreSourceRows(input: { coins: string[]; from: string; to: string; feedKeys: string[] }): Promise<ScoreSourceRow[]> {
    if (!input.coins.length) return [];
    const normalizedCoins = input.coins.map((coin) => coin.toUpperCase());
    const [entryRows, eventRows] = await Promise.all([
      this.pool.query<EntrySourceRow>(
        `select 'entry'::text as source,
                ee.event_id,
                ee.event_received_at,
                ee.entry_id::text,
                ee.feed_key,
                upper(ee.coin) as coin,
                ne.parser_status,
                ee.received_at,
                ee.rank,
                ee.amount_usd,
                ee.delta_usd,
                ee.buy_usd,
                ee.sell_usd,
                ee.buy_sell_ratio,
                ee.volume_24h_usd,
                ee.percent,
                ee.price_change_percent,
                ee.oi_change_15m_percent,
                ee.oi_change_30m_percent,
                ee.total_alerts,
                ee.direction,
                ee.exchange,
                ee.market,
                ee.raw_line
         from event_entries ee
         left join normalized_events ne on ne.event_id = ee.event_id and ne.received_at = ee.event_received_at
         where upper(ee.coin) = any($1::text[])
           and ee.received_at >= $2
           and ee.received_at <= $3
           and ee.feed_key = any($4::text[])
         order by ee.received_at desc`,
        [normalizedCoins, input.from, input.to, input.feedKeys]
      ),
      this.pool.query<EventSourceRow>(
        `select 'event'::text as source,
                ne.event_id,
                ne.received_at as event_received_at,
                ne.feed_key,
                upper(coin) as coin,
                ne.parser_status,
                ne.received_at,
                ne.title
         from normalized_events ne, unnest(ne.coins) as coin
         where upper(coin) = any($1::text[])
           and ne.received_at >= $2
           and ne.received_at <= $3
           and ne.feed_key = any($4::text[])
           and ne.feed_key in ('listings', 'delistings')
         order by ne.received_at desc`,
        [normalizedCoins, input.from, input.to, input.feedKeys]
      )
    ]);

    return [...entryRows.rows.map(entryRowToSource), ...eventRows.rows.map(eventRowToSource)];
  }

  async getCurrentScores(input: CurrentScoresQuery): Promise<ScoreSummaryReadModel[]> {
    const query = buildCurrentScoresQuery(input);
    const result = await this.pool.query<CurrentScoreReadRow>(query.sql, query.values);
    return result.rows.map(currentScoreRowToReadModel);
  }

  async getScoreTimeline(input: ScoreTimelineQuery): Promise<ScoreTimelineReadModel[]> {
    if (input.halal !== undefined && !matchesHalalInput(input.coin, input.halal)) return [];
    const query = buildTimelineQuery(input);
    const result = await this.pool.query<TimelineReadRow>(query.sql, query.values);
    return result.rows.map(timelineRowToReadModel);
  }

  async getScoreEvidence(input: ScoreEvidenceQuery): Promise<ScoreEvidenceReadModel[]> {
    if (input.halal !== undefined && !matchesHalalInput(input.coin, input.halal)) return [];
    const query = buildEvidenceQuery(input);
    const result = await this.pool.query<EvidenceReadRow>(query.sql, query.values);
    return result.rows.map(evidenceRowToReadModel);
  }

  async getCurrentScoreConfig(): Promise<CurrentScoreConfigReadModel | null> {
    const result = await this.pool.query<CurrentScoreConfigRow>(
      `select score_config_version, description, config, active, activated_at, retired_at
       from score_config_versions
       where active = true
       order by activated_at desc nulls last, created_at desc
       limit 1`
    );
    const row = result.rows[0];
    return row ? currentScoreConfigRowToReadModel(row) : null;
  }

  async writeScores(results: ScoreResult[], config: ScoreConfig): Promise<{ snapshotsWritten: number; evidenceWritten: number; currentWritten: number; skippedSnapshots: number }> {
    if (!results.length) return { snapshotsWritten: 0, evidenceWritten: 0, currentWritten: 0, skippedSnapshots: 0 };
    const client = await this.pool.connect();
    let snapshotsWritten = 0;
    let evidenceWritten = 0;
    let currentWritten = 0;
    let skippedSnapshots = 0;
    try {
      await client.query('begin');
      for (const result of results) {
        const current = await getCurrentScore(client, result);
        const shouldWriteSnapshot = isMaterialChange(current, result, config);
        let scoreSnapshotId: string | null = null;
        if (shouldWriteSnapshot) {
          scoreSnapshotId = await upsertScoreSnapshot(client, result);
          snapshotsWritten += 1;
          evidenceWritten += await upsertEvidenceRows(client, result, scoreSnapshotId);
        } else {
          skippedSnapshots += 1;
        }
        await upsertCurrentScore(client, result);
        currentWritten += 1;
      }
      await client.query('commit');
      return { snapshotsWritten, evidenceWritten, currentWritten, skippedSnapshots };
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }
}

async function getCurrentScore(client: PoolClient, result: ScoreResult): Promise<CurrentScoreRow | null> {
  const current = await client.query<CurrentScoreRow>(
    `select bull_score, bear_score, net_score, confidence_score, dominant_signal, market_regime, latest_score_ts
     from coin_score_current
     where score_config_version = $1 and window_minutes = $2 and coin = $3`,
    [result.scoreConfigVersion, result.windowMinutes, result.coin]
  );
  return current.rows[0] ?? null;
}

function isMaterialChange(current: CurrentScoreRow | null, result: ScoreResult, config: ScoreConfig): boolean {
  if (!current) return true;
  return (
    Math.abs(result.netScore - Number(current.net_score)) >= config.materialChange.minNetDelta ||
    Math.abs(result.bullScore - Number(current.bull_score)) >= config.materialChange.minSideDelta ||
    Math.abs(result.bearScore - Number(current.bear_score)) >= config.materialChange.minSideDelta ||
    Math.abs(result.confidenceScore - Number(current.confidence_score)) >= config.materialChange.minConfidenceDelta ||
    result.dominantSignal !== current.dominant_signal ||
    result.marketRegime !== current.market_regime
  );
}

async function upsertScoreSnapshot(client: PoolClient, result: ScoreResult): Promise<string> {
  const insert = await client.query<SnapshotRow>(
    `insert into score_snapshots (
       score_config_version,
       ts,
       window_minutes,
       coin,
       bull_score,
       bear_score,
       net_score,
       confidence_score,
       event_count,
       evidence_count,
       dominant_signal,
       market_regime,
       previous_net_score,
       net_score_delta,
       snapshot_payload,
       score_hash,
       evidence_hash
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
     on conflict (score_config_version, ts, window_minutes, coin) do update
     set bull_score = excluded.bull_score,
         bear_score = excluded.bear_score,
         net_score = excluded.net_score,
         confidence_score = excluded.confidence_score,
         event_count = excluded.event_count,
         evidence_count = excluded.evidence_count,
         dominant_signal = excluded.dominant_signal,
         market_regime = excluded.market_regime,
         previous_net_score = excluded.previous_net_score,
         net_score_delta = excluded.net_score_delta,
         snapshot_payload = excluded.snapshot_payload,
         score_hash = excluded.score_hash,
         evidence_hash = excluded.evidence_hash
     returning score_snapshot_id::text`,
    [
      result.scoreConfigVersion,
      result.ts,
      result.windowMinutes,
      result.coin,
      result.bullScore,
      result.bearScore,
      result.netScore,
      result.confidenceScore,
      result.eventCount,
      result.evidenceCount,
      result.dominantSignal,
      result.marketRegime,
      result.previousNetScore ?? null,
      result.netScoreDelta ?? null,
      result.payload,
      result.scoreHash,
      result.evidenceHash
    ]
  );
  const row = insert.rows[0];
  if (!row) throw new Error('score_snapshots upsert returned no row');
  return row.score_snapshot_id;
}

async function upsertCurrentScore(client: PoolClient, result: ScoreResult): Promise<void> {
  await client.query(
    `insert into coin_score_current (
       score_config_version,
       window_minutes,
       coin,
       latest_score_ts,
       bull_score,
       bear_score,
       net_score,
       confidence_score,
       dominant_signal,
       market_regime
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     on conflict (score_config_version, window_minutes, coin) do update
     set latest_score_ts = excluded.latest_score_ts,
         bull_score = excluded.bull_score,
         bear_score = excluded.bear_score,
         net_score = excluded.net_score,
         confidence_score = excluded.confidence_score,
         dominant_signal = excluded.dominant_signal,
         market_regime = excluded.market_regime,
         updated_at = now()
     where excluded.latest_score_ts >= coin_score_current.latest_score_ts`,
    [
      result.scoreConfigVersion,
      result.windowMinutes,
      result.coin,
      result.ts,
      result.bullScore,
      result.bearScore,
      result.netScore,
      result.confidenceScore,
      result.dominantSignal,
      result.marketRegime
    ]
  );
}

async function upsertEvidenceRows(client: PoolClient, result: ScoreResult, scoreSnapshotId: string): Promise<number> {
  let written = 0;
  for (const evidence of result.evidence) {
    await client.query(
      `insert into score_evidence (
         evidence_key,
         score_snapshot_id,
         score_config_version,
         score_ts,
         window_minutes,
         coin,
         event_id,
         event_received_at,
         entry_id,
         feed_key,
         signal_key,
         rule_key,
         side,
         points,
         contribution,
         confidence_impact,
         weight,
         decay_multiplier,
         value,
         unit,
         reason,
         source,
         source_event_ids,
         source_received_at,
         evidence_payload
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11, $12, $13, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
       on conflict (evidence_key) do update
       set score_snapshot_id = excluded.score_snapshot_id,
           points = excluded.points,
           contribution = excluded.contribution,
           confidence_impact = excluded.confidence_impact,
           weight = excluded.weight,
           decay_multiplier = excluded.decay_multiplier,
           value = excluded.value,
           unit = excluded.unit,
           reason = excluded.reason,
           source_event_ids = excluded.source_event_ids,
           evidence_payload = excluded.evidence_payload`,
      [
        evidence.evidenceKey,
        scoreSnapshotId,
        result.scoreConfigVersion,
        result.ts,
        result.windowMinutes,
        evidence.coin,
        evidence.eventId,
        evidence.eventReceivedAt,
        evidence.entryId,
        evidence.feedKey,
        evidence.ruleKey,
        evidence.side,
        evidence.contribution,
        evidence.confidenceImpact,
        evidence.weight,
        evidence.decayMultiplier,
        evidence.value,
        evidence.unit,
        evidence.reason,
        evidence.source,
        evidence.sourceEventIds,
        evidence.sourceReceivedAt,
        evidence.payload
      ]
    );
    written += 1;
  }
  return written;
}

interface BuiltQuery {
  sql: string;
  values: unknown[];
}

function buildCurrentScoresQuery(input: CurrentScoresQuery): BuiltQuery {
  const values: unknown[] = [input.scoreConfigVersion, input.windowMinutes];
  const where = ['c.score_config_version = $1', 'c.window_minutes = $2'];
  addCommonCurrentFilters(where, values, input);
  const coinFilter = input.coin ? `where coin = ${addParam(values, normalizeCoin(input.coin))}` : '';
  const limitParam = addParam(values, input.limit);
  const orderBy = orderByForSide(input.side ?? 'net');

  return {
    values,
    sql: `with base as (
            select c.score_config_version,
                   c.window_minutes,
                   c.coin,
                   c.latest_score_ts,
                   c.bull_score,
                   c.bear_score,
                   c.net_score,
                   c.confidence_score,
                   c.updated_at,
                   c.dominant_signal,
                   c.market_regime,
                   primary_evidence.reason as primary_reason,
                   coalesce(evidence_summary.risk_tags, '{}'::text[]) as risk_tags,
                   coalesce(evidence_summary.evidence_total, 0) as evidence_total,
                   coalesce(evidence_summary.top_rule_keys, '{}'::text[]) as top_rule_keys,
                   coalesce(evidence_summary.feed_keys, '{}'::text[]) as feed_keys,
                   coalesce(evidence_summary.sides, '{}'::text[]) as sides,
                   delta.recent_score_delta
            from coin_score_current c
            left join lateral (${primaryEvidenceSql('c')}) primary_evidence on true
            left join lateral (${evidenceSummarySql('c')}) evidence_summary on true
            left join lateral (${recentDeltaSql('c')}) delta on true
            where ${where.join(' and ')}
          ), ranked as (
            select base.*, row_number() over (order by ${orderBy})::int as rank
            from base
          )
          select *
          from ranked
          ${coinFilter}
          order by rank asc
          limit ${limitParam}`
  };
}

function buildTimelineQuery(input: ScoreTimelineQuery): BuiltQuery {
  const values: unknown[] = [input.scoreConfigVersion, input.windowMinutes, normalizeCoin(input.coin)];
  const where = ['s.score_config_version = $1', 's.window_minutes = $2', 's.coin = $3'];
  if (input.minConfidence && input.minConfidence > 0) where.push(`s.confidence_score >= ${addParam(values, input.minConfidence)}`);
  if (input.updatedSince) where.push(`s.ts >= ${addParam(values, input.updatedSince)}`);
  const evidenceFilters = buildEvidenceFilterConditions('e_filter', values, input);
  if (evidenceFilters.length) {
    where.push(`exists (
      select 1 from score_evidence e_filter
      where e_filter.score_snapshot_id = s.score_snapshot_id
        and ${evidenceFilters.join(' and ')}
    )`);
  }
  const limitParam = addParam(values, input.limit);

  return {
    values,
    sql: `with filtered as (
            select s.*,
                   lead(s.net_score) over (order by s.ts desc) as previous_snapshot_net_score
            from score_snapshots s
            where ${where.join(' and ')}
          )
          select filtered.score_snapshot_id::text,
                 filtered.ts,
                 filtered.coin,
                 filtered.score_config_version,
                 filtered.window_minutes,
                 filtered.bull_score,
                 filtered.bear_score,
                 filtered.net_score,
                 filtered.confidence_score,
                 filtered.event_count,
                 filtered.evidence_count,
                 filtered.dominant_signal,
                 filtered.market_regime,
                 filtered.previous_net_score,
                 filtered.net_score_delta,
                 coalesce(filtered.net_score_delta, filtered.net_score - filtered.previous_snapshot_net_score) as recent_score_delta,
                 filtered.score_hash,
                 filtered.evidence_hash,
                 filtered.computed_at,
                 primary_evidence.reason as primary_reason,
                 coalesce(evidence_summary.risk_tags, '{}'::text[]) as risk_tags,
                 coalesce(evidence_summary.evidence_total, 0) as evidence_total,
                 coalesce(evidence_summary.top_rule_keys, '{}'::text[]) as top_rule_keys,
                 coalesce(evidence_summary.feed_keys, '{}'::text[]) as feed_keys,
                 coalesce(evidence_summary.sides, '{}'::text[]) as sides
          from filtered
          left join lateral (${primaryEvidenceForSnapshotSql('filtered')}) primary_evidence on true
          left join lateral (${evidenceSummaryForSnapshotSql('filtered')}) evidence_summary on true
          order by filtered.ts desc
          limit ${limitParam}`
  };
}

function buildEvidenceQuery(input: ScoreEvidenceQuery): BuiltQuery {
  const values: unknown[] = [input.scoreConfigVersion, input.windowMinutes, normalizeCoin(input.coin)];
  const where = ['e.score_config_version = $1', 'e.window_minutes = $2', 'e.coin = $3'];
  if (input.updatedSince) where.push(`e.score_ts >= ${addParam(values, input.updatedSince)}`);
  if (input.side === 'bull' || input.side === 'bear') where.push(`e.side = ${addParam(values, input.side)}`);
  if (input.side === 'net') where.push("e.side in ('bull', 'bear', 'risk')");
  const evidenceFilters = buildEvidenceFilterConditions('e', values, input);
  where.push(...evidenceFilters);
  if (input.minConfidence && input.minConfidence > 0) where.push(`s.confidence_score >= ${addParam(values, input.minConfidence)}`);
  const limitParam = addParam(values, input.limit);

  return {
    values,
    sql: `select e.evidence_key,
                 e.score_snapshot_id::text,
                 e.score_ts,
                 e.window_minutes,
                 e.coin,
                 e.event_id,
                 e.event_received_at,
                 e.entry_id::text,
                 e.feed_key,
                 e.signal_key,
                 e.rule_key,
                 e.side,
                 e.points,
                 e.contribution,
                 e.confidence_impact,
                 e.weight,
                 e.decay_multiplier,
                 e.value,
                 e.unit,
                 e.reason,
                 e.source,
                 e.source_event_ids,
                 e.source_received_at,
                 e.evidence_payload
          from score_evidence e
          left join score_snapshots s
            on s.score_snapshot_id = e.score_snapshot_id
           and s.score_config_version = e.score_config_version
           and s.window_minutes = e.window_minutes
           and s.coin = e.coin
          where ${where.join(' and ')}
          order by e.score_ts desc, abs(coalesce(e.contribution, e.points)) desc, e.source_received_at desc
          limit ${limitParam}`
  };
}

function addCommonCurrentFilters(where: string[], values: unknown[], input: CurrentScoresQuery): void {
  if (input.side === 'bull') where.push('c.net_score > 0');
  if (input.side === 'bear') where.push('c.net_score < 0');
  if (input.minConfidence && input.minConfidence > 0) where.push(`c.confidence_score >= ${addParam(values, input.minConfidence)}`);
  if (input.updatedSince) where.push(`c.updated_at >= ${addParam(values, input.updatedSince)}`);
  if (input.halal !== undefined) {
    const halalParam = addParam(values, scoreHalalCoinSymbols());
    where.push(input.halal ? `c.coin = any(${halalParam}::text[])` : `c.coin <> all(${halalParam}::text[])`);
  }
  const evidenceFilters = buildEvidenceFilterConditions('e_filter', values, input);
  if (evidenceFilters.length) {
    where.push(`exists (
      select 1 from score_evidence e_filter
      where e_filter.score_config_version = c.score_config_version
        and e_filter.window_minutes = c.window_minutes
        and e_filter.coin = c.coin
        and e_filter.score_ts = c.latest_score_ts
        and ${evidenceFilters.join(' and ')}
    )`);
  }
}

function buildEvidenceFilterConditions(alias: string, values: unknown[], input: Pick<ScoreReadFilters, 'exchange' | 'market'>): string[] {
  const conditions: string[] = [];
  if (input.exchange) {
    conditions.push(`lower(coalesce(${alias}.evidence_payload->>'exchange', '')) = ${addParam(values, input.exchange.toLowerCase())}`);
  }
  if (input.market) {
    const marketParam = addParam(values, input.market.toLowerCase());
    conditions.push(`(
      lower(coalesce(${alias}.evidence_payload->>'market', '')) = ${marketParam}
      or (${marketParam} = 'spot' and ${alias}.feed_key like '%spot%')
      or (${marketParam} = 'perpetual' and (${alias}.feed_key like '%derivatives%' or ${alias}.feed_key like '%oi%'))
    )`);
  }
  return conditions;
}

function primaryEvidenceSql(currentAlias: string): string {
  return `select e.reason
          from score_evidence e
          where e.score_config_version = ${currentAlias}.score_config_version
            and e.window_minutes = ${currentAlias}.window_minutes
            and e.coin = ${currentAlias}.coin
            and e.score_ts = ${currentAlias}.latest_score_ts
          order by e.score_ts desc, abs(coalesce(e.contribution, e.points)) desc, e.source_received_at desc
          limit 1`;
}

function evidenceSummarySql(currentAlias: string): string {
  return `select count(*)::int as evidence_total,
                 coalesce(array_agg(e.rule_key order by abs(coalesce(e.contribution, e.points)) desc) filter (where e.rule_key is not null), '{}'::text[]) as top_rule_keys,
                 coalesce(array_agg(distinct e.feed_key) filter (where e.feed_key is not null), '{}'::text[]) as feed_keys,
                 coalesce(array_agg(distinct e.side) filter (where e.side is not null), '{}'::text[]) as sides,
                 coalesce(array_agg(distinct e.rule_key) filter (where e.side = 'risk'), '{}'::text[]) as risk_tags
          from (
            select e.rule_key, e.feed_key, e.side, e.contribution, e.points
            from score_evidence e
            where e.score_config_version = ${currentAlias}.score_config_version
              and e.window_minutes = ${currentAlias}.window_minutes
              and e.coin = ${currentAlias}.coin
              and e.score_ts = ${currentAlias}.latest_score_ts
            order by e.score_ts desc, abs(coalesce(e.contribution, e.points)) desc
            limit 20
          ) e`;
}

function recentDeltaSql(currentAlias: string): string {
  return `select coalesce(s.net_score_delta, s.net_score - previous_snapshot.net_score) as recent_score_delta
          from score_snapshots s
          left join lateral (
            select p.net_score
            from score_snapshots p
            where p.score_config_version = s.score_config_version
              and p.window_minutes = s.window_minutes
              and p.coin = s.coin
              and p.ts < s.ts
            order by p.ts desc
            limit 1
          ) previous_snapshot on true
          where s.score_config_version = ${currentAlias}.score_config_version
            and s.window_minutes = ${currentAlias}.window_minutes
            and s.coin = ${currentAlias}.coin
          order by s.ts desc
          limit 1`;
}

function primaryEvidenceForSnapshotSql(snapshotAlias: string): string {
  return `select e.reason
          from score_evidence e
          where e.score_snapshot_id = ${snapshotAlias}.score_snapshot_id
          order by abs(coalesce(e.contribution, e.points)) desc, e.source_received_at desc
          limit 1`;
}

function evidenceSummaryForSnapshotSql(snapshotAlias: string): string {
  return `select count(*)::int as evidence_total,
                 coalesce(array_agg(e.rule_key order by abs(coalesce(e.contribution, e.points)) desc) filter (where e.rule_key is not null), '{}'::text[]) as top_rule_keys,
                 coalesce(array_agg(distinct e.feed_key) filter (where e.feed_key is not null), '{}'::text[]) as feed_keys,
                 coalesce(array_agg(distinct e.side) filter (where e.side is not null), '{}'::text[]) as sides,
                 coalesce(array_agg(distinct e.rule_key) filter (where e.side = 'risk'), '{}'::text[]) as risk_tags
          from score_evidence e
          where e.score_snapshot_id = ${snapshotAlias}.score_snapshot_id`;
}

function orderByForSide(side: ScoreQuerySide): string {
  if (side === 'bull') return 'net_score desc, bull_score desc, confidence_score desc, latest_score_ts desc, coin asc';
  if (side === 'bear') return 'net_score asc, bear_score desc, confidence_score desc, latest_score_ts desc, coin asc';
  return 'abs(net_score) desc, confidence_score desc, latest_score_ts desc, coin asc';
}

function addParam(values: unknown[], value: unknown): string {
  values.push(value);
  return `$${values.length}`;
}

function currentScoreRowToReadModel(row: CurrentScoreReadRow): ScoreSummaryReadModel {
  return {
    coin: row.coin,
    scoreConfigVersion: row.score_config_version,
    windowMinutes: Number(row.window_minutes),
    latestScoreTs: normalizeDbDate(row.latest_score_ts),
    bullScore: numberOrZero(row.bull_score),
    bearScore: numberOrZero(row.bear_score),
    netScore: numberOrZero(row.net_score),
    confidenceScore: numberOrZero(row.confidence_score),
    rank: Number(row.rank),
    updatedAt: normalizeDbDate(row.updated_at),
    dominantSignal: row.dominant_signal,
    marketRegime: row.market_regime,
    primaryReason: row.primary_reason,
    riskTags: stringArray(row.risk_tags),
    evidenceSummary: evidenceSummaryFromRow(row),
    recentScoreDelta: numberOrNull(row.recent_score_delta)
  };
}

function timelineRowToReadModel(row: TimelineReadRow): ScoreTimelineReadModel {
  return {
    scoreSnapshotId: row.score_snapshot_id,
    ts: normalizeDbDate(row.ts),
    coin: row.coin,
    scoreConfigVersion: row.score_config_version,
    windowMinutes: Number(row.window_minutes),
    bullScore: numberOrZero(row.bull_score),
    bearScore: numberOrZero(row.bear_score),
    netScore: numberOrZero(row.net_score),
    confidenceScore: numberOrZero(row.confidence_score),
    eventCount: Number(row.event_count),
    evidenceCount: Number(row.evidence_count),
    dominantSignal: row.dominant_signal,
    marketRegime: row.market_regime,
    primaryReason: row.primary_reason,
    riskTags: stringArray(row.risk_tags),
    evidenceSummary: evidenceSummaryFromRow(row),
    previousNetScore: numberOrNull(row.previous_net_score),
    netScoreDelta: numberOrNull(row.net_score_delta),
    recentScoreDelta: numberOrNull(row.recent_score_delta),
    scoreHash: row.score_hash,
    evidenceHash: row.evidence_hash,
    computedAt: normalizeDbDate(row.computed_at)
  };
}

function evidenceRowToReadModel(row: EvidenceReadRow): ScoreEvidenceReadModel {
  return {
    evidenceKey: row.evidence_key,
    scoreSnapshotId: row.score_snapshot_id,
    scoreTs: normalizeDbDate(row.score_ts),
    windowMinutes: Number(row.window_minutes),
    coin: row.coin,
    eventId: row.event_id,
    eventReceivedAt: row.event_received_at ? normalizeDbDate(row.event_received_at) : null,
    entryId: row.entry_id,
    feedKey: row.feed_key,
    signalKey: row.signal_key,
    ruleKey: row.rule_key,
    side: row.side,
    contribution: numberOrZero(row.contribution ?? row.points),
    confidenceImpact: numberOrZero(row.confidence_impact),
    weight: numberOrZero(row.weight),
    decayMultiplier: numberOrZero(row.decay_multiplier),
    value: numberOrNull(row.value),
    unit: row.unit,
    reason: row.reason,
    source: row.source,
    sourceEventIds: stringArray(row.source_event_ids),
    sourceReceivedAt: normalizeDbDate(row.source_received_at),
    payload: isRecord(row.evidence_payload) ? row.evidence_payload : {}
  };
}

function currentScoreConfigRowToReadModel(row: CurrentScoreConfigRow): CurrentScoreConfigReadModel {
  return {
    scoreConfigVersion: row.score_config_version,
    description: row.description,
    config: row.config,
    active: row.active,
    activatedAt: row.activated_at ? normalizeDbDate(row.activated_at) : null,
    retiredAt: row.retired_at ? normalizeDbDate(row.retired_at) : null
  };
}

function evidenceSummaryFromRow(row: { evidence_total: number | string | null; top_rule_keys: string[] | string | null; feed_keys: string[] | string | null; sides: ScoreSide[] | string | null }): ScoreEvidenceSummary {
  return {
    total: Number(row.evidence_total ?? 0),
    topRuleKeys: stringArray(row.top_rule_keys).slice(0, 5),
    feedKeys: stringArray(row.feed_keys),
    sides: stringArray(row.sides).filter(isScoreSide)
  };
}

function matchesHalalInput(coin: string, halal: boolean): boolean {
  const normalized = normalizeCoin(coin);
  const isHalal = scoreHalalCoinSymbols().includes(normalized);
  return halal ? isHalal : !isHalal;
}

function normalizeCoin(value: string): string {
  return value.trim().toUpperCase();
}

function numberOrZero(value: number | string | null | undefined): number {
  return numberOrNull(value ?? null) ?? 0;
}

function stringArray(value: string[] | string | null | undefined): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return trimmed.slice(1, -1).split(',').map((item) => item.replace(/^"|"$/gu, '').trim()).filter(Boolean);
  }
  return [trimmed];
}

function isScoreSide(value: string): value is ScoreSide {
  return value === 'bull' || value === 'bear' || value === 'risk' || value === 'confidence';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function entryRowToSource(row: EntrySourceRow): ScoreSourceRow {
  return {
    source: 'entry',
    eventId: row.event_id,
    eventReceivedAt: normalizeDbDate(row.event_received_at),
    entryId: row.entry_id,
    feedKey: row.feed_key,
    coin: row.coin,
    parserStatus: row.parser_status ?? 'not_applicable',
    receivedAt: normalizeDbDate(row.received_at),
    rank: row.rank,
    amountUsd: numberOrNull(row.amount_usd),
    deltaUsd: numberOrNull(row.delta_usd),
    buyUsd: numberOrNull(row.buy_usd),
    sellUsd: numberOrNull(row.sell_usd),
    buySellRatio: numberOrNull(row.buy_sell_ratio),
    volume24hUsd: numberOrNull(row.volume_24h_usd),
    percent: numberOrNull(row.percent),
    priceChangePercent: numberOrNull(row.price_change_percent),
    oiChange15mPercent: numberOrNull(row.oi_change_15m_percent),
    oiChange30mPercent: numberOrNull(row.oi_change_30m_percent),
    totalAlerts: row.total_alerts,
    direction: row.direction,
    exchange: row.exchange,
    market: row.market,
    rawLine: row.raw_line
  };
}

function eventRowToSource(row: EventSourceRow): ScoreSourceRow {
  return {
    source: 'event',
    eventId: row.event_id,
    eventReceivedAt: normalizeDbDate(row.event_received_at),
    entryId: null,
    feedKey: row.feed_key,
    coin: row.coin,
    parserStatus: row.parser_status,
    receivedAt: normalizeDbDate(row.received_at),
    rank: null,
    amountUsd: null,
    deltaUsd: null,
    buyUsd: null,
    sellUsd: null,
    buySellRatio: null,
    volume24hUsd: null,
    percent: null,
    priceChangePercent: null,
    oiChange15mPercent: null,
    oiChange30mPercent: null,
    totalAlerts: null,
    direction: null,
    exchange: null,
    market: null,
    rawLine: row.title
  };
}

function numberOrNull(value: number | string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeDbDate(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

async function rollbackQuietly(client: PoolClient): Promise<void> {
  try {
    await client.query('rollback');
  } catch {
    // Preserve the original scoring write error.
  }
}
