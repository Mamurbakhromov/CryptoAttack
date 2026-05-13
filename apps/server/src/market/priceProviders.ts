import type { PriceTickInput } from '../db/marketDataRepository.js';
import type { ExchangeKey, ExchangeMarket, ExchangeSymbol } from '../exchanges/types.js';

export interface PriceFetchTarget {
  exchange: ExchangeKey;
  market: ExchangeMarket;
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
}

export interface PriceProviderOptions {
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

export async function fetchPriceTick(target: PriceFetchTarget, options: PriceProviderOptions): Promise<PriceTickInput | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  if (target.exchange === 'binance') return fetchBinancePriceTick(target, options.timeoutMs, fetchImpl);
  if (target.exchange === 'bybit') return fetchBybitPriceTick(target, options.timeoutMs, fetchImpl);
  if (target.exchange === 'okx') return fetchOkxPriceTick(target, options.timeoutMs, fetchImpl);
  if (target.exchange === 'coinbase' && target.market === 'spot') return fetchCoinbasePriceTick(target, options.timeoutMs, fetchImpl);
  return null;
}

export function buildPriceTargets(symbols: ExchangeSymbol[], activeCoins: string[], maxTargets: number): PriceFetchTarget[] {
  const activeSet = new Set(activeCoins.map((coin) => coin.toUpperCase()));
  const quotePriority = new Map([['USDT', 0], ['USDC', 1], ['USD', 2]]);
  const candidates = symbols
    .filter((symbol) => symbol.status === 'active' && activeSet.has(symbol.baseAsset) && quotePriority.has(symbol.quoteAsset))
    .sort((a, b) => {
      const coinPriority = activeCoins.indexOf(a.baseAsset) - activeCoins.indexOf(b.baseAsset);
      if (coinPriority !== 0) return coinPriority;
      const quoteDiff = (quotePriority.get(a.quoteAsset) ?? 99) - (quotePriority.get(b.quoteAsset) ?? 99);
      if (quoteDiff !== 0) return quoteDiff;
      const marketDiff = marketPriority(a.market) - marketPriority(b.market);
      if (marketDiff !== 0) return marketDiff;
      return exchangePriority(a.exchange) - exchangePriority(b.exchange);
    });

  const deduped = new Map<string, PriceFetchTarget>();
  for (const symbol of candidates) {
    const key = `${symbol.exchange}:${symbol.market}:${symbol.baseAsset}`;
    if (deduped.has(key)) continue;
    deduped.set(key, {
      exchange: symbol.exchange,
      market: symbol.market,
      symbol: symbol.symbol,
      baseAsset: symbol.baseAsset,
      quoteAsset: symbol.quoteAsset
    });
    if (deduped.size >= maxTargets) break;
  }
  return [...deduped.values()];
}

async function fetchBinancePriceTick(target: PriceFetchTarget, timeoutMs: number, fetchImpl: typeof fetch): Promise<PriceTickInput | null> {
  const baseUrl = target.market === 'spot' ? 'https://api.binance.com/api/v3/ticker/24hr' : 'https://fapi.binance.com/fapi/v1/ticker/24hr';
  const data = getRecord(await fetchJson(`${baseUrl}?symbol=${encodeURIComponent(target.symbol)}`, timeoutMs, fetchImpl));
  const price = parseNumber(data.lastPrice);
  if (price === null) return null;
  const closeTime = parseNumber(data.closeTime) ?? Date.now();
  return tick(target, {
    source: 'public_rest',
    sourceTs: new Date(closeTime).toISOString(),
    price,
    volume24hBase: parseNumber(data.volume),
    volume24hQuote: parseNumber(data.quoteVolume),
    priceChangePercent24h: parseNumber(data.priceChangePercent),
    payload: data
  });
}

async function fetchBybitPriceTick(target: PriceFetchTarget, timeoutMs: number, fetchImpl: typeof fetch): Promise<PriceTickInput | null> {
  const category = target.market === 'spot' ? 'spot' : 'linear';
  const data = getRecord(await fetchJson(`https://api.bybit.com/v5/market/tickers?category=${category}&symbol=${encodeURIComponent(target.symbol)}`, timeoutMs, fetchImpl));
  const row = getRecord(getArray(getRecord(data.result), 'list')[0]);
  const price = parseNumber(row.lastPrice);
  if (price === null) return null;
  const sourceTime = parseNumber(data.time) ?? Date.now();
  const price24hPcnt = parseNumber(row.price24hPcnt);
  return tick(target, {
    source: 'public_rest',
    sourceTs: new Date(sourceTime).toISOString(),
    price,
    volume24hBase: parseNumber(row.volume24h),
    volume24hQuote: parseNumber(row.turnover24h),
    priceChangePercent24h: price24hPcnt === null ? null : price24hPcnt * 100,
    openInterest: parseNumber(row.openInterest),
    openInterestValueUsd: parseNumber(row.openInterestValue),
    payload: data
  });
}

async function fetchOkxPriceTick(target: PriceFetchTarget, timeoutMs: number, fetchImpl: typeof fetch): Promise<PriceTickInput | null> {
  const data = getRecord(await fetchJson(`https://www.okx.com/api/v5/market/ticker?instId=${encodeURIComponent(target.symbol)}`, timeoutMs, fetchImpl));
  const row = getRecord(getArray(data, 'data')[0]);
  const price = parseNumber(row.last);
  if (price === null) return null;
  const sourceTime = parseNumber(row.ts) ?? Date.now();
  const open24h = parseNumber(row.open24h);
  return tick(target, {
    source: 'public_rest',
    sourceTs: new Date(sourceTime).toISOString(),
    price,
    volume24hBase: parseNumber(row.vol24h),
    volume24hQuote: parseNumber(row.volCcy24h),
    priceChangePercent24h: open24h && open24h !== 0 ? ((price - open24h) / open24h) * 100 : null,
    payload: data
  });
}

async function fetchCoinbasePriceTick(target: PriceFetchTarget, timeoutMs: number, fetchImpl: typeof fetch): Promise<PriceTickInput | null> {
  const data = getRecord(await fetchJson(`https://api.exchange.coinbase.com/products/${encodeURIComponent(target.symbol)}/ticker`, timeoutMs, fetchImpl));
  const price = parseNumber(data.price);
  if (price === null) return null;
  const sourceTime = typeof data.time === 'string' ? Date.parse(data.time) : Number.NaN;
  return tick(target, {
    source: 'public_rest',
    sourceTs: new Date(Number.isFinite(sourceTime) ? sourceTime : Date.now()).toISOString(),
    price,
    volume24hBase: parseNumber(data.volume),
    volume24hQuote: null,
    priceChangePercent24h: null,
    payload: data
  });
}

function tick(target: PriceFetchTarget, input: Omit<PriceTickInput, 'exchange' | 'market' | 'symbol' | 'baseAsset' | 'quoteAsset' | 'collectedAt'>): PriceTickInput {
  return {
    ...input,
    exchange: target.exchange,
    market: target.market,
    symbol: target.symbol,
    baseAsset: target.baseAsset,
    quoteAsset: target.quoteAsset,
    collectedAt: new Date().toISOString()
  };
}

async function fetchJson(url: string, timeoutMs: number, fetchImpl: typeof fetch): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'CryptoAttackDashboard/0.1'
      }
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function marketPriority(market: ExchangeMarket): number {
  return market === 'spot' ? 0 : 1;
}

function exchangePriority(exchange: ExchangeKey): number {
  return ['binance', 'bybit', 'okx', 'coinbase'].indexOf(exchange);
}

function parseNumber(value: unknown): number | null {
  const numberValue = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(numberValue) ? numberValue : null;
}

function getRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function getArray(record: Record<string, unknown>, key: string): unknown[] {
  const value = record[key];
  return Array.isArray(value) ? value : [];
}
