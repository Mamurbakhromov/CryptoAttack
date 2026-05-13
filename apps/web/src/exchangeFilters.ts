import type { ExchangeAvailabilityByMarket } from './components/ExchangeChips';
import type { ExchangeKey, ExchangeMarket } from './types';

export type ExchangeFilter = ExchangeKey[];
export type MarketFilter = ExchangeMarket[];

export const exchangeFilterOptions: Array<{ value: ExchangeKey; label: string }> = [
  { value: 'binance', label: 'Binance' },
  { value: 'bybit', label: 'Bybit' },
  { value: 'okx', label: 'OKX' },
  { value: 'coinbase', label: 'Coinbase' }
];

export const marketFilterOptions: Array<{ value: ExchangeMarket; label: string }> = [
  { value: 'spot', label: 'Spot' },
  { value: 'perpetual', label: 'Futures' }
];

export function isExchangeFilterActive(filter: ExchangeFilter): boolean {
  return filter.length > 0;
}

export function isMarketFilterActive(filter: MarketFilter): boolean {
  return filter.length > 0;
}

export function getExchangeFilterLabel(filter: ExchangeFilter): string {
  if (!filter.length) return 'All exchanges';
  if (filter.length === 1) {
    const exchange = filter[0];
    return exchangeFilterOptions.find((option) => option.value === exchange)?.label ?? exchange ?? 'Selected exchange';
  }
  return `${filter.length} exchanges`;
}

export function getMarketFilterLabel(filter: MarketFilter): string {
  if (!filter.length) return 'Spot + Futures';
  if (filter.length === 1) {
    const market = filter[0];
    return marketFilterOptions.find((option) => option.value === market)?.label ?? market ?? 'Selected market';
  }
  return 'Spot + Futures';
}

export function toggleExchangeFilter(current: ExchangeFilter, exchange: ExchangeKey): ExchangeFilter {
  if (current.includes(exchange)) return current.filter((item) => item !== exchange);
  return exchangeFilterOptions
    .map((option) => option.value)
    .filter((item) => current.includes(item) || item === exchange);
}

export function toggleMarketFilter(current: MarketFilter, market: ExchangeMarket): MarketFilter {
  if (current.includes(market)) return current.filter((item) => item !== market);
  return marketFilterOptions
    .map((option) => option.value)
    .filter((item) => current.includes(item) || item === market);
}

export function marketFilterAllows(market: ExchangeMarket, filter: MarketFilter): boolean {
  return !filter.length || filter.includes(market);
}

export function matchesExchangeFilterByExchange(exchange: string | null | undefined, filter: ExchangeFilter): boolean {
  if (!filter.length) return true;
  const normalized = normalizeExchangeKey(exchange);
  return normalized ? filter.includes(normalized) : false;
}

export function matchesExchangeFilterByCoin(
  coin: string | null | undefined,
  market: ExchangeMarket,
  availability: ExchangeAvailabilityByMarket,
  filter: ExchangeFilter
): boolean {
  if (!coin) return false;
  const chips = availability[market].get(coin.toUpperCase()) ?? [];
  if (!filter.length) return chips.length > 0;
  return chips.some((chip) => filter.includes(chip.exchange as ExchangeKey));
}

export function normalizeExchangeKey(value: string | null | undefined): ExchangeKey | null {
  const normalized = value?.trim().toLowerCase().replace(/[^a-z0-9]/g, '') ?? '';
  if (normalized.includes('binance')) return 'binance';
  if (normalized.includes('bybit')) return 'bybit';
  if (normalized.includes('okx') || normalized.includes('okex')) return 'okx';
  if (normalized.includes('coinbase')) return 'coinbase';
  return null;
}
