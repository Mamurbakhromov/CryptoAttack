import { feedKeys, type ApiStatus, type DashboardSnapshot, type FeedKey, type NormalizedEvent, type ParsedTopEntry } from '../types';

export function makeEntry(overrides: Partial<ParsedTopEntry> = {}): ParsedTopEntry {
  return {
    rank: 1,
    coin: 'BTC',
    pair: null,
    amountUsd: null,
    amountAsset: null,
    buyUsd: null,
    sellUsd: null,
    deltaUsd: null,
    buySellRatio: null,
    volume24hUsd: null,
    volume24hAsset: null,
    percent: null,
    priceUsd: null,
    priceChangePercent: null,
    oiChange15mPercent: null,
    oiChange30mPercent: null,
    followupPriceChangePercent: null,
    totalAlerts: null,
    notifiedAt: null,
    href: null,
    threshold: null,
    lastSeen: null,
    direction: 'unknown',
    interval: null,
    exchange: null,
    rawLine: '#BTC',
    ...overrides
  };
}

export function makeEvent(feedKey: FeedKey, overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return {
    id: `${feedKey}-event-1`,
    feedKey,
    chapter: 'test',
    category: 'test',
    title: `Test ${feedKey}`,
    plainText: `Test ${feedKey}`,
    htmlText: `Test ${feedKey}`,
    coins: [],
    filters: [],
    timestamp: '2026-01-01T00:00:00.000Z',
    sourceTime: null,
    receivedAt: '2026-01-01T00:00:00.000Z',
    latencyMs: null,
    severity: 'info',
    raw: {},
    endpoint: 'test',
    entries: [],
    amountMetric: null,
    parserStatus: 'parsed',
    ...overrides
  };
}

export function makeSnapshot(eventsByFeed: Partial<Record<FeedKey, NormalizedEvent[]>> = {}): DashboardSnapshot {
  const feeds = {} as DashboardSnapshot['feeds'];
  const byFeed = {} as DashboardSnapshot['counters']['byFeed'];

  for (const feedKey of feedKeys) {
    const events = eventsByFeed[feedKey] ?? [];
    feeds[feedKey] = {
      events,
      latest: events[0] ?? null
    };
    byFeed[feedKey] = events.length;
  }

  return {
    generatedAt: '2026-01-01T00:00:00.000Z',
    feeds,
    counters: {
      received: Object.values(eventsByFeed).reduce((sum, events) => sum + (events?.length ?? 0), 0),
      stored: Object.values(eventsByFeed).reduce((sum, events) => sum + (events?.length ?? 0), 0),
      deduplicated: 0,
      byFeed
    },
    lastEventTime: '2026-01-01T00:00:00.000Z',
    latency: {
      latestMs: null,
      averageMs: null,
      samples: 0
    }
  };
}

export function makeStatus(overrides: Partial<ApiStatus> = {}): ApiStatus {
  return {
    generatedAt: '2026-01-01T00:00:00.000Z',
    uptimeSeconds: 1,
    mockMode: true,
    authEnabled: false,
    sockets: {},
    counters: makeSnapshot().counters,
    lastEventTime: null,
    lastEventByCategory: {},
    latency: {
      latestMs: null,
      averageMs: null,
      samples: 0
    },
    ...overrides
  };
}
