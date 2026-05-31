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
  workers?: WorkerStatusBundle;
  health?: StorageOperationalHealth;
  database?: DatabaseHealthStatus;
  writer?: StorageWriterHealth;
  scoring?: ScoringHealthStatus;
  marketData?: MarketDataHealthStatus;
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

export interface WorkerStatus {
  enabled: boolean;
  state: 'disabled' | 'running' | 'degraded' | 'stopped';
  running: boolean;
  activeCoinCount?: number;
  intervalMs: number;
  lastRunStartedAt: string | null;
  lastRunCompletedAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
  processed: number;
  written: number;
  skipped: number;
  failed: number;
  averageRunMs: number | null;
}

export interface ScoreWorkerStatus extends WorkerStatus {
  scoreVersion: string;
  windowsMinutes: number[];
  queueDepth: number;
  pendingCoinCount: number;
  lastTriggeredAt: string | null;
  lastTriggerReason: string | null;
  written: number;
  skipped: number;
  writtenEvidence: number;
  latestScoreTs: string | null;
}

export interface WorkerStatusBundle {
  priceCollection: WorkerStatus;
  forwardReturns: WorkerStatus;
  scores: ScoreWorkerStatus;
}

export interface StorageStatusResponse {
  generatedAt: string;
  health?: StorageOperationalHealth;
  database?: DatabaseHealthStatus;
  writer?: StorageWriterHealth;
  scoring?: ScoringHealthStatus;
  marketData?: MarketDataHealthStatus;
  tableSizes?: Record<string, TableSizeStatus>;
  startupWarnings?: StartupWarning[];
  storage: DurableStorageStatus;
  workers: WorkerStatusBundle;
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
  runtime: {
    clearedPendingScoreCoins: number;
    clearedActivePriceCoins: number;
  };
  snapshot: DashboardSnapshot;
  status: ApiStatus;
  storageStatus: StorageStatusResponse;
  scoreSnapshot: ScoreSnapshotSseEvent;
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

export interface ScoringHealthStatus {
  enabled: boolean;
  state: string;
  queueDepth: number;
  pendingCoinCount: number;
  failed: number;
  lastScoreRecompute: string | null;
  latestScoreTs: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
}

export interface LatestPriceTickStatus {
  ts: string | null;
  collectedAt: string | null;
  source: string | null;
  exchange: string | null;
  market: string | null;
  symbol: string | null;
  coin: string | null;
}

export interface ForwardReturnBacklogStatus {
  pending: number;
  due: number;
  missingPrice: number;
  failed: number;
  oldestDueTargetTs: string | null;
}

export interface MarketDataHealthStatus {
  priceCollection: WorkerStatus;
  latestPriceTick: LatestPriceTickStatus;
  forwardReturns: WorkerStatus;
  forwardReturnBacklog: ForwardReturnBacklogStatus;
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

export type ScoreSide = 'bull' | 'bear' | 'net';
export type ScoreEvidenceSide = 'bull' | 'bear' | 'risk' | 'confidence';
export type ScoreMarketRegime = 'bullish' | 'bearish' | 'conflicted' | 'neutral' | 'thin_data';

export interface ScoreEvidenceSummary {
  total: number;
  topRuleKeys: string[];
  feedKeys: string[];
  sides: ScoreEvidenceSide[];
}

export interface ScoreSummary {
  coin: string;
  scoreConfigVersion: string;
  windowMinutes: number;
  latestScoreTs: string;
  bullScore: number;
  bearScore: number;
  netScore: number;
  confidenceScore: number;
  rank: number;
  updatedAt: string;
  dominantSignal: string | null;
  marketRegime: ScoreMarketRegime | null;
  primaryReason: string | null;
  riskTags: string[];
  evidenceSummary: ScoreEvidenceSummary;
  recentScoreDelta: number | null;
  scoreState?: ScoreFlowState | string | null;
  tradeAction?: ScoreTradeAction | string | null;
  componentScores?: ScoreComponentScores | null;
  flowBreakdown?: ScoreFlowBreakdownItem[] | null;
}

export type ScoreFlowState = 'clean_bull' | 'clean_bear' | 'derivatives_only_bull' | 'derivatives_only_bear' | 'hedged_conflict' | 'mixed' | 'thin_liquidity' | 'neutral';
export type ScoreTradeAction = 'LONG_WATCH' | 'SHORT_WATCH' | 'WATCH' | 'AVOID' | 'NEUTRAL';
export type ScoreComponentScores = Record<string, { bull: number; bear: number }>;

export interface ScoreFlowBreakdownItem {
  family?: string;
  side?: string;
  score?: number;
  rawScore?: number;
  maxScore?: number;
  multiplier?: number;
  effectiveHits?: number;
  rawBeforeCap?: number;
  volumeCap?: number;
  activityCap?: number;
  liquidityCap?: number;
  hitPoints?: number;
  subpoints?: Record<string, number | null>;
  thinLiquidity?: boolean;
  newestReceivedAt?: string | null;
  [key: string]: unknown;
}

export interface ScoreFilters {
  minConfidence: number;
  halal: boolean | null;
  exchange: string | null;
  market: string | null;
  updatedSince: string | null;
}

export interface ScoreListQuery {
  side?: ScoreSide;
  limit?: number;
  minConfidence?: number;
  halal?: boolean | null;
  exchange?: ExchangeKey;
  market?: ExchangeMarket;
  updatedSince?: string | null;
  windowMinutes?: number;
  scoreConfigVersion?: string;
}

export interface ScoresListResponse {
  generatedAt: string;
  enabled: boolean;
  kind: 'top' | 'current';
  scoreConfigVersion: string;
  windowMinutes: number;
  side: ScoreSide;
  limit: number;
  filters: ScoreFilters;
  total: number;
  scores: ScoreSummary[];
  state?: 'disabled';
  reason?: string;
}

export interface ScoreDetailResponse {
  generatedAt: string;
  enabled: boolean;
  coin: string;
  scoreConfigVersion: string;
  windowMinutes: number;
  side: ScoreSide;
  limit: number;
  filters: ScoreFilters;
  score: ScoreSummary | null;
}

export interface ScoreTimelinePoint {
  scoreSnapshotId: string;
  ts: string;
  coin: string;
  scoreConfigVersion: string;
  windowMinutes: number;
  bullScore: number;
  bearScore: number;
  netScore: number;
  confidenceScore: number;
  eventCount: number;
  evidenceCount: number;
  dominantSignal: string | null;
  marketRegime: ScoreMarketRegime | null;
  primaryReason: string | null;
  riskTags: string[];
  evidenceSummary: ScoreEvidenceSummary;
  previousNetScore: number | null;
  netScoreDelta: number | null;
  recentScoreDelta: number | null;
  scoreHash: string | null;
  evidenceHash: string | null;
  computedAt: string;
  scoreState?: ScoreFlowState | string | null;
  tradeAction?: ScoreTradeAction | string | null;
  componentScores?: ScoreComponentScores | null;
  flowBreakdown?: ScoreFlowBreakdownItem[] | null;
}

export interface ScoreTimelineResponse {
  generatedAt: string;
  enabled: boolean;
  coin: string;
  scoreConfigVersion: string;
  windowMinutes: number;
  side: ScoreSide;
  limit: number;
  filters: ScoreFilters;
  snapshots: ScoreTimelinePoint[];
}

export interface ScoreEvidenceItem {
  evidenceKey: string;
  scoreSnapshotId: string | null;
  scoreTs: string;
  windowMinutes: number;
  coin: string;
  eventId: string | null;
  eventReceivedAt: string | null;
  entryId: string | null;
  feedKey: string;
  signalKey: string;
  ruleKey: string;
  side: ScoreEvidenceSide;
  contribution: number;
  confidenceImpact: number;
  weight: number;
  decayMultiplier: number;
  value: number | null;
  unit: string | null;
  reason: string;
  source: 'entry' | 'event' | 'aggregate' | string;
  sourceEventIds: string[];
  sourceReceivedAt: string;
  payload: Record<string, unknown>;
}

export interface ScoreEvidenceResponse {
  generatedAt: string;
  enabled: boolean;
  coin: string;
  scoreConfigVersion: string;
  windowMinutes: number;
  side: ScoreSide;
  limit: number;
  filters: ScoreFilters;
  evidence: ScoreEvidenceItem[];
}

export interface ScoreMarketRegimeResponse {
  generatedAt: string;
  enabled: boolean;
  scoreConfigVersion: string;
  windowMinutes: number;
  side: ScoreSide;
  limit: number;
  filters: ScoreFilters;
  sampledCoins: number;
  regime: ScoreMarketRegime;
  bullishCoinCount: number;
  bearishCoinCount: number;
  mixedCount: number;
  quietCount: number;
  averageConfidence: number;
  averageBullScore: number;
  averageBearScore: number;
  averageNetScore: number;
  topSector: string | null;
  topCategory: string | null;
  dataFreshness: {
    latestScoreTs: string | null;
    oldestScoreTs: string | null;
    latestAgeSeconds: number | null;
  };
  leaders: {
    bull: ScoreSummary[];
    bear: ScoreSummary[];
    net: ScoreSummary[];
  };
}

export interface ScoringConfigCurrentResponse {
  generatedAt: string;
  storageBacked: boolean;
  config: {
    scoreConfigVersion: string;
    description: string;
    active: boolean;
    activatedAt: string | null;
    retiredAt: string | null;
    windows: Array<{ minutes: number; halfLifeMinutes: number; maxAgeMinutes: number }>;
    sideSaturation: number;
    materialChange: Record<string, number>;
    confidence: Record<string, number>;
    burst: { threshold: number; maxBonus: number };
    rules: Array<Record<string, unknown>>;
  };
}

export interface ScoreUpdateSseItem {
  coin: string;
  windowMinutes: number;
  ts: string;
  bullScore: number;
  bearScore: number;
  netScore: number;
  confidenceScore: number;
  dominantSignal: string | null;
  marketRegime: ScoreMarketRegime;
  previousNetScore: number | null;
  netScoreDelta: number | null;
  eventCount: number;
  evidenceCount: number;
  scoreHash: string;
  evidenceHash: string;
  scoreState?: ScoreFlowState | string | null;
  tradeAction?: ScoreTradeAction | string | null;
  componentScores?: ScoreComponentScores | null;
  flowBreakdown?: ScoreFlowBreakdownItem[] | null;
}

export interface ScoreUpdateSseEvent {
  generatedAt: string;
  reason: string;
  scoreVersion: string;
  asOf: string;
  processed: number;
  written: number;
  skipped: number;
  failed: number;
  evidenceWritten: number;
  scores: ScoreUpdateSseItem[];
}

export interface ScoreSnapshotSseEvent {
  generatedAt: string;
  scoreVersion: string;
  asOf: string | null;
  windowsMinutes: number[];
  scores: ScoreUpdateSseItem[];
  health: ScoreWorkerStatus;
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
