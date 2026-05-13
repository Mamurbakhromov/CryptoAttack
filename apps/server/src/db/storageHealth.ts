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

export interface LatestPriceTickHealth {
  ts: string | null;
  collectedAt: string | null;
  source: string | null;
  exchange: string | null;
  market: string | null;
  symbol: string | null;
  coin: string | null;
}

export interface ForwardReturnBacklogHealth {
  pending: number;
  due: number;
  missingPrice: number;
  failed: number;
  oldestDueTargetTs: string | null;
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
  latestPriceTick: LatestPriceTickHealth;
  forwardReturnBacklog: ForwardReturnBacklogHealth;
  tableSizes: Record<string, TableSizeHealth>;
}

interface PriceTickRow extends QueryResultRow {
  ts: Date | string | null;
  collected_at: Date | string | null;
  source: string | null;
  exchange: string | null;
  market: string | null;
  symbol: string | null;
  coin: string | null;
}

interface BacklogRow extends QueryResultRow {
  pending: number | string;
  due: number | string;
  missing_price: number | string;
  failed: number | string;
  oldest_due_target_ts: Date | string | null;
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
  'price_ticks',
  'score_snapshots',
  'coin_score_current',
  'score_evidence',
  'forward_returns',
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
      health.latestPriceTick = await this.getLatestPriceTick();
    } catch (error) {
      errors.push(errorMessage(error));
    }
    try {
      health.forwardReturnBacklog = await this.getForwardReturnBacklog();
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

  private async getLatestPriceTick(): Promise<LatestPriceTickHealth> {
    const result = await this.pool.query<PriceTickRow>(
      `select ts, collected_at, source, exchange, market, symbol, coin
       from price_ticks
       order by ts desc
       limit 1`
    );
    const row = result.rows[0];
    return row ? {
      ts: normalizeDbDate(row.ts),
      collectedAt: normalizeDbDate(row.collected_at),
      source: row.source,
      exchange: row.exchange,
      market: row.market,
      symbol: row.symbol,
      coin: row.coin
    } : emptyLatestPriceTick();
  }

  private async getForwardReturnBacklog(): Promise<ForwardReturnBacklogHealth> {
    const result = await this.pool.query<BacklogRow>(
      `select count(*) filter (where status = 'pending')::int as pending,
              count(*) filter (where status = 'pending' and target_ts <= now())::int as due,
              count(*) filter (where status in ('missing_price', 'missing_base_price', 'missing_future_price'))::int as missing_price,
              count(*) filter (where status = 'error')::int as failed,
              min(target_ts) filter (where status = 'pending' and target_ts <= now()) as oldest_due_target_ts
       from forward_returns`
    );
    const row = result.rows[0];
    return {
      pending: Number(row?.pending ?? 0),
      due: Number(row?.due ?? 0),
      missingPrice: Number(row?.missing_price ?? 0),
      failed: Number(row?.failed ?? 0),
      oldestDueTargetTs: normalizeDbDate(row?.oldest_due_target_ts ?? null)
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
    latestPriceTick: emptyLatestPriceTick(),
    forwardReturnBacklog: { pending: 0, due: 0, missingPrice: 0, failed: 0, oldestDueTargetTs: null },
    tableSizes: {}
  };
}

function emptyLatestPriceTick(): LatestPriceTickHealth {
  return { ts: null, collectedAt: null, source: null, exchange: null, market: null, symbol: null, coin: null };
}

function normalizeDbDate(value: Date | string | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
