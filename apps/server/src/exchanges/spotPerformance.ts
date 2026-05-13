import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';

import WebSocket from 'ws';

import { exchangeKeys, type ExchangeKey, type SpotPerformanceQuery, type SpotPerformanceResponse, type SpotPerformanceSourceSummary, type SpotPerformanceTicker } from './types.js';
import type { AppLogger } from '../utils/logger.js';

interface ProviderInput {
  timeoutMs: number;
}

export interface SpotPerformanceProvider {
  exchange: ExchangeKey;
  exchangeLabel: string;
  fetchTickers: (input: ProviderInput) => Promise<SpotPerformanceTicker[]>;
  fetchUtcDayTickers?: (input: ProviderInput) => Promise<SpotPerformanceTicker[]>;
}

interface CachedProviderResult {
  expiresAt: number;
  source: SpotPerformanceSourceSummary;
  tickers: SpotPerformanceTicker[];
}

interface TickerInput {
  exchange: ExchangeKey;
  exchangeLabel: string;
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  lastPrice: number | null;
  priceChangePercent24h: number | null;
  priceChangePercentUtcDay?: number | null;
  volume24hBase: number | null;
  volume24hQuote: number | null;
}

interface SpotPerformanceServiceOptions {
  timeoutMs: number;
  cacheTtlMs?: number;
  liveUpdateIntervalMs?: number;
  logger: AppLogger;
  providers?: SpotPerformanceProvider[];
}

const DEFAULT_CACHE_TTL_MS = 60_000;
const DEFAULT_UTC_DAY_CACHE_TTL_MS = 30_000;
const DEFAULT_LIVE_UPDATE_INTERVAL_MS = 2_000;
const DEFAULT_LIMIT = 10;
const LIVE_UPDATE_LIMIT = 100;
const PERFORMANCE_QUOTE_ASSET = 'USDT';
const BYBIT_UTC_KLINE_CONCURRENCY = 20;
const BYBIT_UTC_KLINE_TIMEOUT_MS = 2_500;
const KNOWN_QUOTES = [
  'USDT',
  'USDC',
  'FDUSD',
  'TUSD',
  'BUSD',
  'USD1',
  'USD',
  'EUR',
  'GBP',
  'TRY',
  'BRL',
  'AUD',
  'AED',
  'SGD',
  'PLN',
  'MNT',
  'BTC',
  'ETH',
  'BNB'
];
const bybitUtcOpenCache = new Map<string, { dayStartMs: number; openPrice: number }>();

export class SpotPerformanceService extends EventEmitter {
  private readonly providers: SpotPerformanceProvider[];
  private readonly cache = new Map<ExchangeKey, CachedProviderResult>();
  private readonly utcDayCache = new Map<ExchangeKey, CachedProviderResult>();
  private readonly inFlight = new Map<ExchangeKey, Promise<CachedProviderResult>>();
  private readonly utcDayInFlight = new Map<ExchangeKey, Promise<CachedProviderResult>>();
  private readonly cacheTtlMs: number;
  private readonly liveUpdateIntervalMs: number;
  private readonly sockets = new Map<ExchangeKey, WebSocket>();
  private readonly reconnectTimers = new Map<ExchangeKey, NodeJS.Timeout>();
  private readonly updateTimers = new Map<ExchangeKey, NodeJS.Timeout>();
  private readonly subscriptionTimers = new Set<NodeJS.Timeout>();
  private liveStarted = false;

  constructor(private readonly options: SpotPerformanceServiceOptions) {
    super();
    this.providers = options.providers ?? createDefaultSpotPerformanceProviders();
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.liveUpdateIntervalMs = options.liveUpdateIntervalMs ?? DEFAULT_LIVE_UPDATE_INTERVAL_MS;
  }

  start(): void {
    if (this.liveStarted) return;
    this.liveStarted = true;
    for (const provider of this.providers) {
      void this.primeAndConnect(provider);
    }
  }

  stop(): void {
    this.liveStarted = false;
    for (const timer of this.reconnectTimers.values()) clearTimeout(timer);
    this.reconnectTimers.clear();
    for (const timer of this.updateTimers.values()) clearTimeout(timer);
    this.updateTimers.clear();
    for (const timer of this.subscriptionTimers) clearTimeout(timer);
    this.subscriptionTimers.clear();
    for (const socket of this.sockets.values()) socket.close();
    this.sockets.clear();
  }

  async getPerformance(query: SpotPerformanceQuery): Promise<SpotPerformanceResponse> {
    const limit = Math.max(1, query.limit || DEFAULT_LIMIT);
    const providers = this.providers.filter((provider) => !query.exchange || provider.exchange === query.exchange);
    const [results, utcDayResults] = await Promise.all([
      Promise.all(providers.map((provider) => this.getProviderResult(provider))),
      Promise.all(providers.map((provider) => this.getUtcDayProviderResult(provider)))
    ]);
    const tickers = results.flatMap((result) => result.tickers).filter((ticker) => ticker.quoteAsset === PERFORMANCE_QUOTE_ASSET);
    const utcDayTickers = utcDayResults.flatMap((result) => result?.tickers ?? []).filter((ticker) => ticker.quoteAsset === PERFORMANCE_QUOTE_ASSET);

    return buildPerformanceResponse({ exchange: query.exchange ?? 'all', limit, results, tickers, utcDayTickers });
  }

  getCachedPerformanceResponses(limit = LIVE_UPDATE_LIMIT): SpotPerformanceResponse[] {
    return this.providers.flatMap((provider) => {
      const result = this.cache.get(provider.exchange);
      if (!result) return [];
      const tickers = result.tickers.filter((ticker) => ticker.quoteAsset === PERFORMANCE_QUOTE_ASSET);
      const utcDayTickers = this.utcDayCache.get(provider.exchange)?.tickers.filter((ticker) => ticker.quoteAsset === PERFORMANCE_QUOTE_ASSET) ?? [];
      return [buildPerformanceResponse({ exchange: provider.exchange, limit, results: [result], tickers, utcDayTickers })];
    });
  }

  private getProviderResult(provider: SpotPerformanceProvider): Promise<CachedProviderResult> {
    const cached = this.cache.get(provider.exchange);
    if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached);

    const existing = this.inFlight.get(provider.exchange);
    if (existing) return existing;

    const promise = this.refreshProvider(provider).finally(() => {
      this.inFlight.delete(provider.exchange);
    });
    this.inFlight.set(provider.exchange, promise);
    return promise;
  }

  private async refreshProvider(provider: SpotPerformanceProvider): Promise<CachedProviderResult> {
    const updatedAt = new Date().toISOString();
    try {
      const tickers = await provider.fetchTickers({ timeoutMs: this.options.timeoutMs });
      const result: CachedProviderResult = {
        expiresAt: Date.now() + this.cacheTtlMs,
        source: {
          exchange: provider.exchange,
          exchangeLabel: provider.exchangeLabel,
          status: 'ok',
          updatedAt,
          errorMessage: null,
          itemCount: tickers.length
        },
        tickers
      };
      this.cache.set(provider.exchange, result);
      return result;
    } catch (error) {
      this.options.logger.warn({ error, exchange: provider.exchange }, 'Spot performance provider failed');
      const previous = this.cache.get(provider.exchange);
      const hasPreviousRows = Boolean(previous?.tickers.length);
      const result: CachedProviderResult = {
        expiresAt: Date.now() + (hasPreviousRows ? this.cacheTtlMs : 5_000),
        source: {
          exchange: provider.exchange,
          exchangeLabel: provider.exchangeLabel,
          status: 'error',
          updatedAt: previous?.source.updatedAt ?? null,
          errorMessage: error instanceof Error ? error.message : String(error),
          itemCount: previous?.tickers.length ?? 0
        },
        tickers: previous?.tickers ?? []
      };
      this.cache.set(provider.exchange, result);
      return result;
    }
  }

  private getUtcDayProviderResult(provider: SpotPerformanceProvider): Promise<CachedProviderResult | null> {
    if (!provider.fetchUtcDayTickers) return Promise.resolve(null);
    const cached = this.utcDayCache.get(provider.exchange);
    if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached);

    const existing = this.utcDayInFlight.get(provider.exchange);
    if (existing) return existing;

    const promise = this.refreshUtcDayProvider(provider).finally(() => {
      this.utcDayInFlight.delete(provider.exchange);
    });
    this.utcDayInFlight.set(provider.exchange, promise);
    return promise;
  }

  private async refreshUtcDayProvider(provider: SpotPerformanceProvider): Promise<CachedProviderResult> {
    const updatedAt = new Date().toISOString();
    try {
      const tickers = await provider.fetchUtcDayTickers?.({ timeoutMs: this.options.timeoutMs }) ?? [];
      const result: CachedProviderResult = {
        expiresAt: Date.now() + DEFAULT_UTC_DAY_CACHE_TTL_MS,
        source: {
          exchange: provider.exchange,
          exchangeLabel: provider.exchangeLabel,
          status: 'ok',
          updatedAt,
          errorMessage: null,
          itemCount: tickers.length
        },
        tickers
      };
      this.utcDayCache.set(provider.exchange, result);
      return result;
    } catch (error) {
      this.options.logger.warn({ error, exchange: provider.exchange }, 'UTC day performance provider failed');
      const previous = this.utcDayCache.get(provider.exchange);
      const result: CachedProviderResult = {
        expiresAt: Date.now() + (previous?.tickers.length ? DEFAULT_UTC_DAY_CACHE_TTL_MS : 5_000),
        source: {
          exchange: provider.exchange,
          exchangeLabel: provider.exchangeLabel,
          status: 'error',
          updatedAt: previous?.source.updatedAt ?? null,
          errorMessage: error instanceof Error ? error.message : String(error),
          itemCount: previous?.tickers.length ?? 0
        },
        tickers: previous?.tickers ?? []
      };
      this.utcDayCache.set(provider.exchange, result);
      return result;
    }
  }

  private async primeAndConnect(provider: SpotPerformanceProvider): Promise<void> {
    await Promise.all([this.getProviderResult(provider), this.getUtcDayProviderResult(provider)]);
    this.schedulePerformanceUpdate(provider.exchange);
    if (!this.liveStarted) return;
    this.connectLiveSocket(provider.exchange);
  }

  private connectLiveSocket(exchange: ExchangeKey): void {
    if (exchange === 'binance') {
      this.connectBinanceSocket();
    } else if (exchange === 'bybit') {
      this.connectBybitSocket();
    } else if (exchange === 'okx') {
      this.connectOkxSocket();
    } else if (exchange === 'coinbase') {
      this.connectCoinbaseSocket();
    }
  }

  private connectBinanceSocket(): void {
    this.connectSocket('binance', 'wss://stream.binance.com:9443/ws/!miniTicker@arr', (message) => {
      const rows = parseJsonArray(message);
      const cachedSymbols = this.cachedSymbolMap('binance');
      const tickers = rows.flatMap((item) => {
        const record = getRecord(item);
        const symbol = asString(record.s);
        const cached = symbol ? cachedSymbols.get(symbol) : undefined;
        if (!symbol || !cached) return [];
        const lastPrice = parseNumber(record.c);
        const openPrice = parseNumber(record.o);
        return createTicker({
          exchange: 'binance',
          exchangeLabel: 'Binance',
          symbol,
          baseAsset: cached.baseAsset,
          quoteAsset: cached.quoteAsset,
          lastPrice,
          priceChangePercent24h: lastPrice !== null && openPrice !== null && openPrice !== 0 ? ((lastPrice - openPrice) / openPrice) * 100 : null,
          volume24hBase: parseNumber(record.v),
          volume24hQuote: parseNumber(record.q)
        });
      });
      this.updateLiveTickers('binance', tickers);
    });
  }

  private connectBybitSocket(): void {
    this.connectSocket('bybit', 'wss://stream.bybit.com/v5/public/spot', (message) => {
      const payload = getRecord(parseJson(message));
      const record = getRecord(payload.data);
      const ticker = parseBybitTickerRecord(record);
      if (ticker) this.updateLiveTickers('bybit', [ticker]);
    }, (socket) => {
      const args = this.cachedSymbols('bybit').map((symbol) => `tickers.${symbol}`);
      this.sendChunkedSubscriptions(socket, args, (chunk) => ({ op: 'subscribe', args: chunk }));
    });
  }

  private connectOkxSocket(): void {
    this.connectSocket('okx', 'wss://ws.okx.com:8443/ws/v5/public', (message) => {
      const payload = getRecord(parseJson(message));
      const rows = getArray(payload, 'data');
      const tickers = rows.flatMap((item) => parseOkxTickerRecord(getRecord(item)) ?? []);
      this.updateLiveTickers('okx', tickers);
    }, (socket) => {
      const args = this.cachedSymbols('okx').map((instId) => ({ channel: 'tickers', instId }));
      this.sendChunkedSubscriptions(socket, args, (chunk) => ({ op: 'subscribe', args: chunk }));
    });
  }

  private connectCoinbaseSocket(): void {
    this.connectSocket('coinbase', 'wss://ws-feed.exchange.coinbase.com', (message) => {
      const record = getRecord(parseJson(message));
      if (asString(record.type) !== 'ticker') return;
      const symbol = asString(record.product_id);
      const [baseAsset, quoteAsset] = symbol?.split('-') ?? [];
      if (!symbol || !baseAsset || !quoteAsset) return;
      const lastPrice = parseNumber(record.price);
      const open24h = parseNumber(record.open_24h);
      const changePercent = lastPrice !== null && open24h !== null && open24h !== 0 ? ((lastPrice - open24h) / open24h) * 100 : null;
      const volume24hBase = parseNumber(record.volume_24h);
      const volume24hQuote = lastPrice !== null && volume24hBase !== null ? lastPrice * volume24hBase : null;
      const tickers = createTicker({
        exchange: 'coinbase',
        exchangeLabel: 'Coinbase',
        symbol,
        baseAsset,
        quoteAsset,
        lastPrice,
        priceChangePercent24h: changePercent,
        volume24hBase,
        volume24hQuote
      });
      this.updateLiveTickers('coinbase', tickers);
    }, (socket) => {
      const productIds = this.cachedSymbols('coinbase');
      this.sendChunkedSubscriptions(socket, productIds, (chunk) => ({ type: 'subscribe', product_ids: chunk, channels: ['ticker'] }));
    });
  }

  private connectSocket(exchange: ExchangeKey, url: string, onMessage: (message: string) => void, onOpen?: (socket: WebSocket) => void): void {
    const existing = this.sockets.get(exchange);
    if (existing && (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)) return;

    const socket = new WebSocket(url, {
      headers: {
        'User-Agent': 'CryptoAttackDashboard/0.1'
      }
    });
    this.sockets.set(exchange, socket);

    socket.on('open', () => {
      onOpen?.(socket);
    });
    socket.on('message', (data) => {
      try {
        onMessage(data.toString());
      } catch (error) {
        this.options.logger.warn({ error, exchange }, 'Failed to parse live spot performance message');
      }
    });
    socket.on('error', (error) => {
      this.options.logger.warn({ error, exchange }, 'Live spot performance socket error');
    });
    socket.on('close', () => {
      if (this.sockets.get(exchange) === socket) this.sockets.delete(exchange);
      this.scheduleReconnect(exchange);
    });
  }

  private sendChunkedSubscriptions<T>(socket: WebSocket, args: T[], buildPayload: (chunk: T[]) => unknown): void {
    const chunkSize = 20;
    for (let index = 0; index < args.length; index += chunkSize) {
      const chunk = args.slice(index, index + chunkSize);
      const timer = setTimeout(() => {
        this.subscriptionTimers.delete(timer);
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(buildPayload(chunk)));
      }, Math.floor(index / chunkSize) * 250);
      timer.unref();
      this.subscriptionTimers.add(timer);
    }
  }

  private scheduleReconnect(exchange: ExchangeKey): void {
    if (!this.liveStarted || this.reconnectTimers.has(exchange)) return;
    const timer = setTimeout(() => {
      this.reconnectTimers.delete(exchange);
      const provider = this.providers.find((item) => item.exchange === exchange);
      if (provider) void this.primeAndConnect(provider);
    }, 5_000);
    timer.unref();
    this.reconnectTimers.set(exchange, timer);
  }

  private updateLiveTickers(exchange: ExchangeKey, tickers: SpotPerformanceTicker[]): void {
    if (!tickers.length) return;
    const provider = this.providers.find((item) => item.exchange === exchange);
    const previous = this.cache.get(exchange);
    const bySymbol = new Map<string, SpotPerformanceTicker>();
    for (const ticker of previous?.tickers ?? []) bySymbol.set(ticker.symbol, ticker);
    for (const ticker of tickers) bySymbol.set(ticker.symbol, ticker);

    const updatedAt = new Date().toISOString();
    this.cache.set(exchange, {
      expiresAt: Date.now() + this.cacheTtlMs,
      source: {
        exchange,
        exchangeLabel: provider?.exchangeLabel ?? exchange,
        status: 'ok',
        updatedAt,
        errorMessage: null,
        itemCount: bySymbol.size
      },
      tickers: [...bySymbol.values()]
    });
    this.schedulePerformanceUpdate(exchange);
  }

  private schedulePerformanceUpdate(exchange: ExchangeKey): void {
    if (this.updateTimers.has(exchange)) return;
    const timer = setTimeout(() => {
      this.updateTimers.delete(exchange);
      const result = this.cache.get(exchange);
      if (!result) return;
      const tickers = result.tickers.filter((ticker) => ticker.quoteAsset === PERFORMANCE_QUOTE_ASSET);
      const utcDayTickers = this.utcDayCache.get(exchange)?.tickers.filter((ticker) => ticker.quoteAsset === PERFORMANCE_QUOTE_ASSET) ?? [];
      this.emit('update', buildPerformanceResponse({ exchange, limit: LIVE_UPDATE_LIMIT, results: [result], tickers, utcDayTickers }));
    }, this.liveUpdateIntervalMs);
    timer.unref();
    this.updateTimers.set(exchange, timer);
  }

  private cachedSymbols(exchange: ExchangeKey): string[] {
    return [...this.cachedSymbolMap(exchange).keys()];
  }

  private cachedSymbolMap(exchange: ExchangeKey): Map<string, SpotPerformanceTicker> {
    return new Map((this.cache.get(exchange)?.tickers ?? []).map((ticker) => [ticker.symbol, ticker]));
  }
}

export function createDefaultSpotPerformanceProviders(): SpotPerformanceProvider[] {
  return [
    { exchange: 'binance', exchangeLabel: 'Binance', fetchTickers: fetchBinanceSpotPerformance, fetchUtcDayTickers: fetchBinanceSpotUtcDayPerformance },
    { exchange: 'bybit', exchangeLabel: 'Bybit', fetchTickers: fetchBybitSpotPerformance, fetchUtcDayTickers: fetchBybitSpotUtcDayPerformance },
    { exchange: 'okx', exchangeLabel: 'OKX', fetchTickers: fetchOkxSpotPerformance, fetchUtcDayTickers: fetchOkxSpotPerformance }
  ];
}

function buildPerformanceResponse(input: { exchange: ExchangeKey | 'all'; limit: number; results: CachedProviderResult[]; tickers: SpotPerformanceTicker[]; utcDayTickers?: SpotPerformanceTicker[] }): SpotPerformanceResponse {
  const utcDayTickers = input.utcDayTickers ?? [];
  return {
    generatedAt: new Date().toISOString(),
    exchange: input.exchange,
    market: 'spot',
    limit: input.limit,
    sources: input.results.map((result) => result.source),
    gainers: input.tickers
      .filter((ticker) => ticker.priceChangePercent24h > 0)
      .sort(compareGainers)
      .slice(0, input.limit),
    losers: input.tickers
      .filter((ticker) => ticker.priceChangePercent24h < 0)
      .sort(compareLosers)
      .slice(0, input.limit),
    liveGainers: utcDayTickers
      .filter((ticker) => getUtcDayChange(ticker) > 0)
      .sort(compareUtcDayGainers)
      .slice(0, input.limit),
    liveLosers: utcDayTickers
      .filter((ticker) => getUtcDayChange(ticker) < 0)
      .sort(compareUtcDayLosers)
      .slice(0, input.limit)
  };
}

async function fetchBinanceSpotPerformance(input: ProviderInput): Promise<SpotPerformanceTicker[]> {
  const [data, exchangeInfo] = await Promise.all([
    fetchJson('https://api.binance.com/api/v3/ticker/24hr', input.timeoutMs),
    fetchJson('https://api.binance.com/api/v3/exchangeInfo', input.timeoutMs)
  ]);
  const activeSymbols = getActiveBinanceSpotSymbols(exchangeInfo);
  const rows = Array.isArray(data) ? data : [];
  return rows.flatMap((item) => {
    const record = getRecord(item);
    const symbol = asString(record.symbol);
    const parsedSymbol = symbol ? activeSymbols.get(symbol) ?? null : null;
    if (!symbol || !parsedSymbol) return [];

    return createTicker({
      exchange: 'binance',
      exchangeLabel: 'Binance',
      symbol,
      baseAsset: parsedSymbol.baseAsset,
      quoteAsset: parsedSymbol.quoteAsset,
      lastPrice: parseNumber(record.lastPrice),
      priceChangePercent24h: parseNumber(record.priceChangePercent),
      volume24hBase: parseNumber(record.volume),
      volume24hQuote: parseNumber(record.quoteVolume)
    });
  });
}

async function fetchBinanceSpotUtcDayPerformance(input: ProviderInput): Promise<SpotPerformanceTicker[]> {
  const exchangeInfo = await fetchJson('https://api.binance.com/api/v3/exchangeInfo', input.timeoutMs);
  const activeSymbols = getActiveBinanceSpotSymbols(exchangeInfo);
  const symbolBatches = chunkArray([...activeSymbols.keys()], 100);
  const batchRows = await Promise.all(symbolBatches.map((symbols) => fetchBinanceTradingDayBatch(symbols, input.timeoutMs)));
  const rows = batchRows.flat();
  return rows.flatMap((item) => {
    const record = getRecord(item);
    const symbol = asString(record.symbol);
    const parsedSymbol = symbol ? activeSymbols.get(symbol) ?? null : null;
    if (!symbol || !parsedSymbol) return [];

    const utcDayChange = parseNumber(record.priceChangePercent);
    return createTicker({
      exchange: 'binance',
      exchangeLabel: 'Binance',
      symbol,
      baseAsset: parsedSymbol.baseAsset,
      quoteAsset: parsedSymbol.quoteAsset,
      lastPrice: parseNumber(record.lastPrice),
      priceChangePercent24h: utcDayChange,
      priceChangePercentUtcDay: utcDayChange,
      volume24hBase: parseNumber(record.volume),
      volume24hQuote: parseNumber(record.quoteVolume)
    });
  });
}

async function fetchBinanceTradingDayBatch(symbols: string[], timeoutMs: number): Promise<unknown[]> {
  if (!symbols.length) return [];
  const params = new URLSearchParams({
    symbols: JSON.stringify(symbols),
    timeZone: '0',
    type: 'FULL'
  });
  const data = await fetchJson(`https://api.binance.com/api/v3/ticker/tradingDay?${params.toString()}`, timeoutMs);
  return Array.isArray(data) ? data : [data];
}

function getActiveBinanceSpotSymbols(data: unknown): Map<string, { baseAsset: string; quoteAsset: string }> {
  const symbols = new Map<string, { baseAsset: string; quoteAsset: string }>();
  for (const item of getArray(getRecord(data), 'symbols')) {
    const record = getRecord(item);
    const symbol = asString(record.symbol);
    const baseAsset = asString(record.baseAsset);
    const quoteAsset = asString(record.quoteAsset);
    if (!symbol || !baseAsset || quoteAsset !== PERFORMANCE_QUOTE_ASSET) continue;
    if (asString(record.status) !== 'TRADING') continue;
    if (record.isSpotTradingAllowed === false) continue;
    symbols.set(symbol, { baseAsset, quoteAsset });
  }
  return symbols;
}

async function fetchBybitSpotPerformance(input: ProviderInput): Promise<SpotPerformanceTicker[]> {
  const data = await fetchJson('https://api.bybit.com/v5/market/tickers?category=spot', input.timeoutMs);
  const rows = getArray(getRecord(getRecord(data).result), 'list');
  return rows.flatMap((item) => {
    const record = getRecord(item);
    const symbol = asString(record.symbol);
    const parsedSymbol = symbol ? splitSymbol(symbol) : null;
    if (!symbol || !parsedSymbol) return [];

    const ratioChange = parseNumber(record.price24hPcnt);
    return createTicker({
      exchange: 'bybit',
      exchangeLabel: 'Bybit',
      symbol,
      baseAsset: parsedSymbol.baseAsset,
      quoteAsset: parsedSymbol.quoteAsset,
      lastPrice: parseNumber(record.lastPrice),
      priceChangePercent24h: ratioChange === null ? null : ratioChange * 100,
      volume24hBase: parseNumber(record.volume24h),
      volume24hQuote: parseNumber(record.turnover24h)
    });
  });
}

async function fetchBybitSpotUtcDayPerformance(input: ProviderInput): Promise<SpotPerformanceTicker[]> {
  const tickers = await fetchBybitSpotPerformance(input);
  const dayStartMs = getUtcDayStartMs();

  for (const [symbol, cached] of bybitUtcOpenCache) {
    if (cached.dayStartMs !== dayStartMs) bybitUtcOpenCache.delete(symbol);
  }

  const missingSymbols = [...new Set(tickers
    .filter((ticker) => ticker.lastPrice !== null)
    .map((ticker) => ticker.symbol)
    .filter((symbol) => bybitUtcOpenCache.get(symbol)?.dayStartMs !== dayStartMs))];

  const dailyOpens = await mapWithConcurrency(missingSymbols, BYBIT_UTC_KLINE_CONCURRENCY, async (symbol) => {
    try {
      return await fetchBybitDailyOpen(symbol, dayStartMs, Math.min(input.timeoutMs, BYBIT_UTC_KLINE_TIMEOUT_MS));
    } catch {
      return null;
    }
  });

  for (const dailyOpen of dailyOpens) {
    if (dailyOpen) bybitUtcOpenCache.set(dailyOpen.symbol, { dayStartMs, openPrice: dailyOpen.openPrice });
  }

  return tickers.flatMap((ticker) => {
    const cachedOpen = bybitUtcOpenCache.get(ticker.symbol);
    if (ticker.lastPrice === null || !cachedOpen || cachedOpen.dayStartMs !== dayStartMs || cachedOpen.openPrice === 0) return [];
    const utcDayChange = ((ticker.lastPrice - cachedOpen.openPrice) / cachedOpen.openPrice) * 100;
    if (!Number.isFinite(utcDayChange)) return [];
    return [{ ...ticker, priceChangePercentUtcDay: utcDayChange }];
  });
}

async function fetchBybitDailyOpen(symbol: string, dayStartMs: number, timeoutMs: number): Promise<{ symbol: string; openPrice: number } | null> {
  const params = new URLSearchParams({
    category: 'spot',
    symbol,
    interval: 'D',
    start: String(dayStartMs),
    limit: '1'
  });
  const data = await fetchJson(`https://api.bybit.com/v5/market/kline?${params.toString()}`, timeoutMs);
  const row = getArray(getRecord(getRecord(data).result), 'list')[0];
  const values = Array.isArray(row) ? row : [];
  const rowStartMs = parseNumber(values[0]);
  const openPrice = parseNumber(values[1]);
  if (rowStartMs !== dayStartMs || openPrice === null || openPrice <= 0) return null;
  return { symbol, openPrice };
}

async function fetchOkxSpotPerformance(input: ProviderInput): Promise<SpotPerformanceTicker[]> {
  let data: unknown;
  try {
    data = await fetchJson('https://www.okx.com/api/v5/market/tickers?instType=SPOT', input.timeoutMs);
  } catch {
    return fetchOkxSpotPerformanceFromWebSocket(input);
  }
  const rows = getArray(getRecord(data), 'data');
  return rows.flatMap((item) => parseOkxTickerRecord(getRecord(item)) ?? []);
}

async function fetchOkxSpotPerformanceFromWebSocket(input: ProviderInput): Promise<SpotPerformanceTicker[]> {
  const symbols = await fetchCachedOkxUsdtSymbolsFromDisk().then((cachedSymbols) => cachedSymbols.length ? cachedSymbols : fetchCoinGeckoOkxUsdtSymbols(input));
  if (!symbols.length) return [];
  return collectOkxTickerSnapshots(symbols, Math.min(input.timeoutMs, 10_000));
}

async function fetchCachedOkxUsdtSymbolsFromDisk(): Promise<string[]> {
  const path = process.env.EXCHANGE_SYMBOL_CACHE_PATH || './data/exchange-symbols.json';
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch {
    return [];
  }

  const sources = getArray(getRecord(parsed), 'sources');
  const okxSpot = sources.find((source) => asString(getRecord(source).source) === 'okx_spot');
  return getArray(getRecord(okxSpot), 'symbols').flatMap((item) => {
    const record = getRecord(item);
    if (asString(record.quoteAsset) !== PERFORMANCE_QUOTE_ASSET) return [];
    if (asString(record.status) !== 'active') return [];
    const symbol = asString(record.symbol);
    return symbol ? [symbol] : [];
  });
}

async function fetchCoinGeckoOkxUsdtSymbols(input: ProviderInput): Promise<string[]> {
  const symbols = new Set<string>();
  for (let page = 1; page <= 6; page += 1) {
    let data: unknown;
    try {
      data = await fetchJson(`https://api.coingecko.com/api/v3/exchanges/okex/tickers?depth=false&page=${page}`, input.timeoutMs);
    } catch {
      if (symbols.size > 0) break;
      throw new Error('OKX REST and CoinGecko OKX fallback failed');
    }
    const tickers = getArray(getRecord(data), 'tickers');
    if (!tickers.length) break;
    for (const item of tickers) {
      const record = getRecord(item);
      const baseAsset = asString(record.base);
      const quoteAsset = asString(record.target);
      if (!baseAsset || quoteAsset !== PERFORMANCE_QUOTE_ASSET) continue;
      symbols.add(`${baseAsset.toUpperCase()}-${PERFORMANCE_QUOTE_ASSET}`);
    }
  }
  return [...symbols];
}

function collectOkxTickerSnapshots(symbols: string[], timeoutMs: number): Promise<SpotPerformanceTicker[]> {
  return new Promise((resolve, reject) => {
    const tickers = new Map<string, SpotPerformanceTicker>();
    const socket = new WebSocket('wss://ws.okx.com:8443/ws/v5/public', {
      headers: {
        'User-Agent': 'CryptoAttackDashboard/0.1'
      }
    });
    let settled = false;
    const timeout = setTimeout(() => finish(), Math.max(4_000, timeoutMs));
    timeout.unref();

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.close();
      resolve([...tickers.values()]);
    };

    socket.on('open', () => {
      sendChunkedSocketPayloads(socket, symbols.map((instId) => ({ channel: 'tickers', instId })), (chunk) => ({ op: 'subscribe', args: chunk }));
    });
    socket.on('message', (data) => {
      const rows = getArray(getRecord(parseJson(data.toString())), 'data');
      for (const item of rows) {
        const ticker = parseOkxTickerRecord(getRecord(item));
        if (ticker) tickers.set(ticker.symbol, ticker);
      }
      if (tickers.size >= Math.min(symbols.length, 250)) finish();
    });
    socket.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.close();
      reject(error);
    });
  });
}

async function fetchCoinbaseSpotPerformance(input: ProviderInput): Promise<SpotPerformanceTicker[]> {
  const data = await fetchJson('https://api.coinbase.com/api/v3/brokerage/market/products?product_type=SPOT&limit=500', input.timeoutMs);
  const rows = getArray(getRecord(data), 'products');
  return rows.flatMap((item) => {
    const record = getRecord(item);
    const symbol = asString(record.product_id);
    const baseAsset = asString(record.base_currency_id);
    const quoteAsset = asString(record.quote_currency_id);
    if (!symbol || !baseAsset || !quoteAsset || asString(record.product_type) !== 'SPOT') return [];
    if (asString(record.status) !== 'online' || Boolean(record.trading_disabled)) return [];

    return createTicker({
      exchange: 'coinbase',
      exchangeLabel: 'Coinbase',
      symbol,
      baseAsset,
      quoteAsset,
      lastPrice: parseNumber(record.price),
      priceChangePercent24h: parseNumber(record.price_percentage_change_24h),
      volume24hBase: parseNumber(record.volume_24h),
      volume24hQuote: parseNumber(record.approximate_quote_24h_volume)
    });
  });
}

function parseBybitTickerRecord(record: Record<string, unknown>): SpotPerformanceTicker | null {
  const symbol = asString(record.symbol);
  const parsedSymbol = symbol ? splitSymbol(symbol) : null;
  if (!symbol || !parsedSymbol) return null;
  const ratioChange = parseNumber(record.price24hPcnt);
  return createTicker({
    exchange: 'bybit',
    exchangeLabel: 'Bybit',
    symbol,
    baseAsset: parsedSymbol.baseAsset,
    quoteAsset: parsedSymbol.quoteAsset,
    lastPrice: parseNumber(record.lastPrice),
    priceChangePercent24h: ratioChange === null ? null : ratioChange * 100,
    volume24hBase: parseNumber(record.volume24h),
    volume24hQuote: parseNumber(record.turnover24h)
  })[0] ?? null;
}

function parseOkxTickerRecord(record: Record<string, unknown>): SpotPerformanceTicker | null {
  const symbol = asString(record.instId);
  const [baseAsset, quoteAsset] = symbol?.split('-') ?? [];
  if (!symbol || !baseAsset || !quoteAsset) return null;
  const lastPrice = parseNumber(record.last);
  const open24h = parseNumber(record.open24h);
  const sodUtc0 = parseNumber(record.sodUtc0);
  const changePercent = lastPrice !== null && open24h !== null && open24h !== 0 ? ((lastPrice - open24h) / open24h) * 100 : null;
  const utcDayChange = lastPrice !== null && sodUtc0 !== null && sodUtc0 !== 0 ? ((lastPrice - sodUtc0) / sodUtc0) * 100 : null;
  return createTicker({
    exchange: 'okx',
    exchangeLabel: 'OKX',
    symbol,
    baseAsset,
    quoteAsset,
    lastPrice,
    priceChangePercent24h: changePercent,
    priceChangePercentUtcDay: utcDayChange,
    volume24hBase: parseNumber(record.vol24h),
    volume24hQuote: parseNumber(record.volCcy24h)
  })[0] ?? null;
}

function sendChunkedSocketPayloads<T>(socket: WebSocket, args: T[], buildPayload: (chunk: T[]) => unknown): void {
  const chunkSize = 20;
  for (let index = 0; index < args.length; index += chunkSize) {
    const chunk = args.slice(index, index + chunkSize);
    const timer = setTimeout(() => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(buildPayload(chunk)));
    }, Math.floor(index / chunkSize) * 250);
    timer.unref();
  }
}

function createTicker(input: TickerInput): SpotPerformanceTicker[] {
  if (!exchangeKeys.includes(input.exchange)) return [];
  const priceChangePercent24h = input.priceChangePercent24h;
  if (priceChangePercent24h === null || !Number.isFinite(priceChangePercent24h)) return [];
  if (input.quoteAsset.toUpperCase() !== PERFORMANCE_QUOTE_ASSET) return [];
  return [{
    exchange: input.exchange,
    exchangeLabel: input.exchangeLabel,
    market: 'spot',
    symbol: input.symbol.toUpperCase(),
    baseAsset: input.baseAsset.toUpperCase(),
    quoteAsset: input.quoteAsset.toUpperCase(),
    lastPrice: input.lastPrice,
    priceChangePercent24h,
    priceChangePercentUtcDay: input.priceChangePercentUtcDay ?? null,
    volume24hBase: input.volume24hBase,
    volume24hQuote: input.volume24hQuote
  }];
}

function getUtcDayChange(ticker: SpotPerformanceTicker): number {
  return typeof ticker.priceChangePercentUtcDay === 'number' && Number.isFinite(ticker.priceChangePercentUtcDay)
    ? ticker.priceChangePercentUtcDay
    : Number.NaN;
}

function compareGainers(left: SpotPerformanceTicker, right: SpotPerformanceTicker): number {
  return right.priceChangePercent24h - left.priceChangePercent24h || compareVolume(right, left) || compareTickerIdentity(left, right);
}

function compareLosers(left: SpotPerformanceTicker, right: SpotPerformanceTicker): number {
  return left.priceChangePercent24h - right.priceChangePercent24h || compareVolume(right, left) || compareTickerIdentity(left, right);
}

function compareUtcDayGainers(left: SpotPerformanceTicker, right: SpotPerformanceTicker): number {
  return getUtcDayChange(right) - getUtcDayChange(left) || compareVolume(right, left) || compareTickerIdentity(left, right);
}

function compareUtcDayLosers(left: SpotPerformanceTicker, right: SpotPerformanceTicker): number {
  return getUtcDayChange(left) - getUtcDayChange(right) || compareVolume(right, left) || compareTickerIdentity(left, right);
}

function compareVolume(left: SpotPerformanceTicker, right: SpotPerformanceTicker): number {
  return (left.volume24hQuote ?? Number.NEGATIVE_INFINITY) - (right.volume24hQuote ?? Number.NEGATIVE_INFINITY);
}

function compareTickerIdentity(left: SpotPerformanceTicker, right: SpotPerformanceTicker): number {
  return left.exchange.localeCompare(right.exchange) || left.symbol.localeCompare(right.symbol);
}

function splitSymbol(symbol: string): { baseAsset: string; quoteAsset: string } | null {
  const upperSymbol = symbol.toUpperCase();
  const quoteAsset = KNOWN_QUOTES.find((quote) => upperSymbol.endsWith(quote) && upperSymbol.length > quote.length);
  return quoteAsset ? { baseAsset: upperSymbol.slice(0, -quoteAsset.length), quoteAsset } : null;
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index] as T);
    }
  }

  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function getUtcDayStartMs(): number {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

function parseJson(message: string): unknown {
  try {
    return JSON.parse(message) as unknown;
  } catch {
    return null;
  }
}

function parseJsonArray(message: string): unknown[] {
  const parsed = parseJson(message);
  if (Array.isArray(parsed)) return parsed;
  return parsed === null ? [] : [parsed];
}

async function fetchJson(url: string, timeoutMs: number): Promise<unknown> {
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

function parseNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
