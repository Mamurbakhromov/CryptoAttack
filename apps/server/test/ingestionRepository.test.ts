import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';

import { buildRawIdempotencyKey, EventIngestionRepository } from '../src/db/eventRepository.js';
import type { FeedKey, NormalizedEvent } from '../src/events/types.js';

describe('EventIngestionRepository', () => {
  it('persists raw, normalized, and entry rows in one transaction', async () => {
    const client = new FakeClient();
    const repository = new EventIngestionRepository({ connect: async () => client.asPoolClient() });
    const raw = { id: 'provider-1', chapter: 'cex_alerts', category: 'all_spot_top', timestamp: '2026-01-01T00:00:00.000Z' };
    const event = makeEvent('provider-1:all_spot_top_buy_5m', 'all_spot_top_buy_5m');

    const result = await repository.ingestRawEvent({
      raw,
      endpoint: 'main',
      receivedAt: event.receivedAt,
      normalizedEvents: [event]
    });

    expect(result).toMatchObject({ rawEventId: 'raw-id-1', normalizedEventCount: 1, entryCount: 1 });
    expect(client.queries.map((query) => normalizeSqlKind(query.sql))).toEqual([
      'begin',
      'raw_event_keys',
      'raw_events',
      'normalized_event_keys',
      'normalized_events',
      'event_entry_keys',
      'event_entries',
      'commit'
    ]);
    expect(client.released).toBe(true);
    expect(client.findQuery('insert into raw_events')?.values).toEqual(
      expect.arrayContaining(['main', 'provider-1', 'cex_alerts', 'all_spot_top', ['provider-1:all_spot_top_buy_5m'], ['all_spot_top_buy_5m']])
    );
    expect(client.findQuery('insert into normalized_events')?.values).toContain('all_spot_top_buy_5m');
    expect(client.findQuery('insert into event_entries')?.values).toContain('BTCUSDT');
  });

  it('rolls back when a child insert fails', async () => {
    const client = new FakeClient('insert into event_entries');
    const repository = new EventIngestionRepository({ connect: async () => client.asPoolClient() });

    await expect(
      repository.ingestRawEvent({
        raw: { id: 'provider-1', chapter: 'cex_alerts', category: 'all_spot_top' },
        endpoint: 'main',
        receivedAt: '2026-01-01T00:00:00.000Z',
        normalizedEvents: [makeEvent('event-1', 'all_spot_top_buy_5m')]
      })
    ).rejects.toThrow('forced insert failure');

    expect(client.queries.map((query) => query.sql)).toContain('rollback');
  });

  it('builds stable raw idempotency keys from provider ids or payload hashes', () => {
    expect(buildRawIdempotencyKey({ id: 'abc', chapter: 'signals', category: 'pricealerts' })).toBe('cryptoattack:id:signals:pricealerts:abc');
    expect(buildRawIdempotencyKey({ b: 2, a: 1 })).toBe(buildRawIdempotencyKey({ a: 1, b: 2 }));
  });
});

interface CapturedQuery {
  sql: string;
  values: unknown[];
}

class FakeClient {
  readonly queries: CapturedQuery[] = [];
  released = false;

  constructor(private readonly failOnSqlPrefix: string | null = null) {}

  asPoolClient() {
    return this as never;
  }

  async query<T extends QueryResultRow = QueryResultRow>(sql: string, values: unknown[] = []): Promise<QueryResult<T>> {
    this.queries.push({ sql, values });
    if (this.failOnSqlPrefix && sql.startsWith(this.failOnSqlPrefix)) throw new Error('forced insert failure');
    if (sql.startsWith('insert into raw_event_keys')) return { rows: [{ raw_event_id: 'raw-id-1', raw_received_at: '2026-01-01T00:00:00.000Z' }] as unknown as T[] } as QueryResult<T>;
    if (sql.startsWith('insert into normalized_event_keys')) return { rows: [{ received_at: '2026-01-01T00:00:00.000Z' }] as unknown as T[] } as QueryResult<T>;
    if (sql.startsWith('insert into event_entry_keys')) return { rows: [{ entry_id: 'entry-id-1', received_at: '2026-01-01T00:00:00.000Z' }] as unknown as T[] } as QueryResult<T>;
    return { rows: [] as T[] } as QueryResult<T>;
  }

  release(): void {
    this.released = true;
  }

  findQuery(prefix: string): CapturedQuery | undefined {
    return this.queries.find((query) => query.sql.startsWith(prefix));
  }
}

function normalizeSqlKind(sql: string): string {
  if (sql === 'begin' || sql === 'commit' || sql === 'rollback') return sql;
  if (sql.startsWith('insert into raw_event_keys')) return 'raw_event_keys';
  if (sql.startsWith('insert into raw_events')) return 'raw_events';
  if (sql.startsWith('insert into normalized_event_keys')) return 'normalized_event_keys';
  if (sql.startsWith('insert into normalized_events')) return 'normalized_events';
  if (sql.startsWith('insert into event_entry_keys')) return 'event_entry_keys';
  if (sql.startsWith('insert into event_entries')) return 'event_entries';
  return sql;
}

function makeEvent(id: string, feedKey: FeedKey): NormalizedEvent {
  return {
    id,
    feedKey,
    chapter: 'cex_alerts',
    category: 'all_spot_top',
    title: 'Top Spot Buy',
    plainText: 'Top spot buy #BTC',
    htmlText: 'Top spot buy #BTC',
    coins: ['BTC'],
    filters: ['buy', '5m'],
    timestamp: '2026-01-01T00:00:00.000Z',
    sourceTime: Date.parse('2026-01-01T00:00:00.000Z'),
    receivedAt: '2026-01-01T00:00:00.000Z',
    latencyMs: 20,
    severity: 'info',
    raw: {},
    endpoint: 'main',
    entries: [
      {
        rank: 1,
        coin: 'BTC',
        pair: 'BTCUSDT',
        amountUsd: 1_000_000,
        amountAsset: 'BTC',
        buyUsd: 1_200_000,
        sellUsd: 200_000,
        deltaUsd: 1_000_000,
        buySellRatio: 6,
        volume24hUsd: 50_000_000,
        volume24hAsset: 'BTC',
        percent: 5,
        priceUsd: 50_000,
        priceChangePercent: 1.5,
        direction: 'buy',
        interval: '5m',
        exchange: 'Binance',
        rawLine: '#BTC BTCUSDT +5%'
      }
    ],
    amountMetric: null,
    parserStatus: 'parsed'
  };
}
