import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';

import { MarketDataRepository } from '../src/db/marketDataRepository.js';

describe('MarketDataRepository', () => {
  it('upserts price ticks with explicit source and collected timestamps', async () => {
    const client = new FakeClient();
    const repository = new MarketDataRepository({ connect: async () => client.asPoolClient(), query: async () => ({ rows: [] }) as unknown as QueryResult });

    await repository.upsertPriceTicks([
      {
        source: 'public_rest',
        exchange: 'binance',
        market: 'spot',
        symbol: 'BTCUSDT',
        baseAsset: 'BTC',
        quoteAsset: 'USDT',
        sourceTs: '2026-01-01T00:00:00.000Z',
        collectedAt: '2026-01-01T00:00:01.000Z',
        price: 50_000,
        payload: { sample: true }
      }
    ]);

    const insert = client.queries.find((query) => query.sql.startsWith('insert into price_ticks'));
    expect(client.queries.map((query) => query.sql)).toEqual(expect.arrayContaining(['begin', 'commit']));
    expect(insert?.sql).toContain('on conflict (source, exchange, market, symbol, ts) do update');
    expect(insert?.values).toEqual(expect.arrayContaining(['public_rest', 'binance', 'spot', 'BTCUSDT', 'BTC', 'USDT', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:01.000Z', 50_000]));
  });

  it('seeds pending forward returns from event entries with configured horizons', async () => {
    const queries: CapturedQuery[] = [];
    const repository = new MarketDataRepository({
      connect: async () => new FakeClient().asPoolClient(),
      async query<T extends QueryResultRow = QueryResultRow>(sql: string, values: unknown[] = []): Promise<QueryResult<T>> {
        queries.push({ sql, values });
        return { rows: [{ count: 10 }] as unknown as T[] } as QueryResult<T>;
      }
    });

    const count = await repository.seedPendingForwardReturns([5, 15], 500);

    expect(count).toBe(10);
    expect(queries[0]?.sql).toContain('insert into forward_returns');
    expect(queries[0]?.sql).toContain('on conflict (entry_id, event_received_at, horizon_minutes) where entry_id is not null do update');
    expect(queries[0]?.sql).toContain("'score:' || score_snapshot_id::text");
    expect(queries[0]?.sql).toContain('on conflict (event_id, event_received_at, coin, horizon_minutes) where entry_id is null do update');
    expect(queries[0]?.values).toEqual([[5, 15], 500]);
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
    return { rows: [] as T[] } as QueryResult<T>;
  }

  release(): void {}
}
