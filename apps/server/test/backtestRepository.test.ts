import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';

import { BacktestRepository } from '../src/db/backtestRepository.js';

describe('BacktestRepository', () => {
  it('builds lookahead-safe summary SQL over score snapshots, evidence, and forward returns', async () => {
    const pool = new FakePool();
    const repository = new BacktestRepository(pool);

    const rows = await repository.getSummary({
      scoreConfigVersion: 'rule-v1',
      windowMinutes: 15,
      horizonsMinutes: [5, 15],
      side: 'net',
      minConfidence: 50,
      minAbsScore: 20
    });

    const query = pool.queries[0];
    expect(query?.sql).toContain('from score_snapshots s');
    expect(query?.sql).toContain('exists (select 1 from score_evidence e');
    expect(query?.sql).toContain('left join forward_returns fr');
    expect(query?.sql).toContain('e.source_received_at <= s.ts');
    expect(query?.sql).toContain("fr.event_id = 'score:' || s.score_snapshot_id::text");
    expect(query?.sql).toContain('fr.base_ts >= s.ts');
    expect(query?.sql).toContain('abs(s.net_score)');
    expect(query?.values).toEqual(expect.arrayContaining(['rule-v1', 15, [5, 15], 'net', 50, 20]));
    expect(rows[0]).toMatchObject({ sampleCount: 2, statusCounts: { ready: 2, pending: 1 } });
  });

  it('uses score and rule aggregation queries for buckets and rule diagnostics', async () => {
    const pool = new FakePool();
    const repository = new BacktestRepository(pool);

    await repository.getScoreBuckets({
      scoreConfigVersion: 'rule-v1',
      windowMinutes: 15,
      horizonsMinutes: [60],
      side: 'bull',
      minConfidence: 0,
      minAbsScore: 0,
      bucketSize: 10,
      confidenceBucketSize: 25,
      minSamples: 1
    });
    await repository.getRulePerformance({
      scoreConfigVersion: 'rule-v1',
      windowMinutes: 15,
      horizonsMinutes: [60],
      side: 'net',
      minConfidence: 0,
      minAbsScore: 0,
      minContribution: 0,
      minSamples: 1,
      limit: 10
    });

    expect(pool.queries[0]?.sql).toContain('floor(score_value');
    expect(pool.queries[1]?.sql).toContain('with rule_samples as');
    expect(pool.queries[1]?.sql).toContain("e.side in ('bull', 'bear', 'risk', 'confidence')");
    expect(pool.queries[1]?.sql).toContain('lift_vs_all_signals');
  });
});

interface CapturedQuery {
  sql: string;
  values: unknown[];
}

class FakePool {
  readonly queries: CapturedQuery[] = [];

  async query<T extends QueryResultRow = QueryResultRow>(sql: string, values: unknown[] = []): Promise<QueryResult<T>> {
    this.queries.push({ sql, values });
    if (sql.includes('metric_rows as')) {
      return { rows: [{
        score_config_version: 'rule-v1',
        window_minutes: 15,
        horizon_minutes: 15,
        side: 'net',
        total_count: 3,
        sample_count: 2,
        pending_count: 1,
        missing_label_count: 1,
        average_forward_return_pct: 1.5,
        median_forward_return_pct: 1.5,
        win_rate: 0.5,
        loss_rate: 0.5,
        average_max_adverse_move_pct: -1,
        median_max_adverse_move_pct: -1,
        average_score: 60,
        average_confidence_score: 80,
        status_counts: { ready: 2, pending: 1 }
      }] as unknown as T[] } as QueryResult<T>;
    }
    return { rows: [] as T[] } as QueryResult<T>;
  }
}
