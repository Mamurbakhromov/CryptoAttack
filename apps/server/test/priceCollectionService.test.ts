import { describe, expect, it, vi } from 'vitest';

import type { MarketDataRepository, PriceTickInput } from '../src/db/marketDataRepository.js';
import type { ExchangeSymbol } from '../src/exchanges/types.js';
import { PriceCollectionService } from '../src/market/priceCollectionService.js';
import type { NormalizedEvent } from '../src/events/types.js';

describe('PriceCollectionService', () => {
  it('collects prices only for active event coins and records status metrics', async () => {
    const writtenTicks: PriceTickInput[] = [];
    const repository = {
      getRecentlyActiveCoins: async () => [],
      getTopScoredCoins: async () => [],
      upsertPriceTicks: async (ticks: PriceTickInput[]) => {
        writtenTicks.push(...ticks);
        return { written: ticks.length };
      }
    } as unknown as MarketDataRepository;
    const symbolCache = {
      getSymbols: () => ({ symbols: [symbol('BTCUSDT', 'BTC'), symbol('ETHUSDT', 'ETH')] })
    } as never;
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      lastPrice: '50000',
      closeTime: 1767225600000,
      volume: '1',
      quoteVolume: '50000',
      priceChangePercent: '1'
    }), { status: 200 }));
    const service = new PriceCollectionService(repository, symbolCache, {
      enabled: true,
      intervalMs: 60_000,
      activeCoinTtlMs: 60_000,
      timeoutMs: 1_000,
      fetchImpl,
      logger: { warn: vi.fn() } as never
    });

    service.markActiveCoins([makeEvent('BTC')]);
    const result = await service.collectNow('test');

    expect(result).toMatchObject({ processed: 1, written: 1, skipped: 0, failed: 0 });
    expect(writtenTicks[0]).toMatchObject({ exchange: 'binance', market: 'spot', symbol: 'BTCUSDT', baseAsset: 'BTC', price: 50000 });
    expect(service.getStatus()).toMatchObject({ enabled: true, state: 'running', activeCoinCount: 1, processed: 1, written: 1 });
  });
});

function symbol(symbolValue: string, baseAsset: string): ExchangeSymbol {
  return {
    source: 'binance_spot',
    exchange: 'binance',
    exchangeLabel: 'Binance',
    market: 'spot',
    marketLabel: 'Spot',
    symbol: symbolValue,
    baseAsset,
    quoteAsset: 'USDT',
    status: 'active',
    rawStatus: 'TRADING'
  };
}

function makeEvent(coin: string): NormalizedEvent {
  return {
    id: 'event-1',
    feedKey: 'listings',
    chapter: 'cex_alerts',
    category: 'listings',
    title: 'Listing',
    plainText: 'Listing',
    htmlText: 'Listing',
    coins: [coin],
    filters: [],
    timestamp: '2026-01-01T00:00:00.000Z',
    sourceTime: null,
    receivedAt: '2026-01-01T00:00:00.000Z',
    latencyMs: null,
    severity: 'info',
    raw: {},
    endpoint: 'fast',
    entries: [],
    amountMetric: null,
    parserStatus: 'not_applicable'
  };
}
