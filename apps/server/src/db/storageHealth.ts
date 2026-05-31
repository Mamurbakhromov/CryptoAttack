import type { QueryResult, QueryResultRow } from 'pg';

import { getMigrationStatus } from './migrations.js';

export interface StorageHealthPool {
  query<T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<T>>;
}

export interface MigrationHealth {
  version: string | null;
  applied: number | null;
  pending: number | null;
  checksumMismatch: boolean | null;
}

export interface TableSizeHealth {
  estimatedRows: number;
  totalBytes: number;
}

export interface DatabaseHealthSnapshot {
  enabled: boolean;
  connected: boolean | null;
  lastProbeAt: string | null;
  lastProbeError: string | null;
  migration: MigrationHealth;
  tableSizes: Record<string, TableSizeHealth>;
}

interface TableSizeRow extends QueryResultRow {
  relname: string;
  estimated_rows: number | string;
  total_bytes: number | string;
}

const tableSizeNames = [
  'raw_events',
  'normalized_events',
  'event_entries',
  'raw_event_keys',
  'normalized_event_keys',
  'event_entry_keys',
  'ingestion_errors'
];

export class StorageHealthService {
  constructor(private readonly pool: StorageHealthPool, private readonly migrationsDir: string) {}

  async getHealth(): Promise<DatabaseHealthSnapshot> {
    const lastProbeAt = new Date().toISOString();
    try {
      await this.pool.query('select 1');
    } catch (error) {
      return { ...disabledDatabaseHealth(true), connected: false, lastProbeAt, lastProbeError: errorMessage(error) };
    }

    const health: DatabaseHealthSnapshot = { ...disabledDatabaseHealth(true), connected: true, lastProbeAt, lastProbeError: null };
    const errors: string[] = [];

    try {
      health.migration = await this.getMigrationHealth();
    } catch (error) {
      errors.push(errorMessage(error));
    }
    try {
      health.tableSizes = await this.getTableSizes();
    } catch (error) {
      errors.push(errorMessage(error));
    }

    health.lastProbeError = errors[0] ?? null;
    return health;
  }

  private async getMigrationHealth(): Promise<MigrationHealth> {
    const status = await getMigrationStatus(this.pool, this.migrationsDir);
    const applied = status.migrations.filter((entry) => entry.applied);
    return {
      version: applied.at(-1)?.version ?? null,
      applied: status.appliedCount,
      pending: status.pendingCount,
      checksumMismatch: status.migrations.some((entry) => entry.checksumMatches === false)
    };
  }

  private async getTableSizes(): Promise<Record<string, TableSizeHealth>> {
    const result = await this.pool.query<TableSizeRow>(
      `select relname,
              greatest(reltuples, 0)::bigint as estimated_rows,
              pg_total_relation_size(oid)::bigint as total_bytes
       from pg_class
       where relkind in ('r', 'p')
         and relname = any($1::text[])`,
      [tableSizeNames]
    );
    return Object.fromEntries(result.rows.map((row) => [row.relname, { estimatedRows: Number(row.estimated_rows), totalBytes: Number(row.total_bytes) }]));
  }
}

export function disabledDatabaseHealth(enabled = false): DatabaseHealthSnapshot {
  return {
    enabled,
    connected: enabled ? false : null,
    lastProbeAt: null,
    lastProbeError: null,
    migration: { version: null, applied: null, pending: null, checksumMismatch: null },
    tableSizes: {}
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
