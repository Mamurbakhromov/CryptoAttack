export const exchangeKeys = ['binance', 'bybit', 'okx', 'coinbase'] as const;
export const exchangeMarkets = ['spot', 'perpetual'] as const;
export const exchangeSymbolSourceKeys = [
  'binance_spot',
  'binance_perpetual',
  'bybit_spot',
  'bybit_perpetual',
  'okx_spot',
  'okx_perpetual',
  'coinbase_spot'
] as const;

export type ExchangeKey = (typeof exchangeKeys)[number];
export type ExchangeMarket = (typeof exchangeMarkets)[number];
export type ExchangeSymbolSourceKey = (typeof exchangeSymbolSourceKeys)[number];
export type ExchangeSymbolStatus = 'active' | 'inactive' | 'unknown';
export type ExchangeSymbolSourceStatus = 'idle' | 'ok' | 'error';

export interface ExchangeSymbol {
  source: ExchangeSymbolSourceKey;
  exchange: ExchangeKey;
  exchangeLabel: string;
  market: ExchangeMarket;
  marketLabel: string;
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  status: ExchangeSymbolStatus;
  rawStatus: string | null;
}

export interface ExchangeSymbolSourceSnapshot {
  source: ExchangeSymbolSourceKey;
  exchange: ExchangeKey;
  exchangeLabel: string;
  market: ExchangeMarket;
  marketLabel: string;
  status: ExchangeSymbolSourceStatus;
  updatedAt: string | null;
  lastAttemptAt: string | null;
  errorMessage: string | null;
  symbolCount: number;
  symbols: ExchangeSymbol[];
}

export interface ExchangeSymbolSourceSummary {
  source: ExchangeSymbolSourceKey;
  exchange: ExchangeKey;
  exchangeLabel: string;
  market: ExchangeMarket;
  marketLabel: string;
  status: ExchangeSymbolSourceStatus;
  updatedAt: string | null;
  lastAttemptAt: string | null;
  errorMessage: string | null;
  symbolCount: number;
}

export interface ExchangeSymbolQuery {
  exchange?: ExchangeKey | undefined;
  market?: ExchangeMarket | undefined;
  search?: string | undefined;
  quoteAsset?: string | undefined;
  status?: ExchangeSymbolStatus | 'all';
  limit: number;
  offset: number;
}

export interface ExchangeSymbolResponse {
  generatedAt: string;
  enabled: boolean;
  refreshing: boolean;
  refreshUtcTime: string;
  nextRefreshAt: string | null;
  lastRefreshStartedAt: string | null;
  lastRefreshCompletedAt: string | null;
  total: number;
  returned: number;
  offset: number;
  limit: number;
  exchanges: ExchangeKey[];
  markets: ExchangeMarket[];
  sources: ExchangeSymbolSourceSummary[];
  symbols: ExchangeSymbol[];
}

export interface ExchangeSymbolCacheFile {
  version: 1;
  generatedAt: string;
  sources: ExchangeSymbolSourceSnapshot[];
}

export interface ExchangeSymbolRefreshResult {
  startedAt: string;
  completedAt: string;
  reason: string;
  refreshed: number;
  failed: number;
  totalSymbols: number;
}

export interface SpotPerformanceTicker {
  exchange: ExchangeKey;
  exchangeLabel: string;
  market: 'spot';
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  lastPrice: number | null;
  priceChangePercent24h: number;
  priceChangePercentUtcDay?: number | null;
  volume24hBase: number | null;
  volume24hQuote: number | null;
}

export interface SpotPerformanceSourceSummary {
  exchange: ExchangeKey;
  exchangeLabel: string;
  status: ExchangeSymbolSourceStatus;
  updatedAt: string | null;
  errorMessage: string | null;
  itemCount: number;
}

export interface SpotPerformanceQuery {
  exchange?: ExchangeKey | undefined;
  limit: number;
}

export interface SpotPerformanceResponse {
  generatedAt: string;
  exchange: ExchangeKey | 'all';
  market: 'spot';
  limit: number;
  sources: SpotPerformanceSourceSummary[];
  gainers: SpotPerformanceTicker[];
  losers: SpotPerformanceTicker[];
  liveGainers: SpotPerformanceTicker[];
  liveLosers: SpotPerformanceTicker[];
}
