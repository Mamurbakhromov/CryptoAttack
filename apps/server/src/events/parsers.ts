import { createHash } from 'node:crypto';

import type { AmountMetric, FeedKey, OiTopDirection, ParsedTopEntry, RawCryptoAttackEvent, TopListDirection, TopListInterval } from './types.js';

const BUY_RE = /\b(buy|buys|bought|buying|purchase|purchases)\b|покупа(?:ют|ет|ть|ли)|покупк(?:а|и)/i;
const SELL_RE = /\b(sell|sells|sold|selling)\b|прода(?:ют|ет|вать|ли)|продаж(?:а|и)/i;
const FIVE_MIN_RE = /\b(?:5[\s_-]*(?:m|min|mins|minute|minutes))\b|5\s*минут/i;
const SIXTY_MIN_RE = /\b(?:60[\s_-]*(?:m|min|mins|minute|minutes)|1\s*h(?:our)?)\b|60\s*минут/i;
const GAINER_RE = /\b(gainer|gainers|growth|increase|increased)\b|\bрост\b|вырос|раст(?:ет|ут|и)/i;
const LOSER_RE = /\b(loser|losers|decrease|decreased)\b|падени|падает/i;
const DELISTING_RE = /\b(delist|delisting|delisted|remove trading|trading removal)\b|делист/i;

const COMMON_WORDS = new Set([
  'ALL',
  'AMOUNT',
  'BINANCE',
  'BINGX',
  'BITGET',
  'BUY',
  'BUYING',
  'BYBIT',
  'CEX',
  'CHANGE',
  'COIN',
  'COINS',
  'DERIVATIVES',
  'EXCHANGE',
  'GAINERS',
  'GROWTH',
  'KUCOIN',
  'LAST',
  'MIN',
  'MINUTES',
  'OKX',
  'OPEN',
  'OI',
  'PERP',
  'SELL',
  'SELLING',
  'SPOT',
  'TOP',
  'USD',
  'USDC',
  'USDT'
]);

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function extractTextParts(raw: RawCryptoAttackEvent | unknown): string[] {
  if (!isPlainObject(raw)) return [];
  const { texts } = raw;
  const parts = Array.isArray(texts) ? texts : [texts];
  return parts.filter((part): part is string => typeof part === 'string' && part.trim().length > 0);
}

export function stripHtml(value: string): string {
  return decodeProviderEscapes(decodeHtmlEntities(value))
    .replace(/<a\s+[^>]*href=["'][^"']+["'][^>]*>(.*?)<\/a>/gis, '$1')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

export const htmlToPlainText = stripHtml;

export function sanitizeHtmlText(parts: string[]): string {
  const tokens: string[] = [];
  const joined = parts.join('<br />');
  const withTokens = joined.replace(
    /<a\s+[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gis,
    (_match, href: string, label: string) => {
      const safeHref = sanitizeUrl(href);
      const safeLabel = escapeHtml(stripHtml(label));
      if (!safeHref) return safeLabel;
      const token = `__CRYPTOATTACK_SAFE_LINK_${tokens.length}__`;
      tokens.push(
        `<a href="${escapeHtml(safeHref)}" target="_blank" rel="noreferrer noopener">${safeLabel}</a>`
      );
      return token;
    }
  );

  let safe = escapeHtml(stripHtml(withTokens)).replace(/\n/g, '<br />');
  tokens.forEach((link, index) => {
    safe = safe.replace(`__CRYPTOATTACK_SAFE_LINK_${index}__`, link);
  });
  return safe;
}

export function extractFirstSafeHref(parts: string[]): string | null {
  const joined = parts.join(' ');
  const match = joined.match(/<a\s+[^>]*href=["']([^"']+)["']/i);
  if (!match?.[1]) return null;
  return sanitizeUrl(match[1]);
}

export function normalizePlainText(parts: string[]): string {
  return parts.map(stripHtml).filter(Boolean).join('\n').trim();
}

export function extractTitle(plainText: string, fallback = 'CryptoAttack Event'): string {
  const firstLine = plainText.split('\n').map((line) => line.trim()).find(Boolean);
  if (!firstLine) return fallback;
  return firstLine.length > 120 ? `${firstLine.slice(0, 117)}...` : firstLine;
}

export function normalizeCoins(rawCoins: unknown, plainText: string): string[] {
  const fromPayload = Array.isArray(rawCoins)
    ? rawCoins
    : typeof rawCoins === 'string'
      ? [rawCoins]
      : [];

  const coins = new Set<string>();
  for (const coin of fromPayload) {
    const normalized = normalizeCoin(String(coin), { allowSingleCharacter: true, allowCommonWords: true });
    if (normalized) coins.add(normalized);
  }

  for (const entry of parseOiAlertEntries(plainText)) {
    if (entry.coin) coins.add(entry.coin);
  }

  for (const entry of parseTopEntries(plainText, 'unknown')) {
    if (entry.coin) coins.add(entry.coin);
  }

  return [...coins].slice(0, 24);
}

export function normalizeFilters(rawFilters: unknown): string[] {
  if (!Array.isArray(rawFilters)) return [];
  return rawFilters
    .filter((filter): filter is string | number | boolean => ['string', 'number', 'boolean'].includes(typeof filter))
    .map((filter) => String(filter).trim().toLowerCase())
    .filter(Boolean);
}

export function parseSourceTime(raw: RawCryptoAttackEvent): number | null {
  const numericCandidates = [raw.time, raw.timesend1];
  for (const candidate of numericCandidates) {
    const parsed = Number(candidate);
    if (Number.isFinite(parsed) && parsed > 0) return normalizeEpochMs(parsed);
  }

  if (typeof raw.timestamp === 'string') {
    const parsed = Date.parse(raw.timestamp);
    if (Number.isFinite(parsed)) return parsed;
  }

  return null;
}

export function stableEventId(parts: unknown[]): string {
  const hash = createHash('sha256');
  hash.update(JSON.stringify(parts));
  return `generated_${hash.digest('hex').slice(0, 24)}`;
}

export function isBuy5mTopEvent(filters: string[], plainText: string): boolean {
  const signal = parseTopListSignal(filters, plainText);
  return signal?.direction === 'buy' && signal.interval === '5m';
}

export const hasBuyFiveMinuteSignal = isBuy5mTopEvent;

export function parseTopListSignal(
  filters: string[],
  plainText: string
): { direction: TopListDirection; interval: TopListInterval } | null {
  const filterText = filters.join(' ');
  const titleLine = firstNonEmptyLine(plainText);
  const direction = parseTopDirection(filterText) ?? parseTopDirection(titleLine);
  const interval = parseTopInterval(filterText) ?? parseTopInterval(titleLine);

  if (!direction || !interval) return null;
  return { direction, interval };
}

export function isOiGainerEvent(filters: string[], plainText: string): boolean {
  return parseOiTopSignal(filters, plainText)?.direction === 'gainer';
}

export const hasOiGainerSignal = isOiGainerEvent;

export function parseOiTopSignal(
  filters: string[],
  plainText: string
): { direction: OiTopDirection; interval: '60m' } | null {
  const filterText = filters.join(' ');
  const titleLine = firstNonEmptyLine(plainText);
  const direction = parseOiDirection(filterText) ?? parseOiDirection(titleLine);
  if (!direction || !hasSixtyMinuteOiSignal(filterText, titleLine)) return null;
  return { direction, interval: '60m' };
}

export function hasDelistingSignal(plainText: string): boolean {
  return DELISTING_RE.test(plainText);
}

export function parseTopEntries(
  plainText: string,
  preferredDirection: ParsedTopEntry['direction'] = 'unknown'
): ParsedTopEntry[] {
  return parseRankedRows(plainText, preferredDirection);
}

export function parseOiAlertEntries(plainText: string): ParsedTopEntry[] {
  if (!isOiAlertText(plainText)) return [];

  const lines = plainText.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const coinExchangeLine = lines.find((line) => /(?:^|\s)#[A-Z0-9]{1,12}\b/i.test(line) && parseExchange(line));
  const coin = coinExchangeLine ? parseStandaloneCoin(coinExchangeLine) : null;
  const exchange = coinExchangeLine ? parseExchange(coinExchangeLine) : null;
  if (!coin) return [];

  const followupLine = lines.find((line) => /price change after notification/i.test(line)) ?? '';
  const followup = parseOiAlertFollowup(followupLine);
  const oi15m = parseLabeledPercent(plainText, /\bOI\s+Change\s*\(\s*15\s*m\s*\)\s*:/i);
  const oi30m = parseLabeledPercent(plainText, /\bOI\s+Change\s*\(\s*30\s*m\s*\)\s*:/i);
  const genericPercent = parsePercent(coinExchangeLine ?? plainText);
  const priceUsd = followup.priceUsd ?? parseOiAlertPrice(plainText);
  const totalAlerts = parseTotalAlerts(plainText);
  const notifiedAt = parseProviderUtcTimestamp(plainText);
  const percent = oi30m ?? oi15m ?? genericPercent ?? followup.priceChangePercent;

  return [
    {
      rank: null,
      coin,
      pair: null,
      amountUsd: null,
      buyUsd: null,
      sellUsd: null,
      deltaUsd: null,
      buySellRatio: null,
      volume24hUsd: null,
      percent,
      priceUsd,
      priceChangePercent: followup.priceChangePercent,
      oiChange15mPercent: oi15m,
      oiChange30mPercent: oi30m,
      followupPriceChangePercent: followup.priceChangePercent,
      totalAlerts,
      notifiedAt,
      direction: 'unknown',
      interval: oi30m !== null ? '30m' : oi15m !== null ? '15m' : null,
      exchange,
      rawLine: lines.join(' ')
    }
  ];
}

export function parseSignalAlertEntries(
  plainText: string,
  filters: string[],
  href: string | null,
  category: 'pricealerts' | 'volalerts'
): ParsedTopEntry[] {
  const text = plainText.replace(/\s+/g, ' ').trim();
  const threshold = filters.find((filter) => /^change\d+$/i.test(filter)) ?? null;

  if (category === 'pricealerts') {
    const match = text.match(
      /#([^\s#]{1,24})\s+\$?\s*([0-9][0-9.,]*)\s+([+-]?\d+(?:[.,]\d+)?)%\s+\((\d+)\s*min\)\s+Vol\s+24h:\s*\$?\s*([0-9][0-9.,]*)\s*([KMB])?\s+\(([+-]?[0-9][0-9.,]*)\s*([KMB])?\)\s+(.+?)\s+#PriceAlerts\b/i
    );
    if (!match?.[1] || !match[2] || !match[3] || !match[4] || !match[5] || !match[9]) return [];

    const coin = normalizeCoin(match[1], { allowSingleCharacter: true, allowCommonWords: true });
    if (!coin) return [];

    const priceUsd = parseLocaleNumber(match[2]);
    const signalPercent = parseSignedPercent(match[3]);
    const volume24hUsd = parseAmountWithOptionalSuffix(match[5], match[6]);
    const alertVolume = match[7] ? parseAmountWithOptionalSuffix(match[7], match[8]) : null;

    return [
      {
        rank: 1,
        coin,
        pair: null,
        amountUsd: alertVolume,
        amountAsset: 'USD',
        buyUsd: null,
        sellUsd: null,
        deltaUsd: null,
        buySellRatio: null,
        volume24hUsd,
        volume24hAsset: 'USD',
        percent: signalPercent,
        priceUsd: Number.isFinite(priceUsd) ? priceUsd : null,
        priceChangePercent: signalPercent,
        href,
        threshold,
        direction: 'unknown',
        interval: `${match[4]}m`,
        exchange: normalizeHumanLabel(match[9]),
        rawLine: text
      }
    ];
  }

  const match = text.match(
    /#([^\s#]{1,24})\s+\$?\s*([0-9][0-9.,]*)\s+([+-]?\d+(?:[.,]\d+)?)%\s+Vol\s+24h:\s*\$?\s*([0-9][0-9.,]*)\s*([KMB])?\s+\(([+-]?[0-9][0-9.,]*)\s*([KMB])?\)\s+([+-]?\d+(?:[.,]\d+)?)%\s+\((\d+)\s*min\)\s+(.+?)\s+#VolAlerts\b/i
  );
  if (!match?.[1] || !match[2] || !match[3] || !match[4] || !match[8] || !match[9] || !match[10]) return [];

  const coin = normalizeCoin(match[1], { allowSingleCharacter: true, allowCommonWords: true });
  if (!coin) return [];

  const priceUsd = parseLocaleNumber(match[2]);
  const priceChangePercent = parseSignedPercent(match[3]);
  const volume24hUsd = parseAmountWithOptionalSuffix(match[4], match[5]);
  const alertVolume = match[6] ? parseAmountWithOptionalSuffix(match[6], match[7]) : null;
  const signalPercent = parseSignedPercent(match[8]);

  return [
    {
      rank: 1,
      coin,
      pair: null,
      amountUsd: alertVolume,
      amountAsset: 'USD',
      buyUsd: null,
      sellUsd: null,
      deltaUsd: null,
      buySellRatio: null,
      volume24hUsd,
      volume24hAsset: 'USD',
      percent: signalPercent,
      priceUsd: Number.isFinite(priceUsd) ? priceUsd : null,
      priceChangePercent,
      href,
      threshold,
      direction: 'unknown',
      interval: `${match[9]}m`,
      exchange: normalizeHumanLabel(match[10]),
      rawLine: text
    }
  ];
}

export function parseFlowAlertEntries(plainText: string, href: string | null): ParsedTopEntry[] {
  const line = plainText
    .split(/\n+/)
    .map((value) => value.trim())
    .find((value) => value.startsWith('#'));
  if (!line) return [];

  const match = line.match(/^#([^\s#]{1,24})\s+(.+?)\s*:\s*\$?\s*([0-9][0-9.,]*)\s*([KMB])?\s+(Inflow|Outflow)\b/i);
  if (!match?.[1] || !match[2] || !match[3] || !match[5]) return [];

  const coin = normalizeCoin(match[1], { allowSingleCharacter: true, allowCommonWords: true });
  if (!coin) return [];

  return [
    {
      rank: 1,
      coin,
      pair: null,
      amountUsd: parseAmountWithOptionalSuffix(match[3], match[4]),
      amountAsset: 'USD',
      buyUsd: null,
      sellUsd: null,
      deltaUsd: null,
      buySellRatio: null,
      volume24hUsd: null,
      volume24hAsset: null,
      percent: null,
      priceUsd: null,
      priceChangePercent: null,
      href,
      threshold: null,
      direction: match[5].toLowerCase() === 'inflow' ? 'inflow' : 'outflow',
      interval: null,
      exchange: normalizeHumanLabel(match[2]),
      rawLine: line
    }
  ];
}

export function parseCexTrackEntries(plainText: string, href: string | null): ParsedTopEntry[] {
  const lines = plainText.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const headline = lines[0] ?? '';
  const headlineMatch = headline.match(
    /#([^\s#]{1,16})\s+(buying|selling|activity)\b.*?([0-9][0-9.,]*)\s*([KMB])?\s+([A-Z0-9]+)\s+in\s+(.+?)\s+\(([+-]?\d+(?:[.,]\d+)?)%\)\s+on\s+(.+)$/i
  );
  if (!headlineMatch?.[1] || !headlineMatch[2] || !headlineMatch[3] || !headlineMatch[5] || !headlineMatch[6] || !headlineMatch[7] || !headlineMatch[8]) {
    return [];
  }

  const coin = normalizeCoin(headlineMatch[1], { allowSingleCharacter: true, allowCommonWords: true });
  if (!coin) return [];

  const action = normalizeTrackAction(headlineMatch[2]);
  const priceLine = parseTrackPriceLine(lines.find((line) => /^P\s*:/i.test(line)) ?? '');
  const volumeLine = parseTrackVolumeLine(lines.find((line) => /^Vol\s+24h\s*:/i.test(line)) ?? '');

  return [
    {
      rank: 1,
      coin,
      pair: null,
      amountUsd: parseAmountWithOptionalSuffix(headlineMatch[3], headlineMatch[4]),
      amountAsset: headlineMatch[5],
      buyUsd: null,
      sellUsd: null,
      deltaUsd: null,
      buySellRatio: null,
      volume24hUsd: volumeLine.value,
      volume24hAsset: volumeLine.asset,
      percent: parseSignedPercent(headlineMatch[7]),
      priceUsd: priceLine.price,
      priceChangePercent: priceLine.priceChangePercent,
      href,
      threshold: null,
      lastSeen: parseTrackLastSeen(lines.find((line) => /^Last\s+/i.test(line)) ?? ''),
      direction: action,
      interval: headlineMatch[6].trim(),
      exchange: normalizeHumanLabel(headlineMatch[8]),
      rawLine: headline
    }
  ];
}

export function parseFundingEntries(plainText: string, filters: string[]): ParsedTopEntry[] {
  const interval = filters.find((filter) => ['30_min', '4_h', '12_h'].includes(filter)) ?? null;
  const rows: ParsedTopEntry[] = [];

  for (const line of plainText.split(/\n+/).map((value) => value.trim()).filter((value) => value.startsWith('#'))) {
    const match = line.match(/^#([^\s#]{1,24})\s+(.+?)\s*:\s*([+-]?\d+(?:[.,]\d+)?)%\s*$/i);
    if (!match?.[1] || !match[2] || !match[3]) continue;

    const coin = normalizeCoin(match[1], { allowSingleCharacter: true, allowCommonWords: true });
    if (!coin) continue;

    rows.push({
      rank: rows.length + 1,
      coin,
      pair: null,
      amountUsd: null,
      amountAsset: null,
      buyUsd: null,
      sellUsd: null,
      deltaUsd: null,
      buySellRatio: null,
      volume24hUsd: null,
      volume24hAsset: null,
      percent: parseSignedPercent(match[3]),
      priceUsd: null,
      priceChangePercent: null,
      href: null,
      threshold: null,
      direction: 'unknown',
      interval,
      exchange: normalizeHumanLabel(match[2]),
      rawLine: line
    });
  }

  return rows;
}

export function parseOnchainFlowEntries(
  plainText: string,
  filters: string[],
  window: '24h' | '1h'
): ParsedTopEntry[] {
  const direction = parseOnchainDirection(filters, plainText);
  if (!direction) return [];

  const rows: ParsedTopEntry[] = [];
  for (const line of plainText.split(/\n+/).map((value) => value.trim()).filter((value) => value.startsWith('#'))) {
    const match = line.match(/^#([^\s#]{1,24})\s*:\s*\$?\s*([0-9][0-9.,]*)\s*([KMB])?\b/i);
    if (!match?.[1] || !match[2]) continue;

    const coin = normalizeCoin(match[1], { allowSingleCharacter: true, allowCommonWords: true });
    if (!coin) continue;

    rows.push({
      rank: rows.length + 1,
      coin,
      pair: null,
      amountUsd: parseAmountWithOptionalSuffix(match[2], match[3]),
      amountAsset: 'USD',
      buyUsd: null,
      sellUsd: null,
      deltaUsd: null,
      buySellRatio: null,
      volume24hUsd: null,
      volume24hAsset: null,
      percent: null,
      priceUsd: null,
      priceChangePercent: null,
      href: null,
      threshold: null,
      direction,
      interval: window,
      exchange: null,
      rawLine: line
    });
  }

  return rows;
}

export function parseRankedRows(
  plainText: string,
  preferredDirection: ParsedTopEntry['direction'] = 'unknown'
): ParsedTopEntry[] {
  const lines = mergeContinuationRows(splitPossibleRows(plainText));
  const entries: ParsedTopEntry[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length < 3) continue;

    const rank = parseRank(trimmed);
    const pair = parsePair(trimmed);
    const coin = pair?.coin ?? parseStandaloneCoin(trimmed);
    const direction = inferDirection(trimmed, preferredDirection);
    const buySellAmounts = parseBuySellAmounts(trimmed);
    const deltaUsd = parseDeltaUsdAmount(trimmed, direction, buySellAmounts);
    const amountUsd = parseDirectionalAmount(trimmed, direction, buySellAmounts);
    const percent = parsePercent(trimmed);
    const hasRankOrMetric = rank !== null || amountUsd !== null || percent !== null;

    if (!coin) continue;
    if (!hasRankOrMetric) continue;

    entries.push({
      rank,
      coin,
      pair: pair?.pair ?? null,
      amountUsd,
      buyUsd: buySellAmounts.buy,
      sellUsd: buySellAmounts.sell,
      deltaUsd,
      buySellRatio: parseBuySellRatio(buySellAmounts),
      volume24hUsd: parseVolume24hUsd(trimmed),
      percent,
      priceUsd: parseOiPriceUsd(trimmed),
      priceChangePercent: parseOiPriceChangePercent(trimmed),
      direction,
      interval: parseTopInterval(trimmed),
      exchange: parseExchange(trimmed),
      rawLine: trimmed
    });

    if (entries.length >= 10) break;
  }

  return entries;
}

function mergeContinuationRows(lines: string[]): string[] {
  const rows: string[] = [];
  for (const line of lines) {
    if (rows.length && isContinuationRow(line)) {
      rows[rows.length - 1] = `${rows[rows.length - 1]} ${line}`;
      continue;
    }
    rows.push(line);
  }
  return rows;
}

function isContinuationRow(line: string): boolean {
  if (parsePair(line) || parseStandaloneCoin(line)) return false;
  return parseUsdAmount(line) !== null || parsePercent(line) !== null || /\b(delta|vol24)\b/i.test(line);
}

export function buildAmountMetric(sourceFeedKey: FeedKey, entries: ParsedTopEntry[], plainText = ''): AmountMetric | null {
  const totalUsd = parseTotalUsdAmount(plainText, entries);
  if (totalUsd === null) return null;

  return {
    status: 'ok',
    totalUsd,
    sourceFeedKey,
    entryCount: entries.filter((entry) => typeof entry.amountUsd === 'number' && entry.amountUsd > 0).length,
    message: 'Calculated from parsed total or ranked entries'
  };
}

function splitPossibleRows(plainText: string): string[] {
  return plainText
    .replace(/%0A/gi, '\n')
    .replace(/\s+(?=(?:#?\d{1,2}[).:-]|#\d{1,2}\s+)\s*[A-Z0-9]{2,16})/g, '\n')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseRank(line: string): number | null {
  const match = line.match(/^#?\s*(\d{1,2})[).:-]?\s+/);
  if (!match?.[1]) return null;
  const rank = Number(match[1]);
  return Number.isInteger(rank) ? rank : null;
}

function parsePair(line: string): { coin: string; pair: string } | null {
  const pairMatch = line.match(/\b([A-Z][A-Z0-9]{1,12})(?:[\/-]?(USDT|USDC|USD|PERP))\b/);
  if (!pairMatch?.[1] || !pairMatch[2]) return null;
  const coin = normalizeCoin(pairMatch[1]);
  if (!coin) return null;
  return { coin, pair: `${pairMatch[1]}${pairMatch[2]}` };
}

function parseStandaloneCoin(line: string): string | null {
  const withoutRank = line.replace(/^#?\s*\d{1,2}[).:-]?\s+/, '');
  const hashtagMatch = withoutRank.match(/(?:^|\s)[#$]([A-Z][A-Z0-9]{0,11})\b/);
  if (hashtagMatch?.[1]) {
    const coin = normalizeCoin(hashtagMatch[1], { allowSingleCharacter: true, allowCommonWords: true });
    if (coin) return coin;
  }

  const matches = withoutRank.match(/\b[A-Z][A-Z0-9]{1,11}\b/g) ?? [];
  for (const candidate of matches) {
    const coin = normalizeCoin(candidate);
    if (coin) return coin;
  }
  return null;
}

export function parseUsdAmount(line: string): number | null {
  const patterns = [
    /\$\s*([0-9][0-9.,]*)\s*([kmb])?\b/i,
    /\b([0-9][0-9.,]*)\s*([kmb])?\s*(?:usd|usdt|usdc)\b/i,
    /\b([0-9][0-9.,]*)\s*([KMB])\b/
  ];

  for (const pattern of patterns) {
    const match = line.match(pattern);
    if (!match?.[1]) continue;
    const value = parseLocaleNumber(match[1]);
    if (!Number.isFinite(value)) continue;
    return value * multiplier(match[2]);
  }
  return null;
}

function parseBuySellAmounts(line: string): { buy: number | null; sell: number | null } {
  return {
    buy: parseLabeledUsdAmount(line, 'buy'),
    sell: parseLabeledUsdAmount(line, 'sell')
  };
}

function parseLabeledUsdAmount(line: string, label: 'buy' | 'sell' | 'delta'): number | null {
  const match = line.match(new RegExp(`\\b${label}\\w*\\s*:?\\s*\\$?\\s*([0-9][0-9.,]*)\\s*([kmb])?\\b`, 'i'));
  if (!match?.[1]) return null;
  const value = parseLocaleNumber(match[1]);
  if (!Number.isFinite(value)) return null;
  return value * multiplier(match[2]);
}

function parseDirectionalAmount(
  line: string,
  direction: ParsedTopEntry['direction'],
  amounts: { buy: number | null; sell: number | null }
): number | null {
  if (direction === 'buy' && amounts.buy !== null) return amounts.buy;
  if (direction === 'sell' && amounts.sell !== null) return amounts.sell;
  return parseUsdAmount(line);
}

function parseDeltaUsdAmount(
  line: string,
  direction: ParsedTopEntry['direction'],
  amounts: { buy: number | null; sell: number | null }
): number | null {
  const explicitDelta = parseLabeledUsdAmount(line, 'delta');
  if (explicitDelta !== null) return explicitDelta;
  if (amounts.buy === null || amounts.sell === null) return null;
  if (direction === 'buy') return amounts.buy - amounts.sell;
  if (direction === 'sell') return amounts.sell - amounts.buy;
  return Math.abs(amounts.buy - amounts.sell);
}

function parseBuySellRatio(amounts: { buy: number | null; sell: number | null }): number | null {
  if (amounts.buy === null || amounts.sell === null || amounts.sell <= 0) return null;
  return amounts.buy / amounts.sell;
}

function parseVolume24hUsd(line: string): number | null {
  const match = line.match(/\bVol24\s*:\s*\$?\s*([0-9][0-9.,]*)\s*([kmb])?\b/i);
  if (!match?.[1]) return null;
  const value = parseLocaleNumber(match[1]);
  if (!Number.isFinite(value)) return null;
  return value * multiplier(match[2]);
}

function parseTrackPriceLine(line: string): { price: number | null; priceChangePercent: number | null } {
  const match = line.match(/P\s*:\s*([0-9][0-9.,]*)\s*.*?\(([+-]?\d+(?:[.,]\d+)?)%\)/i);
  return {
    price: match?.[1] ? parseLocaleNumber(match[1]) : null,
    priceChangePercent: match?.[2] ? parseSignedPercent(match[2]) : null
  };
}

function parseTrackVolumeLine(line: string): { value: number | null; asset: string | null } {
  const match = line.match(/Vol\s+24h\s*:\s*\$?\s*([0-9][0-9.,]*)\s*([KMB])?\s+([A-Z0-9]+)/i);
  return {
    value: match?.[1] ? parseAmountWithOptionalSuffix(match[1], match[2]) : null,
    asset: match?.[3] ?? null
  };
}

function parseTrackLastSeen(line: string): string | null {
  const match = line.match(/Last\s+(.+?)\s+#CEXTrack/i);
  return match?.[1]?.trim() ?? null;
}

function normalizeTrackAction(value: string): ParsedTopEntry['direction'] {
  if (/buying/i.test(value)) return 'buy';
  if (/selling/i.test(value)) return 'sell';
  if (/activity/i.test(value)) return 'activity';
  return 'unknown';
}

function parseOnchainDirection(filters: string[], plainText: string): Extract<ParsedTopEntry['direction'], 'inflow' | 'outflow'> | null {
  const filterText = filters.join(' ').toLowerCase();
  if (filterText.includes('inflows')) return 'inflow';
  if (filterText.includes('outflows')) return 'outflow';

  const normalized = plainText.toLowerCase();
  if (normalized.includes('inflows in the past')) return 'inflow';
  if (normalized.includes('outflows in the past')) return 'outflow';
  return null;
}

function parseAmountWithOptionalSuffix(value: string, suffix: string | undefined): number | null {
  const parsed = parseLocaleNumber(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed * multiplier(suffix);
}

function parseSignedPercent(value: string): number | null {
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeHumanLabel(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function parseOiPriceUsd(line: string): number | null {
  const match = line.match(/\bPrice\s*:\s*\$?\s*([0-9][0-9.,]*)\b/i);
  if (!match?.[1]) return null;
  const value = parseLocaleNumber(match[1]);
  return Number.isFinite(value) ? value : null;
}

function parseOiPriceChangePercent(line: string): number | null {
  const match = line.match(/\bPrice\s*:\s*\$?\s*[0-9][0-9.,]*\s*\(([+-]?\d+(?:[.,]\d+)?)\s*%\)/i);
  if (!match?.[1]) return null;
  const value = Number(match[1].replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

function isOiAlertText(plainText: string): boolean {
  return /\bOpen\s+Interest\s+Alerts\b/i.test(plainText) || /\bOI\s+alert\b/i.test(plainText);
}

function parseOiAlertFollowup(line: string): { priceUsd: number | null; priceChangePercent: number | null } {
  if (!line) return { priceUsd: null, priceChangePercent: null };
  const match = line.match(/#?[A-Z0-9]{1,12}\s+\$\s*([0-9][0-9.,]*)\s+([+-]?\d+(?:[.,]\d+)?)\s*%/i);
  if (!match?.[1] || !match[2]) return { priceUsd: null, priceChangePercent: null };
  const priceUsd = parseLocaleNumber(match[1]);
  const priceChangePercent = Number(match[2].replace(',', '.'));
  return {
    priceUsd: Number.isFinite(priceUsd) ? priceUsd : null,
    priceChangePercent: Number.isFinite(priceChangePercent) ? priceChangePercent : null
  };
}

function parseLabeledPercent(text: string, label: RegExp): number | null {
  const match = text.match(new RegExp(`${label.source}\\s*([+-]?\\d+(?:[.,]\\d+)?)\\s*%`, label.flags));
  if (!match?.[1]) return null;
  const value = Number(match[1].replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

function parseOiAlertPrice(text: string): number | null {
  const match = text.match(/\bPrice\s*:\s*\$?\s*([0-9][0-9.,]*)\s*\$?/i);
  if (!match?.[1]) return null;
  const value = parseLocaleNumber(match[1]);
  return Number.isFinite(value) ? value : null;
}

function parseTotalAlerts(text: string): number | null {
  const match = text.match(/\bTotal\s+alerts\s*:\s*(\d+)\b/i);
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  return Number.isInteger(value) ? value : null;
}

function parseProviderUtcTimestamp(text: string): string | null {
  const match = text.match(/\bTime\s+UTC\s*:\s*(\d{2})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2}):(\d{2})\b/i);
  if (!match?.[1] || !match[2] || !match[3] || !match[4] || !match[5] || !match[6]) return null;
  const year = 2000 + Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (!Number.isFinite(date.getTime())) return null;
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString();
}

export function parseTotalUsdAmount(plainText: string, entries: ParsedTopEntry[] = []): number | null {
  const explicitTotal = parseExplicitTotalUsdAmount(plainText);
  if (explicitTotal !== null) return explicitTotal;

  const amounts = entries
    .map((entry) => entry.amountUsd)
    .filter((amount): amount is number => typeof amount === 'number' && Number.isFinite(amount) && amount > 0);
  if (!amounts.length) return null;
  return amounts.reduce((sum, amount) => sum + amount, 0);
}

function parseExplicitTotalUsdAmount(plainText: string): number | null {
  const lines = plainText.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    if (!/\b(total|amount|sum|итого|всего)\b/i.test(line)) continue;
    const amount = parseUsdAmount(line);
    if (amount !== null) return amount;
  }
  return null;
}

function parsePercent(line: string): number | null {
  const match = line.match(/([+-]?\d+(?:[.,]\d+)?)\s*%/);
  if (!match?.[1]) return null;
  const value = Number(match[1].replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

function inferDirection(line: string, preferred: ParsedTopEntry['direction']): ParsedTopEntry['direction'] {
  const hasBuy = BUY_RE.test(line);
  const hasSell = SELL_RE.test(line);
  if (hasBuy && !hasSell) return 'buy';
  if (hasSell && !hasBuy) return 'sell';
  if (hasBuy && hasSell && (preferred === 'buy' || preferred === 'sell')) return preferred;
  if (GAINER_RE.test(line)) return 'gainer';
  if (LOSER_RE.test(line)) return 'loser';
  return preferred;
}

function parseExchange(line: string): string | null {
  const exchanges = ['BINANCE', 'OKX', 'BYBIT', 'BITGET', 'KUCOIN', 'BINGX', 'COINBASE', 'KRAKEN', 'HYPERLIQUID'];
  const upper = line.toUpperCase();
  return exchanges.find((exchange) => upper.includes(exchange)) ?? null;
}

function parseTopDirection(value: string): TopListDirection | null {
  const hasBuy = BUY_RE.test(value);
  const hasSell = SELL_RE.test(value);
  if (hasBuy === hasSell) return null;
  return hasBuy ? 'buy' : 'sell';
}

function parseTopInterval(value: string): TopListInterval | null {
  return FIVE_MIN_RE.test(value) ? '5m' : null;
}

function parseOiDirection(value: string): OiTopDirection | null {
  const hasGainer = GAINER_RE.test(value);
  const hasLoser = LOSER_RE.test(value);
  if (hasGainer === hasLoser) return null;
  return hasGainer ? 'gainer' : 'loser';
}

function hasSixtyMinuteOiSignal(filterText: string, titleLine: string): boolean {
  if (SIXTY_MIN_RE.test(titleLine)) return true;
  if (/\b(?:5|15|30)[\s_-]*(?:m|min|mins|minute|minutes)\b/i.test(titleLine)) return false;
  if (/\b(?:5|15|30)[\s_-]*(?:m|min|mins|minute|minutes)\b/i.test(filterText)) return false;
  return SIXTY_MIN_RE.test(filterText);
}

function firstNonEmptyLine(value: string): string {
  return value.split(/\n+/).map((line) => line.trim()).find(Boolean) ?? '';
}

function normalizeCoin(value: string, options: { allowSingleCharacter?: boolean; allowCommonWords?: boolean } = {}): string | null {
  const coin = value.toUpperCase().replace(/^#/, '').replace(/[^A-Z0-9]/g, '');
  const minLength = options.allowSingleCharacter ? 1 : 2;
  if (!coin || coin.length < minLength || coin.length > 12) return null;
  if (options.allowCommonWords !== true && COMMON_WORDS.has(coin)) return null;
  return coin;
}

function parseLocaleNumber(value: string): number {
  const trimmed = value.trim();
  const normalized = normalizeNumberSeparators(trimmed);
  return Number(normalized);
}

function decodeProviderEscapes(value: string): string {
  return value.replace(/(?:%[0-9a-f]{2})+/gi, (encoded) => {
    try {
      return decodeURIComponent(encoded);
    } catch {
      return encoded;
    }
  });
}

function normalizeNumberSeparators(value: string): string {
  if (value.includes('.') && value.includes(',')) return value.replace(/,/g, '');
  if (/,\d{3}(?:\D|$)/.test(value)) return value.replace(/,/g, '');
  if (value.includes(',') && !value.includes('.')) return value.replace(/,/g, '.');
  return value;
}

function multiplier(value: string | undefined): number {
  switch (value?.toLowerCase()) {
    case 'k':
      return 1_000;
    case 'm':
      return 1_000_000;
    case 'b':
      return 1_000_000_000;
    default:
      return 1;
  }
}

function normalizeEpochMs(value: number): number {
  return value < 10_000_000_000 ? value * 1_000 : value;
}

function sanitizeUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
