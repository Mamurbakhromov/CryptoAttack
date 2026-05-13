import type { ExchangeKey, ExchangeMarket, ExchangeSymbol } from '../types';

export interface ExchangeChipInfo {
  exchange: string;
  label: string;
  shortLabel: string;
}

export type ExchangeAvailabilityByMarket = Record<ExchangeMarket, Map<string, ExchangeChipInfo[]>>;

const exchangeOrder = ['binance', 'bybit', 'okx', 'coinbase'];

const exchangeMeta: Record<string, { label: string; shortLabel: string }> = {
  binance: { label: 'Binance', shortLabel: 'BN' },
  bybit: { label: 'Bybit', shortLabel: 'BB' },
  okx: { label: 'OKX', shortLabel: 'OKX' },
  coinbase: { label: 'Coinbase', shortLabel: 'CB' }
};

export function emptyExchangeAvailability(): ExchangeAvailabilityByMarket {
  return {
    spot: new Map(),
    perpetual: new Map()
  };
}

export function buildExchangeAvailability(symbols: ExchangeSymbol[]): ExchangeAvailabilityByMarket {
  const availability = emptyExchangeAvailability();
  const seen = new Set<string>();

  for (const symbol of symbols) {
    if (symbol.status !== 'active') continue;
    const coin = symbol.baseAsset.toUpperCase();
    const exchange = symbol.exchange;
    if (!exchangeOrder.includes(exchange)) continue;
    const key = `${symbol.market}:${coin}:${exchange}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const chips = availability[symbol.market].get(coin) ?? [];
    chips.push(createExchangeChip(exchange, symbol.exchangeLabel));
    chips.sort(compareExchangeChips);
    availability[symbol.market].set(coin, chips);
  }

  return availability;
}

export function getCoinExchangeChips(
  coin: string | null,
  market: ExchangeMarket,
  availability: ExchangeAvailabilityByMarket,
  exactExchange?: string | null
): ExchangeChipInfo[] {
  if (exactExchange) return firstPriorityChip([createExchangeChip(exactExchange)]);
  if (!coin) return [];
  return firstPriorityChip(availability[market].get(coin.toUpperCase()) ?? []);
}

export function ExchangeChips({ chips }: { chips: ExchangeChipInfo[] }) {
  if (!chips.length) return null;
  return (
    <span className="exchange-chip-row" aria-label={`Priority listing: ${chips[0]?.label ?? ''}`}>
      {chips.map((chip) => (
        <span className={`exchange-mini-chip ${normalizeExchangeKey(chip.exchange) ?? 'unknown'}`} title={chip.label} key={chip.exchange}>
          {chip.shortLabel}
        </span>
      ))}
    </span>
  );
}

function createExchangeChip(exchange: ExchangeKey | string, fallbackLabel?: string): ExchangeChipInfo {
  const key = normalizeExchangeKey(exchange) ?? exchange.toLowerCase();
  const meta = exchangeMeta[key];
  return {
    exchange: key,
    label: fallbackLabel ?? meta?.label ?? exchange,
    shortLabel: meta?.shortLabel ?? exchange.slice(0, 3).toUpperCase()
  };
}

function normalizeExchangeKey(value: string): string | null {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (normalized.includes('binance')) return 'binance';
  if (normalized.includes('bybit')) return 'bybit';
  if (normalized.includes('okx') || normalized.includes('okex')) return 'okx';
  if (normalized.includes('coinbase')) return 'coinbase';
  return normalized || null;
}

function firstPriorityChip(chips: ExchangeChipInfo[]): ExchangeChipInfo[] {
  const prioritized = chips.filter((chip) => exchangeOrder.includes(chip.exchange)).sort(compareExchangeChips)[0];
  return prioritized ? [prioritized] : [];
}

function compareExchangeChips(left: ExchangeChipInfo, right: ExchangeChipInfo): number {
  const leftIndex = exchangeOrder.indexOf(left.exchange);
  const rightIndex = exchangeOrder.indexOf(right.exchange);
  return (leftIndex === -1 ? 99 : leftIndex) - (rightIndex === -1 ? 99 : rightIndex) || left.label.localeCompare(right.label);
}
