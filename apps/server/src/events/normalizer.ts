import type { AmountMetric, FeedKey, NormalizedEvent, RawCryptoAttackEvent, Severity, TopListDirection, TopListInterval, TopListMarket } from './types.js';
import {
  extractFirstSafeHref,
  buildAmountMetric,
  extractTitle,
  extractTextParts,
  hasDelistingSignal,
  isPlainObject,
  normalizeCoins,
  normalizeFilters,
  normalizePlainText,
  parseCexTrackEntries,
  parseFlowAlertEntries,
  parseFundingEntries,
  parseOiAlertEntries,
  parseOnchainFlowEntries,
  parseOiTopSignal,
  parseSignalAlertEntries,
  parseTopListSignal,
  parseSourceTime,
  parseTopEntries,
  sanitizeHtmlText,
  stableEventId
} from './parsers.js';

export interface NormalizeOptions {
  endpointName?: string;
  enableDelistings?: boolean;
  enableAnnouncementDelistingFallback?: boolean;
  receivedAtMs?: number;
}

const topListFeedKeys = {
  spot: {
    buy: {
      '5m': 'all_spot_top_buy_5m'
    },
    sell: {
      '5m': 'all_spot_top_sell_5m'
    }
  },
  derivatives: {
    buy: {
      '5m': 'all_derivatives_top_buy_5m'
    },
    sell: {
      '5m': 'all_derivatives_top_sell_5m'
    }
  }
} as const satisfies Record<TopListMarket, Record<TopListDirection, Record<TopListInterval, FeedKey>>>;

const amountFeedKeysByCategory = {
  all_spot_per: 'all_spot_per',
  all_derivatives_per: 'all_derivatives_per'
} as const satisfies Record<string, FeedKey>;

const directFeedKeysByCategory = {
  'signals/pricealerts': 'pricealerts',
  'signals/volalerts': 'volalerts',
  'cex_alerts/flows_alert': 'flows_alert',
  'cex_alerts/cex_track': 'cex_track',
  'market_data/top_funding': 'top_funding',
  'market_data/etf_crypto': 'etf_crypto',
  'onchain/24_all_flows': 'onchain_24_all_flows',
  'onchain/1_all_flows': 'onchain_1_all_flows'
} as const satisfies Record<string, FeedKey>;

const allowedPriceAlertExchangeFilters = new Set(['binance', 'binance_fut', 'bybit', 'bybit_fut']);
const allowedPriceAlertIntervalFilters = new Set(['1_min', '5_min']);
const allowedPriceAlertChangeFilters = new Set(['change2', 'change5', 'change10']);

export function normalizeCryptoAttackEvent(
  rawInput: unknown,
  options: NormalizeOptions = {}
): NormalizedEvent[] {
  const receivedAtMs = options.receivedAtMs ?? Date.now();
  const receivedAt = new Date(receivedAtMs).toISOString();
  const endpoint = options.endpointName ?? 'unknown';

  if (!isPlainObject(rawInput)) {
    return [
      createMalformedEvent({
        rawInput,
        receivedAt,
        receivedAtMs,
        endpoint,
        reason: 'Malformed CryptoAttack event payload'
      })
    ];
  }

  const raw = rawInput as RawCryptoAttackEvent;
  const chapter = normalizeKey(raw.chapter, 'unknown');
  const category = normalizeKey(raw.category, 'unknown');
  const textParts = extractTextParts(raw);
  const plainText = normalizePlainText(textParts);
  const htmlText = sanitizeHtmlText(textParts.length ? textParts : [plainText]);
  const firstSafeHref = extractFirstSafeHref(textParts);
  const filters = normalizeFilters(raw.filters);
  const sourceTime = parseSourceTime(raw);
  const timestamp = normalizeTimestamp(raw.timestamp, sourceTime, receivedAt);
  const latencyMs = sourceTime === null ? null : Math.max(0, receivedAtMs - sourceTime);
  const coins = normalizeCoins(raw.coins, plainText);
  const baseRawId = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : null;
  const baseId =
    baseRawId ?? stableEventId([chapter, category, plainText, raw.timestamp ?? null, raw.time ?? null, raw.timesend1 ?? null]);

  const createEvent = (
    feedKey: FeedKey,
    overrides: Partial<Pick<NormalizedEvent, 'title' | 'severity' | 'entries' | 'amountMetric' | 'parserStatus'>> = {}
  ): NormalizedEvent => ({
    id: `${baseId}:${feedKey}`,
    feedKey,
    chapter,
    category,
    title: overrides.title ?? titleForFeed(feedKey),
    plainText: plainText || 'No text payload',
    htmlText: htmlText || 'No text payload',
    coins,
    filters,
    timestamp,
    sourceTime,
    receivedAt,
    latencyMs,
    severity: overrides.severity ?? severityForFeed(feedKey),
    raw,
    endpoint,
    entries: overrides.entries ?? [],
    amountMetric: overrides.amountMetric ?? null,
    parserStatus: overrides.parserStatus ?? 'not_applicable'
  });

  if (chapter === 'cex_alerts' && category === 'listings') {
    return [createEvent('listings')];
  }

  if (chapter === 'cex_alerts' && category === 'delistings') {
    if (options.enableDelistings ?? true) {
      return [
        createEvent('delistings', {
          title: 'Delisting Alert',
          severity: 'critical'
        })
      ];
    }
    return [createEvent('raw_unclassified', { title: 'Delisting event ignored because delistings are disabled' })];
  }

  const amountFeedKey = chapter === 'cex_alerts' ? amountFeedKeysByCategory[category as keyof typeof amountFeedKeysByCategory] : undefined;
  if (amountFeedKey) {
    const signal = parseTopListSignal(filters, plainText);
    const entries = parseTopEntries(plainText, signal?.direction ?? 'unknown');
    const amountMetric = buildAmountMetric(amountFeedKey, entries, plainText) ?? createParserNeedsSampleAmountMetric(amountFeedKey);
    const parsed = amountMetric.status === 'ok' || entries.length > 0;
    return [
      createEvent(amountFeedKey, {
        title: titleForFeed(amountFeedKey),
        entries,
        amountMetric,
        parserStatus: parsed ? 'parsed' : 'parser_needs_sample'
      })
    ];
  }

  if (
    chapter === 'cex_alerts' &&
    category === 'announcement' &&
    options.enableAnnouncementDelistingFallback === true &&
    hasDelistingSignal(plainText)
  ) {
    return [
      createEvent('delistings', {
        title: 'Delisting Announcement Fallback',
        severity: 'warning'
      })
    ];
  }

  const topMarket = marketForTopCategory(category);
  if (chapter === 'cex_alerts' && topMarket) {
    const signal = parseTopListSignal(filters, plainText);
    if (!signal) {
      return [createEvent('raw_unclassified', { title: `Unclassified ${category} event` })];
    }

    const feedKey = topListFeedKeys[topMarket][signal.direction][signal.interval];
    const entries = parseTopEntries(plainText, signal.direction);
    return [
      createEvent(feedKey, {
        title: titleForTopList(topMarket, signal.direction, signal.interval),
        entries,
        parserStatus: entries.length ? 'parsed' : 'parser_needs_sample'
      })
    ];
  }

  if (chapter === 'market_data' && category === 'top_oi') {
    const signal = parseOiTopSignal(filters, plainText);
    if (!signal) {
      return [createEvent('raw_unclassified', { title: 'Unclassified top_oi event' })];
    }

    const feedKey = signal.direction === 'gainer' ? 'top_oi_gainers_60m' : 'top_oi_losers_60m';
    const entries = parseTopEntries(plainText, signal.direction);
    return [
      createEvent(feedKey, {
        title: signal.direction === 'gainer' ? 'Top OI Gainers 60m' : 'Top OI Losers 60m',
        entries,
        parserStatus: entries.length ? 'parsed' : 'parser_needs_sample'
      })
    ];
  }

  if (chapter === 'signals' && category === 'oi_alerts') {
    const entries = parseOiAlertEntries(plainText);
    return [
      createEvent('oi_alerts', {
        title: extractTitle(plainText, 'OI Alert'),
        severity: 'warning',
        entries,
        parserStatus: entries.length ? 'parsed' : 'parser_needs_sample'
      })
    ];
  }

  const directFeedKey = directFeedKeysByCategory[`${chapter}/${category}` as keyof typeof directFeedKeysByCategory];
  if (directFeedKey) {
    if (directFeedKey === 'pricealerts' && !isAllowedPriceAlert(filters)) return [];
    if (directFeedKey === 'volalerts' && !hasAnyFilter(filters, allowedPriceAlertExchangeFilters)) return [];

    const entries = parseDirectFeedEntries(directFeedKey, {
      plainText,
      filters,
      href: firstSafeHref
    });
    const parserStatus = entries.length ? 'parsed' : 'parser_needs_sample';

    return [
      createEvent(directFeedKey, {
        title: extractTitle(plainText, titleForFeed(directFeedKey)),
        severity: severityForFeed(directFeedKey),
        entries,
        parserStatus
      })
    ];
  }

  return [createEvent('raw_unclassified', { title: 'Raw Unclassified Event' })];
}

function isAllowedPriceAlert(filters: string[]): boolean {
  return (
    hasAnyFilter(filters, allowedPriceAlertExchangeFilters) &&
    hasAnyFilter(filters, allowedPriceAlertIntervalFilters) &&
    hasAnyFilter(filters, allowedPriceAlertChangeFilters)
  );
}

function hasAnyFilter(filters: string[], allowed: Set<string>): boolean {
  return filters.some((filter) => allowed.has(filter));
}

function parseDirectFeedEntries(
  feedKey: FeedKey,
  input: { plainText: string; filters: string[]; href: string | null }
) {
  switch (feedKey) {
    case 'pricealerts':
      return parseSignalAlertEntries(input.plainText, input.filters, input.href, 'pricealerts');
    case 'volalerts':
      return parseSignalAlertEntries(input.plainText, input.filters, input.href, 'volalerts');
    case 'flows_alert':
      return parseFlowAlertEntries(input.plainText, input.href);
    case 'cex_track':
      return parseCexTrackEntries(input.plainText, input.href);
    case 'top_funding':
      return parseFundingEntries(input.plainText, input.filters);
    case 'onchain_24_all_flows':
      return parseOnchainFlowEntries(input.plainText, input.filters, '24h');
    case 'onchain_1_all_flows':
      return parseOnchainFlowEntries(input.plainText, input.filters, '1h');
    default:
      return parseTopEntries(input.plainText, 'unknown');
  }
}

function createParserNeedsSampleAmountMetric(sourceFeedKey: FeedKey): AmountMetric {
  return {
    status: 'parser_needs_sample',
    totalUsd: null,
    sourceFeedKey,
    entryCount: 0,
    message: 'Parser needs sample'
  };
}

function createMalformedEvent(input: {
  rawInput: unknown;
  receivedAt: string;
  receivedAtMs: number;
  endpoint: string;
  reason: string;
}): NormalizedEvent {
  const id = stableEventId(['malformed', input.rawInput, input.receivedAt]);
  return {
    id: `${id}:raw_unclassified`,
    feedKey: 'raw_unclassified',
    chapter: 'unknown',
    category: 'unknown',
    title: 'Malformed Event',
    plainText: input.reason,
    htmlText: input.reason,
    coins: [],
    filters: [],
    timestamp: input.receivedAt,
    sourceTime: null,
    receivedAt: input.receivedAt,
    latencyMs: null,
    severity: 'warning',
    raw: input.rawInput,
    endpoint: input.endpoint,
    entries: [],
    amountMetric: null,
    parserStatus: 'not_applicable'
  };
}

function normalizeKey(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function normalizeTimestamp(rawTimestamp: unknown, sourceTime: number | null, receivedAt: string): string {
  if (typeof rawTimestamp === 'string') {
    const parsed = Date.parse(rawTimestamp);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  if (sourceTime !== null) return new Date(sourceTime).toISOString();
  return receivedAt;
}

function marketForTopCategory(category: string): TopListMarket | null {
  if (category === 'all_spot_top') return 'spot';
  if (category === 'all_derivatives_top') return 'derivatives';
  return null;
}

function titleForTopList(market: TopListMarket, direction: TopListDirection, interval: TopListInterval): string {
  const marketLabel = market === 'spot' ? 'Spot' : 'Derivatives';
  const directionLabel = direction === 'buy' ? 'Buyers' : 'Sellers';
  return `All ${marketLabel} Top ${directionLabel} ${interval}`;
}

function titleForFeed(feedKey: FeedKey): string {
  switch (feedKey) {
    case 'listings':
      return 'Listing Alert';
    case 'delistings':
      return 'Delisting Alert';
    case 'all_derivatives_top_buy_5m':
      return 'All Derivatives Top Buyers 5m';
    case 'all_derivatives_top_sell_5m':
      return 'All Derivatives Top Sellers 5m';
    case 'all_spot_top_buy_5m':
      return 'All Spot Top Buyers 5m';
    case 'all_spot_top_sell_5m':
      return 'All Spot Top Sellers 5m';
    case 'all_spot_per':
      return 'All Spot Amount';
    case 'all_derivatives_per':
      return 'All Derivatives Amount';
    case 'top_oi_gainers_60m':
      return 'Top OI Gainers 60m';
    case 'top_oi_losers_60m':
      return 'Top OI Losers 60m';
    case 'oi_alerts':
      return 'OI Alert';
    case 'pricealerts':
      return 'Price Alert';
    case 'pricealerts2':
      return 'Price Alert 2';
    case 'price_alerts':
      return 'Price Alerts';
    case 'volalerts':
      return 'Volume Alert';
    case 'flows_alert':
      return 'CEX Flow Alert';
    case 'cex_track':
      return 'CEX Track';
    case 'top_funding':
      return 'Top Funding';
    case 'etf_crypto':
      return 'ETF Crypto';
    case 'onchain_24_all_flows':
      return 'Onchain 24h Flows';
    case 'onchain_1_all_flows':
      return 'Onchain 1h Flows';
    case 'raw_unclassified':
      return 'Raw Unclassified Event';
  }
}

function severityForFeed(feedKey: FeedKey): Severity {
  switch (feedKey) {
    case 'listings':
    case 'delistings':
    case 'oi_alerts':
    case 'pricealerts':
    case 'pricealerts2':
    case 'price_alerts':
    case 'volalerts':
    case 'flows_alert':
      return 'critical';
    case 'cex_track':
    case 'etf_crypto':
      return 'warning';
    case 'onchain_24_all_flows':
    case 'onchain_1_all_flows':
      return 'info';
    case 'raw_unclassified':
      return 'warning';
    default:
      return 'info';
  }
}
