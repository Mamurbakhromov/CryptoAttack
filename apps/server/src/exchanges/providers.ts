import type { ExchangeKey, ExchangeMarket, ExchangeSymbol, ExchangeSymbolSourceKey } from './types.js';

interface ProviderInput {
  timeoutMs: number;
}

export interface ExchangeSymbolProvider {
  source: ExchangeSymbolSourceKey;
  exchange: ExchangeKey;
  exchangeLabel: string;
  market: ExchangeMarket;
  marketLabel: string;
  fetchSymbols: (input: ProviderInput) => Promise<ExchangeSymbol[]>;
}

export function createDefaultExchangeSymbolProviders(): ExchangeSymbolProvider[] {
  return [
    provider('binance_spot', 'binance', 'Binance', 'spot', 'Spot', fetchBinanceSpotSymbols),
    provider('binance_perpetual', 'binance', 'Binance', 'perpetual', 'USD-M Perps', fetchBinancePerpetualSymbols),
    provider('bybit_spot', 'bybit', 'Bybit', 'spot', 'Spot', fetchBybitSpotSymbols),
    provider('bybit_perpetual', 'bybit', 'Bybit', 'perpetual', 'Linear Perps', fetchBybitPerpetualSymbols),
    provider('okx_spot', 'okx', 'OKX', 'spot', 'Spot', fetchOkxSpotSymbols),
    provider('okx_perpetual', 'okx', 'OKX', 'perpetual', 'Swaps', fetchOkxPerpetualSymbols),
    provider('coinbase_spot', 'coinbase', 'Coinbase', 'spot', 'Spot', fetchCoinbaseSpotSymbols)
  ];
}

function provider(
  source: ExchangeSymbolSourceKey,
  exchange: ExchangeKey,
  exchangeLabel: string,
  market: ExchangeMarket,
  marketLabel: string,
  fetcher: (input: ProviderInput, providerInfo: Omit<ExchangeSymbolProvider, 'fetchSymbols'>) => Promise<ExchangeSymbol[]>
): ExchangeSymbolProvider {
  const providerInfo = { source, exchange, exchangeLabel, market, marketLabel };
  return {
    ...providerInfo,
    fetchSymbols: (input) => fetcher(input, providerInfo)
  };
}

async function fetchBinanceSpotSymbols(input: ProviderInput, info: Omit<ExchangeSymbolProvider, 'fetchSymbols'>): Promise<ExchangeSymbol[]> {
  const data = await fetchJson('https://api.binance.com/api/v3/exchangeInfo', input.timeoutMs);
  const symbols = getArray(getRecord(data), 'symbols');
  return symbols.flatMap((item) => {
    const record = getRecord(item);
    const symbol = asString(record.symbol);
    const baseAsset = asString(record.baseAsset);
    const quoteAsset = asString(record.quoteAsset);
    if (!symbol || !baseAsset || !quoteAsset) return [];
    const rawStatus = asString(record.status);
    return [createSymbol(info, symbol, baseAsset, quoteAsset, rawStatus, rawStatus === 'TRADING' ? 'active' : 'inactive')];
  });
}

async function fetchBinancePerpetualSymbols(input: ProviderInput, info: Omit<ExchangeSymbolProvider, 'fetchSymbols'>): Promise<ExchangeSymbol[]> {
  const data = await fetchJson('https://fapi.binance.com/fapi/v1/exchangeInfo', input.timeoutMs);
  const symbols = getArray(getRecord(data), 'symbols');
  return symbols.flatMap((item) => {
    const record = getRecord(item);
    if (asString(record.contractType) !== 'PERPETUAL') return [];
    const symbol = asString(record.symbol);
    const baseAsset = asString(record.baseAsset);
    const quoteAsset = asString(record.quoteAsset);
    if (!symbol || !baseAsset || !quoteAsset) return [];
    const rawStatus = asString(record.status);
    return [createSymbol(info, symbol, baseAsset, quoteAsset, rawStatus, rawStatus === 'TRADING' ? 'active' : 'inactive')];
  });
}

async function fetchBybitSpotSymbols(input: ProviderInput, info: Omit<ExchangeSymbolProvider, 'fetchSymbols'>): Promise<ExchangeSymbol[]> {
  const data = await fetchJson('https://api.bybit.com/v5/market/instruments-info?category=spot', input.timeoutMs);
  return parseBybitList(data, info);
}

async function fetchBybitPerpetualSymbols(input: ProviderInput, info: Omit<ExchangeSymbolProvider, 'fetchSymbols'>): Promise<ExchangeSymbol[]> {
  const symbols: ExchangeSymbol[] = [];
  let cursor: string | null = null;

  do {
    const url = new URL('https://api.bybit.com/v5/market/instruments-info');
    url.searchParams.set('category', 'linear');
    url.searchParams.set('limit', '1000');
    if (cursor) url.searchParams.set('cursor', cursor);
    const data = await fetchJson(url.toString(), input.timeoutMs);
    symbols.push(...parseBybitList(data, info, true));

    const result = getRecord(getRecord(data).result);
    const nextCursor = asString(result.nextPageCursor);
    cursor = nextCursor || null;
  } while (cursor);

  return symbols;
}

async function fetchOkxSpotSymbols(input: ProviderInput, info: Omit<ExchangeSymbolProvider, 'fetchSymbols'>): Promise<ExchangeSymbol[]> {
  try {
    const data = await fetchJson('https://www.okx.com/api/v5/public/instruments?instType=SPOT', input.timeoutMs);
    const rows = getArray(getRecord(data), 'data');
    return rows.flatMap((item) => {
      const record = getRecord(item);
      const symbol = asString(record.instId);
      const baseAsset = asString(record.baseCcy);
      const quoteAsset = asString(record.quoteCcy);
      if (!symbol || !baseAsset || !quoteAsset) return [];
      const rawStatus = asString(record.state);
      return [createSymbol(info, symbol, baseAsset, quoteAsset, rawStatus, rawStatus === 'live' ? 'active' : 'inactive')];
    });
  } catch {
    return fetchCoinGeckoOkxSpotSymbols(input, info);
  }
}

async function fetchOkxPerpetualSymbols(input: ProviderInput, info: Omit<ExchangeSymbolProvider, 'fetchSymbols'>): Promise<ExchangeSymbol[]> {
  try {
    const data = await fetchJson('https://www.okx.com/api/v5/public/instruments?instType=SWAP', input.timeoutMs);
    const rows = getArray(getRecord(data), 'data');
    return rows.flatMap((item) => {
      const record = getRecord(item);
      const symbol = asString(record.instId);
      const family = asString(record.instFamily) ?? asString(record.uly) ?? symbol?.replace(/-SWAP$/i, '');
      const [baseAsset, quoteAsset] = family?.split('-') ?? [];
      if (!symbol || !baseAsset || !quoteAsset) return [];
      const rawStatus = asString(record.state);
      return [createSymbol(info, symbol, baseAsset, quoteAsset, rawStatus, rawStatus === 'live' ? 'active' : 'inactive')];
    });
  } catch {
    return fetchCoinGeckoOkxPerpetualSymbols(input, info);
  }
}

async function fetchCoinbaseSpotSymbols(input: ProviderInput, info: Omit<ExchangeSymbolProvider, 'fetchSymbols'>): Promise<ExchangeSymbol[]> {
  const data = await fetchJson('https://api.exchange.coinbase.com/products', input.timeoutMs);
  const rows = Array.isArray(data) ? data : [];
  return rows.flatMap((item) => {
    const record = getRecord(item);
    const symbol = asString(record.id);
    const baseAsset = asString(record.base_currency);
    const quoteAsset = asString(record.quote_currency);
    if (!symbol || !baseAsset || !quoteAsset) return [];
    const rawStatus = asString(record.status);
    const active = rawStatus === 'online' && !Boolean(record.trading_disabled) && !Boolean(record.cancel_only) && !Boolean(record.post_only) && !Boolean(record.limit_only);
    return [createSymbol(info, symbol, baseAsset, quoteAsset, rawStatus, active ? 'active' : 'inactive')];
  });
}

function parseBybitList(data: unknown, info: Omit<ExchangeSymbolProvider, 'fetchSymbols'>, perpetualOnly = false): ExchangeSymbol[] {
  const result = getRecord(getRecord(data).result);
  const rows = getArray(result, 'list');
  return rows.flatMap((item) => {
    const record = getRecord(item);
    if (perpetualOnly && asString(record.contractType) !== 'LinearPerpetual') return [];
    const symbol = asString(record.symbol);
    const baseAsset = asString(record.baseCoin);
    const quoteAsset = asString(record.quoteCoin);
    if (!symbol || !baseAsset || !quoteAsset) return [];
    const rawStatus = asString(record.status);
    return [createSymbol(info, symbol, baseAsset, quoteAsset, rawStatus, rawStatus === 'Trading' ? 'active' : 'inactive')];
  });
}

async function fetchCoinGeckoOkxSpotSymbols(input: ProviderInput, info: Omit<ExchangeSymbolProvider, 'fetchSymbols'>): Promise<ExchangeSymbol[]> {
  const symbols = new Map<string, ExchangeSymbol>();

  for (let page = 1; page <= 10; page += 1) {
    let data: unknown;
    try {
      data = await fetchJson(`https://api.coingecko.com/api/v3/exchanges/okex/tickers?depth=false&page=${page}`, input.timeoutMs);
    } catch (error) {
      if (symbols.size > 0) break;
      throw error;
    }
    const tickers = getArray(getRecord(data), 'tickers');
    if (!tickers.length) break;

    for (const item of tickers) {
      const record = getRecord(item);
      const baseAsset = asString(record.base);
      const quoteAsset = asString(record.target);
      if (!baseAsset || !quoteAsset) continue;
      const symbol = `${baseAsset}-${quoteAsset}`;
      symbols.set(symbol.toUpperCase(), createSymbol(info, symbol, baseAsset, quoteAsset, 'coingecko', 'active'));
    }

    await sleep(1_250);
  }

  return [...symbols.values()];
}

async function fetchCoinGeckoOkxPerpetualSymbols(input: ProviderInput, info: Omit<ExchangeSymbolProvider, 'fetchSymbols'>): Promise<ExchangeSymbol[]> {
  const data = await fetchJson('https://api.coingecko.com/api/v3/derivatives/exchanges/okex_swap?include_tickers=all', input.timeoutMs);
  const tickers = getArray(getRecord(data), 'tickers');
  const symbols = new Map<string, ExchangeSymbol>();

  for (const item of tickers) {
    const record = getRecord(item);
    const contractType = asString(record.contract_type);
    if (contractType !== 'perpetual') continue;
    const symbol = asString(record.symbol);
    const baseAsset = asString(record.base);
    const quoteAsset = asString(record.target);
    if (!symbol || !baseAsset || !quoteAsset) continue;
    symbols.set(symbol.toUpperCase(), createSymbol(info, symbol, baseAsset, quoteAsset, 'coingecko', 'active'));
  }

  return [...symbols.values()];
}

function createSymbol(
  info: Omit<ExchangeSymbolProvider, 'fetchSymbols'>,
  symbol: string,
  baseAsset: string,
  quoteAsset: string,
  rawStatus: string | null,
  status: ExchangeSymbol['status']
): ExchangeSymbol {
  return {
    source: info.source,
    exchange: info.exchange,
    exchangeLabel: info.exchangeLabel,
    market: info.market,
    marketLabel: info.marketLabel,
    symbol: symbol.toUpperCase(),
    baseAsset: baseAsset.toUpperCase(),
    quoteAsset: quoteAsset.toUpperCase(),
    status,
    rawStatus
  };
}

async function fetchJson(url: string, timeoutMs: number): Promise<unknown> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await fetchJsonOnce(url, timeoutMs);
    } catch (error) {
      if (!isRetryableFetchError(error) || attempt === 2) throw error;
      await sleep(2_000 * (attempt + 1));
    }
  }
  return fetchJsonOnce(url, timeoutMs);
}

async function fetchJsonOnce(url: string, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'CryptoAttackDashboard/0.1'
      }
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function isRetryableFetchError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.message.startsWith('429 ') || error.message.startsWith('500 ') || error.message.startsWith('502 ') || error.message.startsWith('503 ') || error.message.startsWith('504 ');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function getArray(record: Record<string, unknown>, key: string): unknown[] {
  const value = record[key];
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
