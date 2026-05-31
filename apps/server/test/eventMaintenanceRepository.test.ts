import { describe, expect, it } from 'vitest';

import { EventMaintenanceRepository } from '../src/db/eventRepository.js';

describe('EventMaintenanceRepository', () => {
  it('deletes event history older than the retention cutoff from all durable event tables', async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const pool = {
      async connect() {
        return {
          async query(text: string, values?: unknown[]) {
            queries.push(values === undefined ? { text } : { text, values });
            if (text.trim().startsWith('delete from')) return { rowCount: 3, rows: [] };
            return { rowCount: null, rows: [] };
          },
          release() {}
        };
      }
    };
    const repository = new EventMaintenanceRepository(pool as never);

    const result = await repository.deleteHistoryOlderThan(7, new Date('2026-05-31T12:00:00.000Z'));

    expect(result.retentionDays).toBe(7);
    expect(result.cutoff).toBe('2026-05-24T12:00:00.000Z');
    expect(result.rowsDeleted).toBe(21);
    expect(result.tables.map((table) => table.table)).toEqual([
      'event_entries',
      'normalized_events',
      'raw_events',
      'event_entry_keys',
      'normalized_event_keys',
      'raw_event_keys',
      'ingestion_errors'
    ]);
    expect(queries.map((query) => query.text.trim())).toContain('begin');
    expect(queries.map((query) => query.text.trim())).toContain('commit');
    expect(queries.filter((query) => query.text.includes('$1')).every((query) => query.values?.[0] === '2026-05-24T12:00:00.000Z')).toBe(true);
  });
});
