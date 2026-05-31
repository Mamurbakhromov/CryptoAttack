import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';

import { ScoreRepository } from '../src/db/scoreRepository.js';
import { defaultScoreConfig } from '../src/scoring/defaultScoreConfig.js';
import type { ScoreResult } from '../src/scoring/types.js';

describe('ScoreRepository', () => {
  it('inserts active score config versions transactionally', async () => {
    const client = new FakeClient();
    const repository = new ScoreRepository({ connect: async () => client.asPoolClient(), query: client.query.bind(client) });

    await repository.ensureScoreConfig(defaultScoreConfig);

    expect(client.queries.map((query) => normalizeSql(query.sql))).toEqual(['begin', 'update score_config_versions', 'insert into score_config_versions', 'commit']);
    expect(client.findQuery('insert into score_config_versions')?.values[0]).toBe(defaultScoreConfig.version);
  });

  it('writes snapshots, current scores, and evidence in one transaction', async () => {
    const client = new FakeClient();
    const repository = new ScoreRepository({ connect: async () => client.asPoolClient(), query: client.query.bind(client) });

    const result = await repository.writeScores([makeScoreResult()], defaultScoreConfig);

    expect(result).toEqual({ snapshotsWritten: 1, evidenceWritten: 1, currentWritten: 1, skippedSnapshots: 0 });
    expect(client.queries.map((query) => normalizeSql(query.sql))).toEqual([
      'begin',
      'select current',
      'insert into score_snapshots',
      'insert into score_evidence',
      'insert into coin_score_current',
      'commit'
    ]);
    expect(client.findQuery('insert into score_evidence')?.sql).toContain('on conflict (evidence_key) do update');
    const currentQuery = client.findQuery('insert into coin_score_current');
    expect(currentQuery?.sql).toContain('snapshot_payload');
    expect(currentQuery?.sql).toContain('snapshot_payload = excluded.snapshot_payload');
    expect(currentQuery?.sql).toContain('where excluded.latest_score_ts >= coin_score_current.latest_score_ts');
    expect(currentQuery?.values).toContainEqual({ test: true });
  });

  it('scopes current score summaries and filters to the latest score timestamp', async () => {
    const pool = new FakeReadPool();
    const repository = new ScoreRepository(pool);

    await repository.getCurrentScores({
      scoreConfigVersion: 'rule-v1',
      windowMinutes: 15,
      limit: 10,
      exchange: 'binance',
      market: 'spot'
    });

    const query = pool.queries[0]?.sql ?? '';
    expect(query).toContain('e_filter.score_ts = c.latest_score_ts');
    expect(query).toContain('e.score_ts = c.latest_score_ts');
    expect(query).toContain("lower(coalesce(e_filter.evidence_payload->>'exchange', ''))");
  });

  it('filters bull and bear current lists by net edge direction', async () => {
    const pool = new FakeReadPool();
    const repository = new ScoreRepository(pool);

    await repository.getCurrentScores({ scoreConfigVersion: 'rule-v1', windowMinutes: 15, limit: 10, side: 'bull' });
    await repository.getCurrentScores({ scoreConfigVersion: 'rule-v1', windowMinutes: 15, limit: 10, side: 'bear' });
    await repository.getCurrentScores({ scoreConfigVersion: 'rule-v1', windowMinutes: 15, limit: 10, side: 'net' });

    expect(pool.queries[0]?.sql).toContain('c.net_score > 0');
    expect(pool.queries[0]?.sql).toContain('order by net_score desc, bull_score desc');
    expect(pool.queries[1]?.sql).toContain('c.net_score < 0');
    expect(pool.queries[1]?.sql).toContain('order by net_score asc, bear_score desc');
    expect(pool.queries[2]?.sql).not.toContain('c.net_score > 0');
    expect(pool.queries[2]?.sql).not.toContain('c.net_score < 0');
  });

  it('surfaces flow-v2 state, action, and component breakdown from current score payloads', async () => {
    const pool = new FakeReadPool([
      {
        score_config_version: 'flow-v2',
        window_minutes: 15,
        coin: 'HYPE',
        latest_score_ts: '2026-01-01T00:15:00.000Z',
        bull_score: 37.71,
        bear_score: 0,
        net_score: 37.71,
        confidence_score: 80,
        rank: 1,
        updated_at: '2026-01-01T00:15:01.000Z',
        dominant_signal: 'flow_spot_buy',
        market_regime: 'bullish',
        primary_reason: 'Spot buy pressure',
        risk_tags: [],
        evidence_total: 1,
        top_rule_keys: ['flow_spot_buy'],
        feed_keys: ['flow_spot'],
        sides: ['bull'],
        recent_score_delta: 10,
        snapshot_payload: {
          scoreState: 'clean_bull',
          tradeAction: 'WATCH',
          componentScores: { spot: { bull: 32.05, bear: 0 } },
          flowBreakdown: [{ family: 'spot', side: 'bull', score: 32.05 }]
        }
      }
    ]);
    const repository = new ScoreRepository(pool);

    const scores = await repository.getCurrentScores({ scoreConfigVersion: 'flow-v2', windowMinutes: 15, limit: 10, side: 'bull' });

    expect(pool.queries[0]?.sql).toContain('c.snapshot_payload');
    expect(pool.queries[0]?.sql).not.toContain('delta.snapshot_payload');
    expect(scores[0]).toMatchObject({
      scoreState: 'clean_bull',
      tradeAction: 'WATCH',
      componentScores: { spot: { bull: 32.05, bear: 0 } },
      flowBreakdown: [{ family: 'spot', side: 'bull', score: 32.05 }]
    });
  });
});

interface CapturedQuery {
  sql: string;
  values: unknown[];
}

class FakeClient {
  readonly queries: CapturedQuery[] = [];

  asPoolClient() {
    return this as never;
  }

  async query<T extends QueryResultRow = QueryResultRow>(sql: string, values: unknown[] = []): Promise<QueryResult<T>> {
    this.queries.push({ sql, values });
    if (sql.includes('returning score_snapshot_id')) return { rows: [{ score_snapshot_id: 'snapshot-id-1' }] as unknown as T[] } as QueryResult<T>;
    return { rows: [] as T[] } as QueryResult<T>;
  }

  release(): void {}

  findQuery(prefix: string): CapturedQuery | undefined {
    return this.queries.find((query) => query.sql.trim().startsWith(prefix));
  }
}

class FakeReadPool {
  readonly queries: CapturedQuery[] = [];

  constructor(private readonly rows: QueryResultRow[] = []) {}

  async connect() {
    return new FakeClient().asPoolClient();
  }

  async query<T extends QueryResultRow = QueryResultRow>(sql: string, values: unknown[] = []): Promise<QueryResult<T>> {
    this.queries.push({ sql, values });
    return { rows: this.rows as T[] } as QueryResult<T>;
  }
}

function makeScoreResult(): ScoreResult {
  return {
    scoreConfigVersion: defaultScoreConfig.version,
    ts: '2026-01-01T00:00:00.000Z',
    windowMinutes: 15,
    coin: 'BTC',
    bullScore: 70,
    bearScore: 5,
    netScore: 65,
    confidenceScore: 80,
    eventCount: 2,
    evidenceCount: 1,
    dominantSignal: 'price_alert_up',
    marketRegime: 'bullish',
    scoreHash: 'score-hash',
    evidenceHash: 'evidence-hash',
    payload: { test: true },
    evidence: [
      {
        evidenceKey: 'evidence-key-1',
        coin: 'BTC',
        side: 'bull',
        ruleKey: 'price_alert_up',
        contribution: 10,
        confidenceImpact: 2,
        weight: 10,
        decayMultiplier: 1,
        value: 4,
        unit: 'percent',
        source: 'entry',
        feedKey: 'pricealerts',
        eventId: 'event-1',
        eventReceivedAt: '2026-01-01T00:00:00.000Z',
        entryId: 'entry-1',
        sourceEventIds: ['event-1'],
        sourceReceivedAt: '2026-01-01T00:00:00.000Z',
        reason: 'Upward price alert',
        payload: {}
      }
    ]
  };
}

function normalizeSql(sql: string): string {
  const trimmed = sql.trim();
  if (trimmed === 'begin' || trimmed === 'commit' || trimmed === 'rollback') return trimmed;
  if (trimmed.startsWith('update score_config_versions')) return 'update score_config_versions';
  if (trimmed.startsWith('insert into score_config_versions')) return 'insert into score_config_versions';
  if (trimmed.startsWith('select bull_score')) return 'select current';
  if (trimmed.startsWith('insert into score_snapshots')) return 'insert into score_snapshots';
  if (trimmed.startsWith('insert into score_evidence')) return 'insert into score_evidence';
  if (trimmed.startsWith('insert into coin_score_current')) return 'insert into coin_score_current';
  return trimmed;
}
