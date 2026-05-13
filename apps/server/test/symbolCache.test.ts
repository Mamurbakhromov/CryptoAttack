import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ExchangeSymbolProvider } from '../src/exchanges/providers.js';
import { ExchangeSymbolCache } from '../src/exchanges/symbolCache.js';
import type { ExchangeSymbol } from '../src/exchanges/types.js';
import type { AppLogger } from '../src/utils/logger.js';

const tempDirs: string[] = [];

describe('ExchangeSymbolCache', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
    vi.restoreAllMocks();
  });

  it('refreshes symbols, filters results, persists cache, and loads from disk', async () => {
    const cachePath = await makeCachePath();
    const provider = makeProvider([
      symbol('BTCUSDT', 'BTC', 'USDT', 'active'),
      symbol('ETHUSDT', 'ETH', 'USDT', 'active'),
      symbol('ETHUSDC', 'ETH', 'USDC', 'active'),
      symbol('OLDUSDT', 'OLD', 'USDT', 'inactive')
    ]);
    const cache = createCache(cachePath, [provider]);

    const refresh = await cache.refresh('test');
    expect(refresh).toMatchObject({ refreshed: 1, failed: 0, totalSymbols: 4 });
    expect(cache.getSymbols({ search: 'eth', status: 'active', limit: 10, offset: 0 }).symbols.map((item) => item.symbol)).toEqual(['ETHUSDC', 'ETHUSDT']);
    expect(cache.getSymbols({ search: 'eth', quoteAsset: 'USDT', status: 'active', limit: 10, offset: 0 }).symbols.map((item) => item.symbol)).toEqual(['ETHUSDT']);
    expect(cache.getSymbols({ status: 'active', limit: 10, offset: 0 }).total).toBe(3);

    const loaded = createCache(cachePath, [provider]);
    await loaded.loadFromDisk();
    expect(loaded.getSymbols({ status: 'all', limit: 10, offset: 0 }).total).toBe(4);
  });

  it('preserves previous symbols when a provider refresh fails', async () => {
    const cachePath = await makeCachePath();
    let shouldFail = false;
    const provider = makeProvider([], async () => {
      if (shouldFail) throw new Error('provider unavailable');
      return [symbol('BTCUSDT', 'BTC', 'USDT', 'active')];
    });
    const cache = createCache(cachePath, [provider]);

    await cache.refresh('ok');
    shouldFail = true;
    const refresh = await cache.refresh('fail');

    const response = cache.getSymbols({ status: 'active', limit: 10, offset: 0 });
    expect(refresh).toMatchObject({ refreshed: 0, failed: 1, totalSymbols: 1 });
    expect(response.symbols.map((item) => item.symbol)).toEqual(['BTCUSDT']);
    expect(response.sources[0]).toMatchObject({ status: 'error', errorMessage: 'provider unavailable', symbolCount: 1 });
  });
});

async function makeCachePath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'cryptoattack-symbol-cache-'));
  tempDirs.push(dir);
  return join(dir, 'exchange-symbols.json');
}

function createCache(cachePath: string, providers: ExchangeSymbolProvider[]): ExchangeSymbolCache {
  return new ExchangeSymbolCache({
    enabled: true,
    cachePath,
    refreshUtcTime: '00:05',
    refreshTimeoutMs: 1_000,
    refreshOnStart: false,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as AppLogger,
    providers
  });
}

function makeProvider(symbols: ExchangeSymbol[], fetchSymbols?: ExchangeSymbolProvider['fetchSymbols']): ExchangeSymbolProvider {
  return {
    source: 'binance_spot',
    exchange: 'binance',
    exchangeLabel: 'Binance',
    market: 'spot',
    marketLabel: 'Spot',
    fetchSymbols: fetchSymbols ?? (async () => symbols)
  };
}

function symbol(symbolValue: string, baseAsset: string, quoteAsset: string, status: ExchangeSymbol['status']): ExchangeSymbol {
  return {
    source: 'binance_spot',
    exchange: 'binance',
    exchangeLabel: 'Binance',
    market: 'spot',
    marketLabel: 'Spot',
    symbol: symbolValue,
    baseAsset,
    quoteAsset,
    status,
    rawStatus: status === 'active' ? 'TRADING' : 'BREAK'
  };
}
