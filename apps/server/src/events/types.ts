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

export type TopListDirection = 'buy' | 'sell';
export type TopListInterval = '5m';
export type TopListMarket = 'spot' | 'derivatives';
export type OiTopDirection = 'gainer' | 'loser';

export type Severity = 'info' | 'warning' | 'critical';

export interface RawCryptoAttackEvent {
  chapter?: unknown;
  category?: unknown;
  texts?: unknown;
  coins?: unknown;
  filters?: unknown;
  pricetrack?: unknown;
  timesend1?: unknown;
  timestamp?: unknown;
  id?: unknown;
  source?: unknown;
  time?: unknown;
  [key: string]: unknown;
}

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
  severity: Severity;
  raw: RawCryptoAttackEvent | unknown;
  endpoint: string;
  entries: ParsedTopEntry[];
  amountMetric: AmountMetric | null;
  parserStatus: 'parsed' | 'parser_needs_sample' | 'not_applicable';
}

export interface FeedSnapshot {
  events: NormalizedEvent[];
  latest: NormalizedEvent | null;
}

export interface DashboardSnapshot {
  generatedAt: string;
  feeds: Record<FeedKey, FeedSnapshot>;
  counters: EventCounters;
  lastEventTime: string | null;
  latency: LatencyStats;
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
}
