import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { QueryResult, QueryResultRow } from 'pg';
import { afterEach, describe, expect, it } from 'vitest';

import { formatMigrationStatus, getMigrationStatus, loadMigrationFiles, type MigrationQueryable } from '../src/db/migrations.js';

const tempDirs: string[] = [];

describe('database migrations', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  it('loads SQL migrations in lexical order with stable versions and checksums', async () => {
    const dir = await makeTempDir();
    await writeFile(join(dir, '000002_second.sql'), 'select 2;', 'utf8');
    await writeFile(join(dir, '000001_first.sql'), 'select 1;', 'utf8');
    await writeFile(join(dir, 'README.md'), 'ignored', 'utf8');

    const migrations = await loadMigrationFiles(dir);

    expect(migrations.map((migration) => migration.version)).toEqual(['000001', '000002']);
    expect(migrations.map((migration) => migration.filename)).toEqual(['000001_first.sql', '000002_second.sql']);
    expect(migrations[0]?.checksum).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('rejects duplicate leading migration versions', async () => {
    const dir = await makeTempDir();
    await writeFile(join(dir, '000001_first.sql'), 'select 1;', 'utf8');
    await writeFile(join(dir, '000001_duplicate.sql'), 'select 2;', 'utf8');

    await expect(loadMigrationFiles(dir)).rejects.toThrow('Duplicate migration version: 000001');
  });

  it('reports applied, pending, and checksum-mismatched migrations', async () => {
    const dir = await makeTempDir();
    await writeFile(join(dir, '000001_first.sql'), 'select 1;', 'utf8');
    await writeFile(join(dir, '000002_second.sql'), 'select 2;', 'utf8');
    const queries: string[] = [];
    const client = fakeMigrationClient(queries, [
      {
        version: '000001',
        filename: '000001_first.sql',
        checksum: 'old-checksum',
        applied_at: new Date('2026-01-01T00:00:00.000Z')
      }
    ]);

    const status = await getMigrationStatus(client, dir);

    expect(queries[0]).toContain('create table if not exists schema_migrations');
    expect(status.appliedCount).toBe(1);
    expect(status.pendingCount).toBe(1);
    expect(status.migrations[0]).toMatchObject({ version: '000001', applied: true, checksumMatches: false });
    expect(status.migrations[1]).toMatchObject({ version: '000002', applied: false, checksumMatches: null });
    expect(formatMigrationStatus(status)).toContain('applied checksum-mismatch 000001_first.sql');
  });

  it('declares the required initial storage and scoring schema', async () => {
    const sql = await readFile(new URL('../migrations/000001_initial_timescale_schema.sql', import.meta.url), 'utf8');
    const requiredTables = [
      'schema_migrations',
      'raw_events',
      'normalized_events',
      'normalized_event_keys',
      'event_entries',
      'event_entry_keys',
      'price_ticks',
      'score_config_versions',
      'score_snapshots',
      'coin_score_current',
      'score_evidence',
      'forward_returns',
      'ingestion_errors',
      'raw_event_keys'
    ];
    const idempotencySql = await readFile(new URL('../migrations/000002_ingestion_idempotency_keys.sql', import.meta.url), 'utf8');
    const combinedSql = `${sql}\n${idempotencySql}`;

    for (const table of requiredTables) {
      expect(combinedSql).toContain(`create table if not exists ${table}`);
    }

    expect(sql).toContain("create_hypertable('raw_events', 'received_at'");
    expect(sql).toContain("create_hypertable('normalized_events', 'received_at'");
    expect(sql).toContain("create_hypertable('event_entries', 'received_at'");
    expect(sql).toContain("create_hypertable('price_ticks', 'ts'");
    expect(sql).toContain("create_hypertable('score_snapshots', 'ts'");
    expect(sql).toContain("create_hypertable('forward_returns', 'event_received_at'");
    const priceContextSql = await readFile(new URL('../migrations/000003_price_labels_context.sql', import.meta.url), 'utf8');
    expect(priceContextSql).toContain('alter table price_ticks add column if not exists base_asset text');
    expect(priceContextSql).toContain('alter table price_ticks add column if not exists collected_at timestamptz');
    expect(priceContextSql).toContain('alter table forward_returns add column if not exists entry_id uuid');
    expect(priceContextSql).toContain('create unique index if not exists forward_returns_entry_horizon_idx');
    const scoringSql = await readFile(new URL('../migrations/000004_scoring_evidence_fields.sql', import.meta.url), 'utf8');
    expect(scoringSql).toContain("check (side in ('bull', 'bear', 'risk', 'confidence'))");
    expect(scoringSql).toContain('alter table score_evidence add column if not exists rule_key text');
    expect(scoringSql).toContain('alter table score_evidence add column if not exists contribution double precision');
    expect(scoringSql).toContain('create unique index if not exists score_evidence_key_idx');
    const backtestSql = await readFile(new URL('../migrations/000005_backtest_analytics_indexes.sql', import.meta.url), 'utf8');
    expect(backtestSql).toContain('create index if not exists score_snapshots_backtest_idx');
    expect(backtestSql).toContain('create index if not exists score_evidence_backtest_idx');
    expect(backtestSql).toContain('create index if not exists forward_returns_backtest_event_idx');
    const compressionSql = await readFile(new URL('../migrations/000006_timescale_compression_settings.sql', import.meta.url), 'utf8');
    expect(compressionSql).toContain('alter table raw_events set');
    expect(compressionSql).toContain('alter table price_ticks set');
    expect(compressionSql).toContain('alter table score_snapshots set');
    expect(compressionSql).toContain('timescaledb.compress');
    const forwardReturnIdentitySql = await readFile(new URL('../migrations/000007_forward_return_identity.sql', import.meta.url), 'utf8');
    expect(forwardReturnIdentitySql).toContain('alter table forward_returns drop constraint if exists forward_returns_pkey');
    expect(forwardReturnIdentitySql).toContain('create unique index if not exists forward_returns_event_horizon_null_entry_idx');
  });
});

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'cryptoattack-migrations-'));
  tempDirs.push(dir);
  return dir;
}

function fakeMigrationClient(queries: string[], appliedRows: QueryResultRow[]): MigrationQueryable {
  return {
    async query<T extends QueryResultRow = QueryResultRow>(sql: string): Promise<QueryResult<T>> {
      queries.push(sql);
      if (sql.startsWith('select version')) return { rows: appliedRows as T[] } as QueryResult<T>;
      return { rows: [] as T[] } as QueryResult<T>;
    }
  };
}
