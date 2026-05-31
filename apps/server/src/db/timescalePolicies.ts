import type { QueryResult, QueryResultRow } from 'pg';

import type { AppConfig } from '../config.js';

export type TimescalePolicyAction = 'applied' | 'skipped';

export interface TimescalePolicyResult {
  table: 'raw_events';
  policy: 'retention' | 'compression';
  afterDays: number;
  action: TimescalePolicyAction;
}

export interface TimescalePolicyApplyResult {
  enabled: boolean;
  results: TimescalePolicyResult[];
}

export interface TimescalePolicyPool {
  query<T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<T>>;
}

interface ExtensionRow extends QueryResultRow {
  exists: boolean;
}

interface HypertableRow extends QueryResultRow {
  hypertable_name: string;
}

const policyTables = ['raw_events'] as const;

export async function applyTimescalePolicies(pool: TimescalePolicyPool, config: AppConfig['database']['timescale']): Promise<TimescalePolicyApplyResult> {
  const hasTimescale = await pool.query<ExtensionRow>(`select exists (select 1 from pg_extension where extname = 'timescaledb') as exists`);
  if (!hasTimescale.rows[0]?.exists) throw new Error('TimescaleDB extension is not installed');

  const hypertables = await pool.query<HypertableRow>(
    `select hypertable_name
     from timescaledb_information.hypertables
     where hypertable_schema = current_schema()
       and hypertable_name = any($1::text[])`,
    [[...policyTables]]
  );
  const present = new Set(hypertables.rows.map((row) => row.hypertable_name));
  const missing = policyTables.filter((table) => !present.has(table));
  if (missing.length) throw new Error(`Timescale hypertables missing: ${missing.join(', ')}`);

  const results: TimescalePolicyResult[] = [];
  for (const table of policyTables) {
    const tableConfig = config.tables[table];
    await applyRetentionPolicy(pool, table, tableConfig.retentionDays);
    results.push({ table, policy: 'retention', afterDays: tableConfig.retentionDays, action: 'applied' });

    if (!config.compressionEnabled) {
      results.push({ table, policy: 'compression', afterDays: tableConfig.compressionAfterDays, action: 'skipped' });
      continue;
    }
    await applyCompressionPolicy(pool, table, tableConfig.compressionAfterDays);
    results.push({ table, policy: 'compression', afterDays: tableConfig.compressionAfterDays, action: 'applied' });
  }

  return { enabled: true, results };
}

async function applyRetentionPolicy(pool: TimescalePolicyPool, table: (typeof policyTables)[number], retentionDays: number): Promise<void> {
  await pool.query(`select remove_retention_policy('${table}'::regclass, if_exists => true)`);
  await pool.query(`select add_retention_policy('${table}'::regclass, drop_after => make_interval(days => $1::int), if_not_exists => true)`, [retentionDays]);
}

async function applyCompressionPolicy(pool: TimescalePolicyPool, table: (typeof policyTables)[number], compressionAfterDays: number): Promise<void> {
  await pool.query(`select remove_compression_policy('${table}'::regclass, if_exists => true)`);
  await pool.query(`select add_compression_policy('${table}'::regclass, compress_after => make_interval(days => $1::int), if_not_exists => true)`, [compressionAfterDays]);
}
