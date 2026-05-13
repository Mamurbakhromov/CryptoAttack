import { describe, expect, it, vi } from 'vitest';

import { buildPriceTargets, fetchPriceTick } from '../src/market/priceProviders.js';
import type { ExchangeSymbol } from '../src/exchanges/types.js';

describe('price providers', () => {
  it('builds deduped targets for recently active coins with quote and market priority', () => {
    const targets = buildPriceTargets([
      symbol('binance', 'perpetual', 'BTCUSDT', 'BTC', 'USDT'),
      symbol('binance', 'spot', 'BTCUSDC', 'BTC', 'USDC'),
      symbol('binance', 'spot', 'BTCUSDT', 'BTC', 'USDT'),
      symbol('coinbase', 'spot', 'BTC-USD', 'BTC', 'USD'),
      symbol('bybit', 'spot', 'ETHUSDT', 'ETH', 'USDT')
    ], ['BTC', 'ETH'], 10);

    expect(targets.map((target) => `${target.exchange}:${target.market}:${target.symbol}`)).toEqual([
      'binance:spot:BTCUSDT',
      'binance:perpetual:BTCUSDT',
      'coinbase:spot:BTC-USD',
      'bybit:spot:ETHUSDT'
    ]);
  });

  it('parses Binance futures ticker snapshots into price ticks', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      lastPrice: '50000.5',
      closeTime: 1767225600000,
      volume: '123.45',
      quoteVolume: '6000000',
      priceChangePercent: '1.25'
    }), { status: 200 }));

    const tick = await fetchPriceTick({ exchange: 'binance', market: 'perpetual', symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT' }, { timeoutMs: 1_000, fetchImpl });

    expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining('fapi.binance.com'), expect.any(Object));
    expect(tick).toMatchObject({
      source: 'public_rest',
      exchange: 'binance',
      market: 'perpetual',
      symbol: 'BTCUSDT',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      sourceTs: '2026-01-01T00:00:00.000Z',
      price: 50000.5,
      volume24hBase: 123.45,
      volume24hQuote: 6000000,
      priceChangePercent24h: 1.25
    });
  });
});

function symbol(exchange: ExchangeSymbol['exchange'], market: ExchangeSymbol['market'], symbolValue: string, baseAsset: string, quoteAsset: string): ExchangeSymbol {
  return {
    source: `${exchange}_${market === 'spot' ? 'spot' : 'perpetual'}` as ExchangeSymbol['source'],
    exchange,
    exchangeLabel: exchange,
    market,
    marketLabel: market,
    symbol: symbolValue,
    baseAsset,
    quoteAsset,
    status: 'active',
    rawStatus: 'active'
  };
}
