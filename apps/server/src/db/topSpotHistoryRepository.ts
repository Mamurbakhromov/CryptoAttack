import type { QueryResult, QueryResultRow } from 'pg';

import type { NormalizedEvent, ParsedTopEntry } from '../events/types.js';
import type { FeedKey } from '../events/types.js';

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

export interface TopSpotHistoryQuery {
  coin: string;
  from: string;
  to: string;
  market: TopSpotHistoryMarket;
  side: TopSpotHistorySide;
}

export interface TopSpotFeedHistoryQuery {
  from: string;
  to: string;
}

export interface TopOiHistoryQuery {
  coin: string;
  from: string;
  to: string;
  side: TopOiHistorySide;
}

export interface AmountsHistoryQuery {
  coin: string;
  from: string;
  to: string;
  market: TopSpotHistoryMarket;
  side: TopSpotHistorySide;
}

export interface TopSpotHistoryHit {
  eventId: string;
  receivedAt: string;
  feedKey: FeedKey;
  rank: number | null;
  coin: string;
  market: string | null;
  direction: ParsedTopEntry['direction'] | null;
  exchange: string | null;
  amountUsd: number | null;
  buyUsd: number | null;
  sellUsd: number | null;
  deltaUsd: number | null;
  buySellRatio: number | null;
  percent: number | null;
  priceUsd: number | null;
  priceChangePercent: number | null;
  oiChange15mPercent: number | null;
  oiChange30mPercent: number | null;
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

export interface TopSpotFeedSnapshot {
  events: NormalizedEvent[];
  latest: NormalizedEvent | null;
}

interface FeedHistoryResponse<TSourceKey extends string> {
  generatedAt: string;
  enabled: boolean;
  state?: 'disabled';
  reason?: 'history_storage_unavailable';
  from: string;
  to: string;
  feeds: Record<TSourceKey, TopSpotFeedSnapshot>;
  summary: {
    eventCount: number;
    entryCount: number;
  };
}

export interface TopSpotFeedHistoryResponse extends FeedHistoryResponse<TopSpotHistoryFeedKey> {}
export interface TopOiFeedHistoryResponse extends FeedHistoryResponse<TopOiHistoryFeedKey> {}
export interface AmountsFeedHistoryResponse extends FeedHistoryResponse<AmountsHistorySourceKey> {}

export interface TopSpotHistoryPool {
  query<T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<T>>;
}

interface HistoryEntryRow extends QueryResultRow {
  event_id: string;
  received_at: Date | string;
  feed_key: FeedKey;
  rank: number | null;
  coin: string;
  market: string | null;
  direction: ParsedTopEntry['direction'] | null;
  exchange: string | null;
  amount_usd: number | string | null;
  buy_usd: number | string | null;
  sell_usd: number | string | null;
  delta_usd: number | string | null;
  buy_sell_ratio: number | string | null;
  percent: number | string | null;
  price_usd: number | string | null;
  price_change_percent: number | string | null;
  oi_change_15m_percent: number | string | null;
  oi_change_30m_percent: number | string | null;
  volume_24h_usd: number | string | null;
  raw_line: string;
}

interface FeedHistoryRow extends QueryResultRow {
  event_id: string;
  event_received_at: Date | string;
  feed_key: FeedKey;
  chapter: string;
  category: string;
  title: string;
  plain_text: string;
  html_text: string;
  coins: string[];
  filters: string[];
  event_timestamp: Date | string;
  source_time_ms: number | string | null;
  latency_ms: number | string | null;
  severity: NormalizedEvent['severity'];
  endpoint: string;
  parser_status: NormalizedEvent['parserStatus'];
  amount_metric: NormalizedEvent['amountMetric'] | string | null;
  rank: number | null;
  coin: string | null;
  pair: string | null;
  exchange: string | null;
  market: string | null;
  direction: ParsedTopEntry['direction'] | null;
  interval_label: string | null;
  amount_usd: number | string | null;
  amount_asset: string | null;
  buy_usd: number | string | null;
  sell_usd: number | string | null;
  delta_usd: number | string | null;
  buy_sell_ratio: number | string | null;
  volume_24h_usd: number | string | null;
  volume_24h_asset: string | null;
  percent: number | string | null;
  price_usd: number | string | null;
  price_change_percent: number | string | null;
  oi_change_15m_percent: number | string | null;
  oi_change_30m_percent: number | string | null;
  followup_price_change_percent: number | string | null;
  total_alerts: number | string | null;
  notified_at: Date | string | null;
  threshold: string | null;
  href: string | null;
  raw_line: string | null;
}

interface HistorySourceDefinition<TSourceKey extends string> {
  sourceKey: TSourceKey;
  feedKey: FeedKey;
  direction?: ParsedTopEntry['direction'];
}

const topSpotHistorySources: Array<HistorySourceDefinition<TopSpotHistoryFeedKey>> = [
  { sourceKey: 'all_spot_top_buy_5m', feedKey: 'all_spot_top_buy_5m' },
  { sourceKey: 'all_spot_top_sell_5m', feedKey: 'all_spot_top_sell_5m' },
  { sourceKey: 'all_derivatives_top_buy_5m', feedKey: 'all_derivatives_top_buy_5m' },
  { sourceKey: 'all_derivatives_top_sell_5m', feedKey: 'all_derivatives_top_sell_5m' }
];

const topOiHistorySources: Array<HistorySourceDefinition<TopOiHistoryFeedKey>> = [
  { sourceKey: 'top_oi_gainers_60m', feedKey: 'top_oi_gainers_60m' },
  { sourceKey: 'top_oi_losers_60m', feedKey: 'top_oi_losers_60m' }
];

const amountsHistorySources: Array<HistorySourceDefinition<AmountsHistorySourceKey>> = [
  { sourceKey: 'spot_buy', feedKey: 'all_spot_per', direction: 'buy' },
  { sourceKey: 'spot_sell', feedKey: 'all_spot_per', direction: 'sell' },
  { sourceKey: 'derivatives_buy', feedKey: 'all_derivatives_per', direction: 'buy' },
  { sourceKey: 'derivatives_sell', feedKey: 'all_derivatives_per', direction: 'sell' }
];

const historyHitSql = `
  select
    ee.event_id,
    ee.received_at,
    ee.feed_key,
    ee.rank,
    upper(ee.coin) as coin,
    ee.market,
    ee.direction,
    ee.exchange,
    ee.amount_usd,
    ee.buy_usd,
    ee.sell_usd,
    ee.delta_usd,
    ee.buy_sell_ratio,
    ee.percent,
    ee.price_usd,
    ee.price_change_percent,
    ee.oi_change_15m_percent,
    ee.oi_change_30m_percent,
    ee.volume_24h_usd,
    ee.raw_line
  from event_entries ee
  where upper(ee.coin) = $1
    and ee.feed_key = $2
    and ee.received_at >= $3
    and ee.received_at < $4
    and ee.direction = coalesce($5::text, ee.direction)
  order by ee.received_at desc, ee.rank nulls last`;

const feedHistorySql = `
  select
    ne.event_id,
    ne.received_at as event_received_at,
    ne.feed_key,
    ne.chapter,
    ne.category,
    ne.title,
    ne.plain_text,
    ne.html_text,
    ne.coins,
    ne.filters,
    ne.event_timestamp,
    ne.source_time_ms,
    ne.latency_ms,
    ne.severity,
    ne.endpoint,
    ne.parser_status,
    ne.amount_metric,
    ee.rank,
    upper(ee.coin) as coin,
    ee.pair,
    ee.exchange,
    ee.market,
    ee.direction,
    ee.interval_label,
    ee.amount_usd,
    ee.amount_asset,
    ee.buy_usd,
    ee.sell_usd,
    ee.delta_usd,
    ee.buy_sell_ratio,
    ee.volume_24h_usd,
    ee.volume_24h_asset,
    ee.percent,
    ee.price_usd,
    ee.price_change_percent,
    ee.oi_change_15m_percent,
    ee.oi_change_30m_percent,
    ee.followup_price_change_percent,
    ee.total_alerts,
    ee.notified_at,
    ee.threshold,
    ee.href,
    ee.raw_line
  from normalized_events ne
  left join event_entries ee
    on ee.event_id = ne.event_id
   and ee.event_received_at = ne.received_at
  where ne.feed_key = any($1::text[])
    and ne.received_at >= $2
    and ne.received_at < $3
  order by ne.received_at desc, ne.event_id, ee.rank nulls last, ee.raw_line`;

export class TopSpotHistoryRepository {
  constructor(private readonly pool: TopSpotHistoryPool) {}

  async getTopSpotFeedHistory(query: TopSpotFeedHistoryQuery): Promise<TopSpotFeedHistoryResponse> {
    const result = await this.pool.query<FeedHistoryRow>(feedHistorySql, [sourceFeedKeys(topSpotHistorySources), query.from, query.to]);
    return feedRowsToHistory(query, result.rows, topSpotHistorySources);
  }

  async getTopOiFeedHistory(query: TopSpotFeedHistoryQuery): Promise<TopOiFeedHistoryResponse> {
    const result = await this.pool.query<FeedHistoryRow>(feedHistorySql, [sourceFeedKeys(topOiHistorySources), query.from, query.to]);
    return feedRowsToHistory(query, result.rows, topOiHistorySources);
  }

  async getAmountsFeedHistory(query: TopSpotFeedHistoryQuery): Promise<AmountsFeedHistoryResponse> {
    const result = await this.pool.query<FeedHistoryRow>(feedHistorySql, [sourceFeedKeys(amountsHistorySources), query.from, query.to]);
    return feedRowsToHistory(query, result.rows, amountsHistorySources);
  }

  async getTopSpotHistory(query: TopSpotHistoryQuery): Promise<TopSpotHistoryResponse> {
    const normalizedQuery = { ...query, coin: normalizeCoin(query.coin) };
    const primaryFeedKey = topSpotFeedKey(normalizedQuery.market, normalizedQuery.side);
    const comparisonFeedKey = topSpotFeedKey(normalizedQuery.market, oppositeSide(normalizedQuery.side));
    const [hits, comparisonHits] = await Promise.all([
      this.readHits(normalizedQuery.coin, primaryFeedKey, normalizedQuery.from, normalizedQuery.to),
      this.readHits(normalizedQuery.coin, comparisonFeedKey, normalizedQuery.from, normalizedQuery.to)
    ]);

    return {
      generatedAt: new Date().toISOString(),
      enabled: true,
      ...normalizedQuery,
      primaryFeedKey,
      comparisonFeedKey,
      hits,
      comparisonHits,
      summary: summarizeHistory(hits, comparisonHits)
    };
  }

  async getTopOiHistory(query: TopOiHistoryQuery): Promise<TopOiHistoryResponse> {
    const normalizedQuery = { ...query, coin: normalizeCoin(query.coin) };
    const primaryFeedKey = topOiFeedKey(normalizedQuery.side);
    const comparisonFeedKey = topOiFeedKey(oppositeOiSide(normalizedQuery.side));
    const [hits, comparisonHits] = await Promise.all([
      this.readHits(normalizedQuery.coin, primaryFeedKey, normalizedQuery.from, normalizedQuery.to),
      this.readHits(normalizedQuery.coin, comparisonFeedKey, normalizedQuery.from, normalizedQuery.to)
    ]);

    return {
      generatedAt: new Date().toISOString(),
      enabled: true,
      ...normalizedQuery,
      primaryFeedKey,
      comparisonFeedKey,
      hits,
      comparisonHits,
      summary: summarizeHistory(hits, comparisonHits)
    };
  }

  async getAmountsHistory(query: AmountsHistoryQuery): Promise<AmountsHistoryResponse> {
    const normalizedQuery = { ...query, coin: normalizeCoin(query.coin) };
    const primarySource = amountsSource(normalizedQuery.market, normalizedQuery.side);
    const comparisonSource = amountsSource(normalizedQuery.market, oppositeSide(normalizedQuery.side));
    const [hits, comparisonHits] = await Promise.all([
      this.readHits(normalizedQuery.coin, primarySource.feedKey, normalizedQuery.from, normalizedQuery.to, primarySource.direction),
      this.readHits(normalizedQuery.coin, comparisonSource.feedKey, normalizedQuery.from, normalizedQuery.to, comparisonSource.direction)
    ]);

    return {
      generatedAt: new Date().toISOString(),
      enabled: true,
      ...normalizedQuery,
      primaryFeedKey: primarySource.sourceKey,
      comparisonFeedKey: comparisonSource.sourceKey,
      hits,
      comparisonHits,
      summary: summarizeHistory(hits, comparisonHits)
    };
  }

  private async readHits(coin: string, feedKey: FeedKey, from: string, to: string, direction: ParsedTopEntry['direction'] | null = null): Promise<TopSpotHistoryHit[]> {
    const result = await this.pool.query<HistoryEntryRow>(historyHitSql, [coin, feedKey, from, to, direction]);
    return result.rows.map(historyRowToHit);
  }
}

export function topSpotFeedKey(market: TopSpotHistoryMarket, side: TopSpotHistorySide): TopSpotHistoryFeedKey {
  if (market === 'spot') return side === 'buy' ? 'all_spot_top_buy_5m' : 'all_spot_top_sell_5m';
  return side === 'buy' ? 'all_derivatives_top_buy_5m' : 'all_derivatives_top_sell_5m';
}

export function topOiFeedKey(side: TopOiHistorySide): TopOiHistoryFeedKey {
  return side === 'gainer' ? 'top_oi_gainers_60m' : 'top_oi_losers_60m';
}

export function amountsSource(market: TopSpotHistoryMarket, side: TopSpotHistorySide): HistorySourceDefinition<AmountsHistorySourceKey> {
  if (market === 'spot') return side === 'buy' ? amountsHistorySources[0]! : amountsHistorySources[1]!;
  return side === 'buy' ? amountsHistorySources[2]! : amountsHistorySources[3]!;
}

export function disabledTopSpotHistoryResponse(query: TopSpotHistoryQuery): TopSpotHistoryResponse {
  const normalizedQuery = { ...query, coin: normalizeCoin(query.coin) };
  return {
    generatedAt: new Date().toISOString(),
    enabled: false,
    state: 'disabled',
    reason: 'history_storage_unavailable',
    ...normalizedQuery,
    primaryFeedKey: topSpotFeedKey(normalizedQuery.market, normalizedQuery.side),
    comparisonFeedKey: topSpotFeedKey(normalizedQuery.market, oppositeSide(normalizedQuery.side)),
    hits: [],
    comparisonHits: [],
    summary: {
      primaryHitCount: 0,
      comparisonHitCount: 0,
      latestPrimaryRatio: null,
      primaryAverage3: null
    }
  };
}

export function disabledTopSpotFeedHistoryResponse(query: TopSpotFeedHistoryQuery): TopSpotFeedHistoryResponse {
  return {
    generatedAt: new Date().toISOString(),
    enabled: false,
    state: 'disabled',
    reason: 'history_storage_unavailable',
    ...query,
    feeds: emptyFeedSnapshots(topSpotHistorySources),
    summary: {
      eventCount: 0,
      entryCount: 0
    }
  };
}

export function disabledTopOiFeedHistoryResponse(query: TopSpotFeedHistoryQuery): TopOiFeedHistoryResponse {
  return {
    generatedAt: new Date().toISOString(),
    enabled: false,
    state: 'disabled',
    reason: 'history_storage_unavailable',
    ...query,
    feeds: emptyFeedSnapshots(topOiHistorySources),
    summary: {
      eventCount: 0,
      entryCount: 0
    }
  };
}

export function disabledAmountsFeedHistoryResponse(query: TopSpotFeedHistoryQuery): AmountsFeedHistoryResponse {
  return {
    generatedAt: new Date().toISOString(),
    enabled: false,
    state: 'disabled',
    reason: 'history_storage_unavailable',
    ...query,
    feeds: emptyFeedSnapshots(amountsHistorySources),
    summary: {
      eventCount: 0,
      entryCount: 0
    }
  };
}

export function disabledTopOiHistoryResponse(query: TopOiHistoryQuery): TopOiHistoryResponse {
  const normalizedQuery = { ...query, coin: normalizeCoin(query.coin) };
  return {
    generatedAt: new Date().toISOString(),
    enabled: false,
    state: 'disabled',
    reason: 'history_storage_unavailable',
    ...normalizedQuery,
    primaryFeedKey: topOiFeedKey(normalizedQuery.side),
    comparisonFeedKey: topOiFeedKey(oppositeOiSide(normalizedQuery.side)),
    hits: [],
    comparisonHits: [],
    summary: {
      primaryHitCount: 0,
      comparisonHitCount: 0,
      latestPrimaryRatio: null,
      primaryAverage3: null
    }
  };
}

export function disabledAmountsHistoryResponse(query: AmountsHistoryQuery): AmountsHistoryResponse {
  const normalizedQuery = { ...query, coin: normalizeCoin(query.coin) };
  const primarySource = amountsSource(normalizedQuery.market, normalizedQuery.side);
  const comparisonSource = amountsSource(normalizedQuery.market, oppositeSide(normalizedQuery.side));
  return {
    generatedAt: new Date().toISOString(),
    enabled: false,
    state: 'disabled',
    reason: 'history_storage_unavailable',
    ...normalizedQuery,
    primaryFeedKey: primarySource.sourceKey,
    comparisonFeedKey: comparisonSource.sourceKey,
    hits: [],
    comparisonHits: [],
    summary: {
      primaryHitCount: 0,
      comparisonHitCount: 0,
      latestPrimaryRatio: null,
      primaryAverage3: null
    }
  };
}

function feedRowsToHistory<TSourceKey extends string>(
  query: TopSpotFeedHistoryQuery,
  rows: FeedHistoryRow[],
  sources: Array<HistorySourceDefinition<TSourceKey>>
): FeedHistoryResponse<TSourceKey> {
  const feeds = emptyFeedSnapshots(sources);
  const eventsByKey = new Map<string, NormalizedEvent>();

  for (const row of rows) {
    const receivedAt = normalizeDbDate(row.event_received_at);
    for (const source of matchingSources(row, sources)) {
      const eventKey = `${source.sourceKey}\0${row.event_id}\0${receivedAt}`;
      let event = eventsByKey.get(eventKey);
      if (!event) {
        event = feedRowToEvent(row, receivedAt);
        eventsByKey.set(eventKey, event);
        feeds[source.sourceKey].events.push(event);
      }
      if (row.raw_line) event.entries.push(feedRowToEntry(row));
    }
  }

  let entryCount = 0;
  for (const source of sources) {
    const snapshot = feeds[source.sourceKey];
    for (const event of snapshot.events) {
      event.entries.sort(compareEntriesByRank);
      entryCount += event.entries.length;
    }
    snapshot.latest = snapshot.events[0] ?? null;
  }

  return {
    generatedAt: new Date().toISOString(),
    enabled: true,
    ...query,
    feeds,
    summary: {
      eventCount: eventsByKey.size,
      entryCount
    }
  };
}

function emptyFeedSnapshots<TSourceKey extends string>(sources: Array<HistorySourceDefinition<TSourceKey>>): Record<TSourceKey, TopSpotFeedSnapshot> {
  return Object.fromEntries(sources.map((source) => [source.sourceKey, { events: [], latest: null }])) as unknown as Record<TSourceKey, TopSpotFeedSnapshot>;
}

function matchingSources<TSourceKey extends string>(row: FeedHistoryRow, sources: Array<HistorySourceDefinition<TSourceKey>>): Array<HistorySourceDefinition<TSourceKey>> {
  return sources.filter((source) => {
    if (source.feedKey !== row.feed_key) return false;
    return source.direction ? source.direction === row.direction : true;
  });
}

function sourceFeedKeys<TSourceKey extends string>(sources: Array<HistorySourceDefinition<TSourceKey>>): FeedKey[] {
  return Array.from(new Set(sources.map((source) => source.feedKey)));
}

function feedRowToEvent(row: FeedHistoryRow, receivedAt: string): NormalizedEvent {
  return {
    id: row.event_id,
    feedKey: row.feed_key,
    chapter: row.chapter,
    category: row.category,
    title: row.title,
    plainText: row.plain_text,
    htmlText: row.html_text,
    coins: row.coins ?? [],
    filters: row.filters ?? [],
    timestamp: normalizeDbDate(row.event_timestamp),
    sourceTime: integerOrNull(row.source_time_ms),
    receivedAt,
    latencyMs: integerOrNull(row.latency_ms),
    severity: row.severity,
    raw: {},
    endpoint: row.endpoint,
    entries: [],
    amountMetric: jsonOrNull(row.amount_metric),
    parserStatus: row.parser_status
  };
}

function feedRowToEntry(row: FeedHistoryRow): ParsedTopEntry {
  return {
    rank: row.rank,
    coin: row.coin ? normalizeCoin(row.coin) : null,
    pair: row.pair,
    amountUsd: numberOrNull(row.amount_usd),
    amountAsset: row.amount_asset,
    buyUsd: numberOrNull(row.buy_usd),
    sellUsd: numberOrNull(row.sell_usd),
    deltaUsd: numberOrNull(row.delta_usd),
    buySellRatio: numberOrNull(row.buy_sell_ratio),
    volume24hUsd: numberOrNull(row.volume_24h_usd),
    volume24hAsset: row.volume_24h_asset,
    percent: numberOrNull(row.percent),
    priceUsd: numberOrNull(row.price_usd),
    priceChangePercent: numberOrNull(row.price_change_percent),
    oiChange15mPercent: numberOrNull(row.oi_change_15m_percent),
    oiChange30mPercent: numberOrNull(row.oi_change_30m_percent),
    followupPriceChangePercent: numberOrNull(row.followup_price_change_percent),
    totalAlerts: integerOrNull(row.total_alerts),
    notifiedAt: row.notified_at ? normalizeDbDate(row.notified_at) : null,
    threshold: row.threshold,
    href: row.href,
    direction: row.direction ?? 'unknown',
    interval: row.interval_label,
    exchange: row.exchange,
    rawLine: row.raw_line ?? ''
  };
}

function compareEntriesByRank(left: ParsedTopEntry, right: ParsedTopEntry): number {
  const rankDelta = (left.rank ?? Number.MAX_SAFE_INTEGER) - (right.rank ?? Number.MAX_SAFE_INTEGER);
  if (rankDelta !== 0) return rankDelta;
  return left.rawLine.localeCompare(right.rawLine);
}

function summarizeHistory(hits: TopSpotHistoryHit[], comparisonHits: TopSpotHistoryHit[]): TopSpotHistorySummary {
  const primaryRatios = hits.map((hit) => hit.buySellRatio).filter(isFiniteNumber);
  const latestPrimaryRatio = primaryRatios[0] ?? null;
  const latestThree = primaryRatios.slice(0, 3);

  return {
    primaryHitCount: hits.length,
    comparisonHitCount: comparisonHits.length,
    latestPrimaryRatio,
    primaryAverage3: latestThree.length ? latestThree.reduce((sum, value) => sum + value, 0) / latestThree.length : null
  };
}

function historyRowToHit(row: HistoryEntryRow): TopSpotHistoryHit {
  return {
    eventId: row.event_id,
    receivedAt: normalizeDbDate(row.received_at),
    feedKey: row.feed_key,
    rank: row.rank,
    coin: normalizeCoin(row.coin),
    market: row.market,
    direction: row.direction,
    exchange: row.exchange,
    amountUsd: numberOrNull(row.amount_usd),
    buyUsd: numberOrNull(row.buy_usd),
    sellUsd: numberOrNull(row.sell_usd),
    deltaUsd: numberOrNull(row.delta_usd),
    buySellRatio: numberOrNull(row.buy_sell_ratio),
    percent: numberOrNull(row.percent),
    priceUsd: numberOrNull(row.price_usd),
    priceChangePercent: numberOrNull(row.price_change_percent),
    oiChange15mPercent: numberOrNull(row.oi_change_15m_percent),
    oiChange30mPercent: numberOrNull(row.oi_change_30m_percent),
    volume24hUsd: numberOrNull(row.volume_24h_usd),
    rawLine: row.raw_line
  };
}

function oppositeSide(side: TopSpotHistorySide): TopSpotHistorySide {
  return side === 'buy' ? 'sell' : 'buy';
}

function oppositeOiSide(side: TopOiHistorySide): TopOiHistorySide {
  return side === 'gainer' ? 'loser' : 'gainer';
}

function normalizeCoin(value: string): string {
  return value.trim().toUpperCase();
}

function isFiniteNumber(value: number | null): value is number {
  return Number.isFinite(value);
}

function numberOrNull(value: number | string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function integerOrNull(value: number | string | null): number | null {
  const parsed = numberOrNull(value);
  return parsed === null ? null : Math.trunc(parsed);
}

function jsonOrNull<T>(value: T | string | null): T | null {
  if (value === null) return null;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function normalizeDbDate(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}
