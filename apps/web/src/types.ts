export const feedKeys = [
  'listings',
  'delistings',
  'all_derivatives_top_buy_5m',
  'all_derivatives_top_sell_5m',
  'all_spot_top_buy_5m',
  'all_spot_top_sell_5m',
  'all_spot_per',
  'all_derivatives_per',
  'top_oi_gainers_60m',
  'top_oi_losers_60m',
  'oi_alerts',
  'pricealerts',
  'pricealerts2',
  'price_alerts',
  'volalerts',
  'flows_alert',
  'cex_track',
  'top_funding',
  'etf_crypto',
  'onchain_24_all_flows',
  'onchain_1_all_flows',
  'raw_unclassified'
] as const;

export type FeedKey = (typeof feedKeys)[number];
export type ExchangeKey = 'binance' | 'bybit' | 'okx' | 'coinbase';
export type ExchangeMarket = 'spot' | 'perpetual';
export type TopSpotHistoryMarket = 'spot' | 'perpetual';
export type TopSpotHistorySide = 'buy' | 'sell';
export type TopSpotHistoryFeedKey =
  | 'all_spot_top_buy_5m'
  | 'all_spot_top_sell_5m'
  | 'all_derivatives_top_buy_5m'
  | 'all_derivatives_top_sell_5m';
export type TopOiHistorySide = 'gainer' | 'loser';
export type TopOiHistoryFeedKey = 'top_oi_gainers_60m' | 'top_oi_losers_60m';
export type AmountsHistorySourceKey = 'spot_buy' | 'spot_sell' | 'derivatives_buy' | 'derivatives_sell';
export type ExchangeSymbolStatus = 'active' | 'inactive' | 'unknown';
export type ExchangeSymbolSourceStatus = 'idle' | 'ok' | 'error';

export interface ParsedTopEntry {
  rank: number | null;
  coin: string | null;
  pair: string | null;
  amountUsd: number | null;
  amountAsset?: string | null;
  buyUsd: number | null;
  sellUsd: number | null;
  deltaUsd: number | null;
  buySellRatio: number | null;
  volume24hUsd: number | null;
  volume24hAsset?: string | null;
  percent: number | null;
  priceUsd: number | null;
  priceChangePercent: number | null;
  oiChange15mPercent?: number | null;
  oiChange30mPercent?: number | null;
  followupPriceChangePercent?: number | null;
  totalAlerts?: number | null;
  notifiedAt?: string | null;
  href?: string | null;
  threshold?: string | null;
  lastSeen?: string | null;
  direction: 'buy' | 'sell' | 'gainer' | 'loser' | 'inflow' | 'outflow' | 'activity' | 'unknown';
  interval: string | null;
  exchange: string | null;
  rawLine: string;
}

export interface AmountMetric {
  status: 'ok' | 'parser_needs_sample';
  totalUsd: number | null;
  sourceFeedKey: FeedKey;
  entryCount: number;
  message: string;
}

export interface NormalizedEvent {
  id: string;
  feedKey: FeedKey;
  chapter: string;
  category: string;
  title: string;
  plainText: string;
  htmlText: string;
  coins: string[];
  filters: string[];
  timestamp: string;
  sourceTime: number | null;
  receivedAt: string;
  latencyMs: number | null;
  severity: 'info' | 'warning' | 'critical';
  raw: unknown;
  endpoint: string;
  entries: ParsedTopEntry[];
  amountMetric: AmountMetric | null;
  parserStatus: 'parsed' | 'parser_needs_sample' | 'not_applicable';
}

export interface FeedSnapshot {
  events: NormalizedEvent[];
  latest: NormalizedEvent | null;
}

export interface EventCounters {
  received: number;
  stored: number;
  deduplicated: number;
  byFeed: Record<FeedKey, number>;
}

export interface LatencyStats {
  latestMs: number | null;
  averageMs: number | null;
  samples: number;
}

export interface DashboardSnapshot {
  generatedAt: string;
  feeds: Record<FeedKey, FeedSnapshot>;
  counters: EventCounters;
  lastEventTime: string | null;
  latency: LatencyStats;
}

export interface SubscriptionStatus {
  key: string;
  chapter: string;
  category: string;
  state: 'pending' | 'attempted' | 'disabled';
  attempts: number;
  lastAttemptAt: string | null;
  payloadPreview: Record<string, unknown> | null;
  notes: string | null;
  needsConfirmation: boolean;
}

export interface ConnectionStatus {
  name: string;
  url: string;
  connected: boolean;
  serverConnected: boolean;
  enabled: boolean;
  mock: boolean;
  generation: number;
  socketId: string | null;
  transport: string | null;
  lastConnectedAt: string | null;
  lastDisconnectedAt: string | null;
  lastError: string | null;
  subscriptions: SubscriptionStatus[];
  subscriptionCount: number;
  lastNewsAt: string | null;
}

export interface ApiStatus {
  generatedAt: string;
  uptimeSeconds: number;
  mockMode: boolean;
  authEnabled: boolean;
  sockets: Record<string, ConnectionStatus>;
  counters: EventCounters;
  lastEventTime: string | null;
  lastEventByCategory: Record<string, string>;
  latency: LatencyStats;
  storage?: DurableStorageStatus;
  health?: StorageOperationalHealth;
  database?: DatabaseHealthStatus;
  writer?: StorageWriterHealth;
  tableSizes?: Record<string, TableSizeStatus>;
  startupWarnings?: StartupWarning[];
}

export interface DurableStorageStatus {
  enabled: boolean;
  connected: boolean | null;
  state: 'disabled' | 'running' | 'draining' | 'stopped' | 'degraded';
  queueDepth: number;
  maxQueueDepth: number;
  inFlight: number;
  accepted: number;
  writtenJobs: number;
  writtenEvents: number;
  writtenEntries: number;
  dropped: number;
  failed: number;
  retried: number;
  lastAcceptedAt: string | null;
  lastWriteAt: string | null;
  lastFailureAt: string | null;
  lastDropAt: string | null;
  lastError: string | null;
  oldestQueuedAt: string | null;
  averageWriteMs: number | null;
}

export interface StorageStatusResponse {
  generatedAt: string;
  health?: StorageOperationalHealth;
  database?: DatabaseHealthStatus;
  writer?: StorageWriterHealth;
  tableSizes?: Record<string, TableSizeStatus>;
  startupWarnings?: StartupWarning[];
  storage: DurableStorageStatus;
}

export interface ClearEventDataResponse {
  generatedAt: string;
  clearedAt: string;
  inMemory: { cleared: boolean };
  database: { clearedAt: string; tables: string[] } | null;
  snapshot: DashboardSnapshot;
  status: ApiStatus;
  storageStatus: StorageStatusResponse;
}

export interface ResetAllStoredDataResponse {
  generatedAt: string;
  resetAt: string;
  inMemory: { cleared: boolean };
  database: { clearedAt: string; tables: string[] } | null;
  rawLog: {
    path: string;
    cleared: boolean;
    missing: boolean;
    bytesBefore: number | null;
    reason: string | null;
  };
  snapshot: DashboardSnapshot;
  status: ApiStatus;
  storageStatus: StorageStatusResponse;
}

export interface DeleteOldHistoryResponse {
  generatedAt: string;
  prunedAt: string;
  retentionDays: number;
  cutoff: string;
  database: {
    prunedAt: string;
    cutoff: string;
    retentionDays: number;
    rowsDeleted: number;
    tables: Array<{ table: string; rowsDeleted: number }>;
  } | null;
  rawLog: {
    path: string;
    enabled: boolean;
    missing: boolean;
    bytesBefore: number | null;
    bytesAfter: number | null;
    linesBefore: number;
    linesAfter: number;
    deletedLines: number;
    invalidLinesKept: number;
    reason: string | null;
  };
  status: ApiStatus;
  storageStatus: StorageStatusResponse;
}

export interface TopSpotHistoryHit {
  eventId: string;
  receivedAt: string;
  feedKey: FeedKey;
  rank: number | null;
  coin: string;
  market?: string | null;
  direction?: ParsedTopEntry['direction'] | null;
  exchange: string | null;
  amountUsd?: number | null;
  buyUsd: number | null;
  sellUsd: number | null;
  deltaUsd: number | null;
  buySellRatio: number | null;
  percent: number | null;
  priceUsd?: number | null;
  priceChangePercent?: number | null;
  oiChange15mPercent?: number | null;
  oiChange30mPercent?: number | null;
  volume24hUsd: number | null;
  rawLine: string;
}

export interface TopSpotHistorySummary {
  primaryHitCount: number;
  comparisonHitCount: number;
  latestPrimaryRatio: number | null;
  primaryAverage3: number | null;
}

export interface TopSpotHistoryResponse {
  generatedAt: string;
  enabled: boolean;
  state?: 'disabled';
  reason?: 'history_storage_unavailable';
  coin: string;
  from: string;
  to: string;
  market: TopSpotHistoryMarket;
  side: TopSpotHistorySide;
  primaryFeedKey: TopSpotHistoryFeedKey;
  comparisonFeedKey: TopSpotHistoryFeedKey;
  hits: TopSpotHistoryHit[];
  comparisonHits: TopSpotHistoryHit[];
  summary: TopSpotHistorySummary;
}

export interface TopOiHistoryResponse {
  generatedAt: string;
  enabled: boolean;
  state?: 'disabled';
  reason?: 'history_storage_unavailable';
  coin: string;
  from: string;
  to: string;
  side: TopOiHistorySide;
  primaryFeedKey: TopOiHistoryFeedKey;
  comparisonFeedKey: TopOiHistoryFeedKey;
  hits: TopSpotHistoryHit[];
  comparisonHits: TopSpotHistoryHit[];
  summary: TopSpotHistorySummary;
}

export interface AmountsHistoryResponse {
  generatedAt: string;
  enabled: boolean;
  state?: 'disabled';
  reason?: 'history_storage_unavailable';
  coin: string;
  from: string;
  to: string;
  market: TopSpotHistoryMarket;
  side: TopSpotHistorySide;
  primaryFeedKey: AmountsHistorySourceKey;
  comparisonFeedKey: AmountsHistorySourceKey;
  hits: TopSpotHistoryHit[];
  comparisonHits: TopSpotHistoryHit[];
  summary: TopSpotHistorySummary;
}

export interface TopSpotFeedHistorySnapshot {
  events: NormalizedEvent[];
  latest: NormalizedEvent | null;
}

export interface TopSpotFeedHistoryResponse {
  generatedAt: string;
  enabled: boolean;
  state?: 'disabled';
  reason?: 'history_storage_unavailable';
  from: string;
  to: string;
  feeds: Record<TopSpotHistoryFeedKey, TopSpotFeedHistorySnapshot>;
  summary: {
    eventCount: number;
    entryCount: number;
  };
}

export interface TopOiFeedHistoryResponse {
  generatedAt: string;
  enabled: boolean;
  state?: 'disabled';
  reason?: 'history_storage_unavailable';
  from: string;
  to: string;
  feeds: Record<TopOiHistoryFeedKey, TopSpotFeedHistorySnapshot>;
  summary: {
    eventCount: number;
    entryCount: number;
  };
}

export interface AmountsFeedHistoryResponse {
  generatedAt: string;
  enabled: boolean;
  state?: 'disabled';
  reason?: 'history_storage_unavailable';
  from: string;
  to: string;
  feeds: Record<AmountsHistorySourceKey, TopSpotFeedHistorySnapshot>;
  summary: {
    eventCount: number;
    entryCount: number;
  };
}

export interface StorageOperationalHealth {
  state: 'disabled' | 'healthy' | 'degraded' | 'unhealthy';
  reasons: string[];
}

export interface DatabaseHealthStatus {
  enabled: boolean;
  connected: boolean | null;
  lastProbeAt: string | null;
  lastProbeError: string | null;
  migrationVersion: string | null;
  migrationsApplied: number | null;
  migrationsPending: number | null;
  migrationChecksumMismatch: boolean | null;
}

export interface StorageWriterHealth {
  queueDepth: number;
  maxQueueDepth: number;
  failedWrites: number;
  droppedWrites: number;
  retriedWrites: number;
  lastSuccessfulWrite: string | null;
  lastFailureAt: string | null;
  oldestQueuedAt: string | null;
  averageWriteMs: number | null;
}

export interface TableSizeStatus {
  estimatedRows: number;
  totalBytes: number;
}

export interface StartupWarning {
  code: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
}

export type StreamState = 'connecting' | 'open' | 'error' | 'closed';

export interface ExchangeSymbol {
  source: string;
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

export interface ExchangeSymbolSourceSummary {
  source: string;
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

export interface ExchangeSymbolsQuery {
  exchange?: ExchangeKey;
  market?: ExchangeMarket;
  search?: string;
  quoteAsset?: string;
  status?: ExchangeSymbolStatus | 'all';
  limit?: number;
  offset?: number;
}

export interface ExchangeSymbolsResponse {
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

export interface ExchangeSymbolsRefreshResult {
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
