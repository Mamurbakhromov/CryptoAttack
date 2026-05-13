import { describe, expect, it, vi } from 'vitest';

import { createDefaultSpotPerformanceProviders, SpotPerformanceService, type SpotPerformanceProvider } from '../src/exchanges/spotPerformance.js';
import type { SpotPerformanceTicker } from '../src/exchanges/types.js';
import type { AppLogger } from '../src/utils/logger.js';

describe('SpotPerformanceService', () => {
  it('returns overall and exchange-specific daily gainers and losers', async () => {
    const service = createService([
      provider('binance', 'Binance', [ticker('binance', 'Binance', 'AAAUSDT', 'AAA', 'USDT', 12), ticker('binance', 'Binance', 'BBBUSDT', 'BBB', 'USDT', -8)]),
      provider('bybit', 'Bybit', [ticker('bybit', 'Bybit', 'CCCUSDT', 'CCC', 'USDT', 18), ticker('bybit', 'Bybit', 'DDDUSDT', 'DDD', 'USDT', -3)])
    ]);

    const overall = await service.getPerformance({ limit: 10 });
    expect(overall.gainers.map((item) => item.symbol)).toEqual(['CCCUSDT', 'AAAUSDT']);
    expect(overall.losers.map((item) => item.symbol)).toEqual(['BBBUSDT', 'DDDUSDT']);

    const binance = await service.getPerformance({ exchange: 'binance', limit: 10 });
    expect(binance.sources.map((source) => source.exchange)).toEqual(['binance']);
    expect(binance.gainers.map((item) => item.symbol)).toEqual(['AAAUSDT']);
    expect(binance.losers.map((item) => item.symbol)).toEqual(['BBBUSDT']);
  });

  it('excludes non-USDT quote pairs from performance rankings', async () => {
    const service = createService([
      provider('binance', 'Binance', [ticker('binance', 'Binance', 'AAAUSDT', 'AAA', 'USDT', 12), ticker('binance', 'Binance', 'AAAFDUSD', 'AAA', 'FDUSD', 90)])
    ]);

    const response = await service.getPerformance({ limit: 10 });
    expect(response.gainers.map((item) => item.symbol)).toEqual(['AAAUSDT']);
  });

  it('returns UTC 0 live gainers and losers separately from rolling 24h rows', async () => {
    const service = createService([
      provider(
        'binance',
        'Binance',
        [ticker('binance', 'Binance', 'AAAUSDT', 'AAA', 'USDT', 12), ticker('binance', 'Binance', 'BBBUSDT', 'BBB', 'USDT', -8)],
        undefined,
        async () => [
          ticker('binance', 'Binance', 'AAAUSDT', 'AAA', 'USDT', -5, -5),
          ticker('binance', 'Binance', 'BBBUSDT', 'BBB', 'USDT', 6, 6)
        ]
      )
    ]);

    const response = await service.getPerformance({ exchange: 'binance', limit: 10 });

    expect(response.gainers.map((item) => item.symbol)).toEqual(['AAAUSDT']);
    expect(response.losers.map((item) => item.symbol)).toEqual(['BBBUSDT']);
    expect(response.liveGainers.map((item) => item.symbol)).toEqual(['BBBUSDT']);
    expect(response.liveLosers.map((item) => item.symbol)).toEqual(['AAAUSDT']);
  });

  it('enables UTC 0 performance providers where supported', () => {
    const providers = createDefaultSpotPerformanceProviders();

    expect(providers.find((item) => item.exchange === 'binance')?.fetchUtcDayTickers).toEqual(expect.any(Function));
    expect(providers.find((item) => item.exchange === 'bybit')?.fetchUtcDayTickers).toEqual(expect.any(Function));
    expect(providers.find((item) => item.exchange === 'okx')?.fetchUtcDayTickers).toEqual(expect.any(Function));
  });

  it('keeps stale provider rows when a cached refresh fails', async () => {
    let shouldFail = false;
    const providerInput = provider('binance', 'Binance', [], async () => {
      if (shouldFail) throw new Error('ticker API unavailable');
      return [ticker('binance', 'Binance', 'AAAUSDT', 'AAA', 'USDT', 12)];
    });
    const service = createService([providerInput], 0);

    await service.getPerformance({ limit: 10 });
    shouldFail = true;
    const response = await service.getPerformance({ limit: 10 });

    expect(response.sources[0]).toMatchObject({ status: 'error', errorMessage: 'ticker API unavailable', itemCount: 1 });
    expect(response.gainers.map((item) => item.symbol)).toEqual(['AAAUSDT']);
  });
});

function createService(providers: SpotPerformanceProvider[], cacheTtlMs = 60_000): SpotPerformanceService {
  return new SpotPerformanceService({
    timeoutMs: 100,
    cacheTtlMs,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as AppLogger,
    providers
  });
}

function provider(exchange: SpotPerformanceProvider['exchange'], exchangeLabel: string, tickers: SpotPerformanceTicker[], fetchTickers?: SpotPerformanceProvider['fetchTickers'], fetchUtcDayTickers?: SpotPerformanceProvider['fetchUtcDayTickers']): SpotPerformanceProvider {
  const result: SpotPerformanceProvider = {
    exchange,
    exchangeLabel,
    fetchTickers: fetchTickers ?? (async () => tickers)
  };
  if (fetchUtcDayTickers) result.fetchUtcDayTickers = fetchUtcDayTickers;
  return result;
}

function ticker(exchange: SpotPerformanceTicker['exchange'], exchangeLabel: string, symbol: string, baseAsset: string, quoteAsset: string, change: number, utcDayChange: number | null = null): SpotPerformanceTicker {
  return {
    exchange,
    exchangeLabel,
    market: 'spot',
    symbol,
    baseAsset,
    quoteAsset,
    lastPrice: 1,
    priceChangePercent24h: change,
    priceChangePercentUtcDay: utcDayChange,
    volume24hBase: 100,
    volume24hQuote: 1000
  };
}
