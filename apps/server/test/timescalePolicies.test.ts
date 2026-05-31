import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config.js';
import { applyTimescalePolicies } from '../src/db/timescalePolicies.js';

describe('Timescale policy application', () => {
  it('applies retention policies and skips compression when disabled', async () => {
    const pool = new FakePolicyPool();
    const config = loadConfig({}).database.timescale;

    const result = await applyTimescalePolicies(pool, config);

    expect(result.results.filter((row) => row.policy === 'retention').every((row) => row.action === 'applied')).toBe(true);
    expect(result.results.filter((row) => row.policy === 'compression').every((row) => row.action === 'skipped')).toBe(true);
    expect(pool.sql()).toContain("select add_retention_policy('raw_events'::regclass");
    expect(pool.sql()).not.toContain('add_compression_policy');
    expect(pool.sql()).not.toContain('price_ticks');
    expect(pool.sql()).not.toContain('score_snapshots');
  });

  it('applies compression policies using derived windows when enabled', async () => {
    const pool = new FakePolicyPool();
    const config = loadConfig({ TIMESCALE_COMPRESSION_ENABLED: 'true', RAW_EVENTS_RETENTION_DAYS: '31' }).database.timescale;

    await applyTimescalePolicies(pool, config);

    expect(pool.sql()).toContain("select add_compression_policy('raw_events'::regclass");
    expect(pool.queries.find((query) => query.sql.includes("add_compression_policy('raw_events'"))?.values).toEqual([2]);
  });

  it('fails safely when Timescale is unavailable', async () => {
    const pool = new FakePolicyPool({ timescaleInstalled: false });

    await expect(applyTimescalePolicies(pool, loadConfig({}).database.timescale)).rejects.toThrow('TimescaleDB extension is not installed');
    expect(pool.sql()).not.toContain('add_retention_policy');
  });
});

interface CapturedQuery {
  sql: string;
  values: unknown[];
}

class FakePolicyPool {
  readonly queries: CapturedQuery[] = [];

  constructor(private readonly options: { timescaleInstalled?: boolean } = {}) {}

  async query<T extends QueryResultRow = QueryResultRow>(sql: string, values: unknown[] = []): Promise<QueryResult<T>> {
    this.queries.push({ sql, values });
    if (sql.includes('pg_extension')) return { rows: [{ exists: this.options.timescaleInstalled ?? true }] as unknown as T[] } as QueryResult<T>;
    if (sql.includes('timescaledb_information.hypertables')) {
      return { rows: [{ hypertable_name: 'raw_events' }] as unknown as T[] } as QueryResult<T>;
    }
    return { rows: [] as T[] } as QueryResult<T>;
  }

  sql(): string {
    return this.queries.map((query) => query.sql).join('\n');
  }
}
