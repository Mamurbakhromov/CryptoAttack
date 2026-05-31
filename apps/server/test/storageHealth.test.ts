import { fileURLToPath } from 'node:url';

import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';

import { StorageHealthService } from '../src/db/storageHealth.js';

describe('StorageHealthService', () => {
  it('maps database, migration, and table size health', async () => {
    const pool = new FakeHealthPool();
    const service = new StorageHealthService(pool, fileURLToPath(new URL('../migrations', import.meta.url)));

    const health = await service.getHealth();

    expect(health.connected).toBe(true);
    expect(health.migration.version).toBe('000009');
    expect(health.migration.pending).toBe(0);
    expect(health.tableSizes.raw_events).toEqual({ estimatedRows: 42, totalBytes: 4096 });
  });
});

class FakeHealthPool {
  async query<T extends QueryResultRow = QueryResultRow>(sql: string): Promise<QueryResult<T>> {
    if (sql === 'select 1') return { rows: [{ '?column?': 1 }] as unknown as T[] } as QueryResult<T>;
    if (sql.startsWith('create table if not exists schema_migrations')) return { rows: [] as T[] } as QueryResult<T>;
    if (sql.startsWith('select version')) {
      return { rows: [
        { version: '000001', filename: '000001_initial_timescale_schema.sql', checksum: null, applied_at: new Date('2026-01-01T00:00:00.000Z') },
        { version: '000002', filename: '000002_ingestion_idempotency_keys.sql', checksum: null, applied_at: new Date('2026-01-01T00:00:00.000Z') },
        { version: '000003', filename: '000003_price_labels_context.sql', checksum: null, applied_at: new Date('2026-01-01T00:00:00.000Z') },
        { version: '000004', filename: '000004_scoring_evidence_fields.sql', checksum: null, applied_at: new Date('2026-01-01T00:00:00.000Z') },
        { version: '000005', filename: '000005_backtest_analytics_indexes.sql', checksum: null, applied_at: new Date('2026-01-01T00:00:00.000Z') },
        { version: '000006', filename: '000006_timescale_compression_settings.sql', checksum: null, applied_at: new Date('2026-01-01T00:00:00.000Z') },
        { version: '000007', filename: '000007_forward_return_identity.sql', checksum: null, applied_at: new Date('2026-01-01T00:00:00.000Z') },
        { version: '000008', filename: '000008_current_score_payload.sql', checksum: null, applied_at: new Date('2026-01-01T00:00:00.000Z') },
        { version: '000009', filename: '000009_remove_scoring_storage.sql', checksum: null, applied_at: new Date('2026-01-01T00:00:00.000Z') }
      ] as unknown as T[] } as QueryResult<T>;
    }
    if (sql.includes('from pg_class')) {
      return { rows: [{ relname: 'raw_events', estimated_rows: 42, total_bytes: 4096 }] as unknown as T[] } as QueryResult<T>;
    }
    return { rows: [] as T[] } as QueryResult<T>;
  }
}
