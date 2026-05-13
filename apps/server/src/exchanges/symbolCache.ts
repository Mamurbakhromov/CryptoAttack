import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { createDefaultExchangeSymbolProviders, type ExchangeSymbolProvider } from './providers.js';
import {
  exchangeKeys,
  exchangeMarkets,
  type ExchangeKey,
  type ExchangeMarket,
  type ExchangeSymbol,
  type ExchangeSymbolCacheFile,
  type ExchangeSymbolQuery,
  type ExchangeSymbolRefreshResult,
  type ExchangeSymbolResponse,
  type ExchangeSymbolSourceKey,
  type ExchangeSymbolSourceSnapshot,
  type ExchangeSymbolSourceSummary,
  type ExchangeSymbolStatus
} from './types.js';
import type { AppLogger } from '../utils/logger.js';

interface ExchangeSymbolCacheOptions {
  enabled: boolean;
  cachePath: string;
  refreshUtcTime: string;
  refreshTimeoutMs: number;
  refreshOnStart: boolean;
  logger: AppLogger;
  providers?: ExchangeSymbolProvider[];
}

const CACHE_VERSION = 1;
const DEFAULT_LIMIT = 500;

export class ExchangeSymbolCache {
  private readonly providers: ExchangeSymbolProvider[];
  private readonly sources = new Map<ExchangeSymbolSourceKey, ExchangeSymbolSourceSnapshot>();
  private refreshTimer: NodeJS.Timeout | null = null;
  private refreshPromise: Promise<ExchangeSymbolRefreshResult> | null = null;
  private nextRefreshAt: string | null = null;
  private lastRefreshStartedAt: string | null = null;
  private lastRefreshCompletedAt: string | null = null;

  constructor(private readonly options: ExchangeSymbolCacheOptions) {
    this.providers = options.providers ?? createDefaultExchangeSymbolProviders();
    for (const provider of this.providers) {
      this.sources.set(provider.source, createEmptySource(provider));
    }
  }

  async loadFromDisk(): Promise<void> {
    const path = this.absoluteCachePath();
    let content: string;
    try {
      content = await readFile(path, 'utf8');
    } catch {
      return;
    }

    try {
      const parsed = JSON.parse(content) as Partial<ExchangeSymbolCacheFile>;
      if (parsed.version !== CACHE_VERSION || !Array.isArray(parsed.sources)) return;

      for (const source of parsed.sources) {
        const provider = this.providers.find((item) => item.source === source.source);
        if (!provider) continue;
        this.sources.set(provider.source, sanitizeSourceSnapshot(source, provider));
      }
    } catch (error) {
      this.options.logger.warn({ error, path }, 'Failed to load exchange symbol cache file');
    }
  }

  start(): void {
    if (!this.options.enabled) return;
    this.scheduleNextRefresh();
    if (this.options.refreshOnStart) {
      void this.refresh('startup').catch((error) => {
        this.options.logger.warn({ error }, 'Startup exchange symbol refresh failed');
      });
    }
  }

  stop(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
  }

  refresh(reason = 'manual'): Promise<ExchangeSymbolRefreshResult> {
    if (!this.options.enabled) {
      const now = new Date().toISOString();
      return Promise.resolve({ startedAt: now, completedAt: now, reason, refreshed: 0, failed: 0, totalSymbols: this.allSymbols().length });
    }
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.doRefresh(reason).finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  }

  getSymbols(query: ExchangeSymbolQuery): ExchangeSymbolResponse {
    const generatedAt = new Date().toISOString();
    const normalizedSearch = query.search?.trim().toUpperCase() ?? '';
    const normalizedQuoteAsset = query.quoteAsset?.trim().toUpperCase() ?? '';
    let symbols = this.allSymbols();

    if (query.exchange) symbols = symbols.filter((symbol) => symbol.exchange === query.exchange);
    if (query.market) symbols = symbols.filter((symbol) => symbol.market === query.market);
    if (normalizedQuoteAsset) symbols = symbols.filter((symbol) => symbol.quoteAsset === normalizedQuoteAsset);
    if (query.status && query.status !== 'all') symbols = symbols.filter((symbol) => symbol.status === query.status);
    if (normalizedSearch) {
      symbols = symbols.filter((symbol) => {
        return symbol.symbol.includes(normalizedSearch) || symbol.baseAsset.includes(normalizedSearch) || symbol.quoteAsset.includes(normalizedSearch);
      });
    }

    symbols = symbols.sort(compareSymbols);
    const total = symbols.length;
    const offset = Math.max(0, query.offset);
    const limit = Math.max(1, query.limit || DEFAULT_LIMIT);
    const paged = symbols.slice(offset, offset + limit);

    return {
      generatedAt,
      enabled: this.options.enabled,
      refreshing: this.refreshPromise !== null,
      refreshUtcTime: this.options.refreshUtcTime,
      nextRefreshAt: this.nextRefreshAt,
      lastRefreshStartedAt: this.lastRefreshStartedAt,
      lastRefreshCompletedAt: this.lastRefreshCompletedAt,
      total,
      returned: paged.length,
      offset,
      limit,
      exchanges: [...exchangeKeys],
      markets: [...exchangeMarkets],
      sources: this.sourceSummaries(),
      symbols: paged
    };
  }

  private async doRefresh(reason: string): Promise<ExchangeSymbolRefreshResult> {
    const startedAt = new Date().toISOString();
    this.lastRefreshStartedAt = startedAt;
    let refreshed = 0;
    let failed = 0;

    for (const provider of this.providers) {
      try {
        await this.refreshProvider(provider, startedAt);
        refreshed += 1;
      } catch {
        failed += 1;
      }
    }

    const completedAt = new Date().toISOString();
    this.lastRefreshCompletedAt = completedAt;
    await this.persist().catch((error) => {
      this.options.logger.warn({ error, path: this.absoluteCachePath() }, 'Failed to persist exchange symbol cache');
    });

    const refreshResult = { startedAt, completedAt, reason, refreshed, failed, totalSymbols: this.allSymbols().length };
    this.options.logger.info(refreshResult, 'Exchange symbol cache refresh completed');
    return refreshResult;
  }

  private async refreshProvider(provider: ExchangeSymbolProvider, now: string): Promise<void> {
    try {
      const symbols = await provider.fetchSymbols({ timeoutMs: this.options.refreshTimeoutMs });
      this.sources.set(provider.source, {
        ...createEmptySource(provider),
        status: 'ok',
        updatedAt: now,
        lastAttemptAt: now,
        symbolCount: symbols.length,
        symbols
      });
    } catch (error) {
      const previous = this.sources.get(provider.source) ?? createEmptySource(provider);
      this.sources.set(provider.source, {
        ...previous,
        status: 'error',
        lastAttemptAt: now,
        errorMessage: error instanceof Error ? error.message : String(error),
        symbolCount: previous.symbols.length
      });
      throw error;
    }
  }

  private async persist(): Promise<void> {
    const path = this.absoluteCachePath();
    const tmpPath = `${path}.tmp`;
    const file: ExchangeSymbolCacheFile = {
      version: CACHE_VERSION,
      generatedAt: new Date().toISOString(),
      sources: [...this.sources.values()]
    };
    await mkdir(dirname(path), { recursive: true });
    await writeFile(tmpPath, JSON.stringify(file, null, 2), 'utf8');
    await rename(tmpPath, path);
  }

  private scheduleNextRefresh(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    const next = nextDailyUtcTime(this.options.refreshUtcTime);
    this.nextRefreshAt = next.toISOString();
    const delayMs = Math.max(1_000, next.getTime() - Date.now());
    this.refreshTimer = setTimeout(() => {
      void this.refresh('scheduled').finally(() => this.scheduleNextRefresh());
    }, delayMs);
    this.refreshTimer.unref();
  }

  private sourceSummaries(): ExchangeSymbolSourceSummary[] {
    return this.providers.map((provider) => {
      const source = this.sources.get(provider.source) ?? createEmptySource(provider);
      return {
        source: source.source,
        exchange: source.exchange,
        exchangeLabel: source.exchangeLabel,
        market: source.market,
        marketLabel: source.marketLabel,
        status: source.status,
        updatedAt: source.updatedAt,
        lastAttemptAt: source.lastAttemptAt,
        errorMessage: source.errorMessage,
        symbolCount: source.symbolCount
      };
    });
  }

  private allSymbols(): ExchangeSymbol[] {
    return [...this.sources.values()].flatMap((source) => source.symbols);
  }

  private absoluteCachePath(): string {
    return resolve(process.cwd(), this.options.cachePath);
  }
}

function createEmptySource(provider: Omit<ExchangeSymbolProvider, 'fetchSymbols'>): ExchangeSymbolSourceSnapshot {
  return {
    source: provider.source,
    exchange: provider.exchange,
    exchangeLabel: provider.exchangeLabel,
    market: provider.market,
    marketLabel: provider.marketLabel,
    status: 'idle',
    updatedAt: null,
    lastAttemptAt: null,
    errorMessage: null,
    symbolCount: 0,
    symbols: []
  };
}

function sanitizeSourceSnapshot(source: ExchangeSymbolSourceSnapshot, provider: Omit<ExchangeSymbolProvider, 'fetchSymbols'>): ExchangeSymbolSourceSnapshot {
  const symbols = Array.isArray(source.symbols)
    ? source.symbols.flatMap((symbol) => sanitizeSymbol(symbol, provider))
    : [];

  return {
    ...createEmptySource(provider),
    status: source.status === 'ok' || source.status === 'error' ? source.status : 'idle',
    updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : null,
    lastAttemptAt: typeof source.lastAttemptAt === 'string' ? source.lastAttemptAt : null,
    errorMessage: typeof source.errorMessage === 'string' ? source.errorMessage : null,
    symbolCount: symbols.length,
    symbols
  };
}

function sanitizeSymbol(symbol: ExchangeSymbol, provider: Omit<ExchangeSymbolProvider, 'fetchSymbols'>): ExchangeSymbol[] {
  if (!isExchangeSymbolStatus(symbol.status) || !symbol.symbol || !symbol.baseAsset || !symbol.quoteAsset) return [];
  return [{
    source: provider.source,
    exchange: provider.exchange,
    exchangeLabel: provider.exchangeLabel,
    market: provider.market,
    marketLabel: provider.marketLabel,
    symbol: symbol.symbol,
    baseAsset: symbol.baseAsset,
    quoteAsset: symbol.quoteAsset,
    status: symbol.status,
    rawStatus: typeof symbol.rawStatus === 'string' ? symbol.rawStatus : null
  }];
}

function isExchangeSymbolStatus(value: unknown): value is ExchangeSymbolStatus {
  return value === 'active' || value === 'inactive' || value === 'unknown';
}

function compareSymbols(left: ExchangeSymbol, right: ExchangeSymbol): number {
  return left.exchange.localeCompare(right.exchange) || left.market.localeCompare(right.market) || left.baseAsset.localeCompare(right.baseAsset) || left.symbol.localeCompare(right.symbol);
}

function nextDailyUtcTime(value: string): Date {
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  const hour = match?.[1] ? Number(match[1]) : 0;
  const minute = match?.[2] ? Number(match[2]) : 5;
  const boundedHour = Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 0;
  const boundedMinute = Number.isInteger(minute) && minute >= 0 && minute <= 59 ? minute : 5;
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), boundedHour, boundedMinute, 0, 0));
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}
