import { useState } from 'react';

import { getCoinClassificationClasses, matchesCoinClassificationFilter, type CoinClassificationFilter } from '../coinClassification';
import type { DashboardSnapshot, FeedKey, NormalizedEvent, ParsedTopEntry } from '../types';
import { formatTime } from './format';
import { PerformanceTrendChips, type PerformanceTrendByCoin } from './PerformanceTrendChips';

interface SignalsPageProps {
  snapshot: DashboardSnapshot;
  highlightedIds: Set<string>;
  classificationFilter: CoinClassificationFilter;
  performanceTrends: PerformanceTrendByCoin;
  alertKind: AlertKind;
}

type AlertKind = 'price' | 'volume';
type SignalDirection = 'up' | 'down' | 'flat';
type AlertSortKey = 'time' | 'coin' | 'signal' | 'price' | 'volume24h' | 'alertVolume';
type SortDirection = 'asc' | 'desc';

interface ParsedAlertRow {
  event: NormalizedEvent;
  kind: AlertKind;
  coin: string;
  exchange: string;
  href: string | null;
  price: number | null;
  priceChangePercent: number | null;
  signalChangePercent: number | null;
  signalWindow: string | null;
  threshold: string | null;
  volume24hValue: number | null;
  alertVolumeValue: number | null;
  direction: SignalDirection;
}

export function SignalsPage({ snapshot, highlightedIds, classificationFilter, performanceTrends, alertKind }: SignalsPageProps) {
  const [hoveredCoin, setHoveredCoin] = useState<string | null>(null);
  const page = getAlertPageConfig(alertKind);

  return (
    <main className="mx-auto grid max-w-[1800px] gap-3 px-4 py-3 md:px-6">
      <section className={`page-hero ${page.heroClass}`}>
        <h1>{page.heroTitle}</h1>
        <span>{page.heroSubtitle}</span>
      </section>

      <section className="grid gap-4">
        <AlertTable
          title={page.tableTitle}
          subtitle={page.tableSubtitle}
          events={snapshot.feeds[page.feedKey].events}
          feedKey={page.feedKey}
          kind={alertKind}
          highlightedIds={highlightedIds}
          classificationFilter={classificationFilter}
          hoveredCoin={hoveredCoin}
          onCoinHover={setHoveredCoin}
          performanceTrends={performanceTrends}
        />
      </section>
    </main>
  );
}

function getAlertPageConfig(kind: AlertKind): {
  heroClass: string;
  heroTitle: string;
  heroSubtitle: string;
  tableTitle: string;
  tableSubtitle: string;
  feedKey: Extract<FeedKey, 'pricealerts' | 'volalerts'>;
} {
  if (kind === 'price') {
    return {
      heroClass: 'price-alerts',
      heroTitle: 'Price Alerts',
      heroSubtitle: 'Binance and Bybit spot/futures price movement alerts',
      tableTitle: 'Price Alerts 1',
      tableSubtitle: 'signals/pricealerts · 1m/5m · change2/change5/change10',
      feedKey: 'pricealerts'
    };
  }

  return {
    heroClass: 'volume-alerts',
    heroTitle: 'Volume Alerts',
    heroSubtitle: 'Binance and Bybit spot/futures volume movement alerts',
    tableTitle: 'Volume Alerts',
    tableSubtitle: 'signals/volalerts · Binance/Bybit spot+futures',
    feedKey: 'volalerts'
  };
}

function AlertTable({
  title,
  subtitle,
  events,
  feedKey,
  kind,
  highlightedIds,
  classificationFilter,
  hoveredCoin,
  onCoinHover,
  performanceTrends
}: {
  title: string;
  subtitle: string;
  events: NormalizedEvent[];
  feedKey: FeedKey;
  kind: AlertKind;
  highlightedIds: Set<string>;
  classificationFilter: CoinClassificationFilter;
  hoveredCoin: string | null;
  onCoinHover: (coin: string | null) => void;
  performanceTrends: PerformanceTrendByCoin;
}) {
  const [sort, setSort] = useState<{ key: AlertSortKey; direction: SortDirection }>({ key: 'time', direction: 'desc' });
  const rows = events
    .flatMap((event) => flattenAlertRows(event, kind))
    .filter((row): row is ParsedAlertRow => row !== null)
    .filter((row) => matchesCoinClassificationFilter(row.coin, classificationFilter));
  const sortedRows = [...rows].sort((left, right) => compareAlertRows(left, right, sort.key, sort.direction));
  const sortButton = (key: AlertSortKey, label: string) => {
    const isActive = sort.key === key;
    const nextDirection = isActive && sort.direction === 'desc' ? 'asc' : 'desc';

    return (
      <button
        aria-label={`Sort by ${label} ${nextDirection}`}
        aria-pressed={isActive}
        className={`table-sort-button ${isActive ? 'active' : ''}`}
        type="button"
        onClick={() => setSort((current) => (current.key === key ? { key, direction: current.direction === 'desc' ? 'asc' : 'desc' } : { key, direction: 'desc' }))}
      >
        <span>{label}</span>
        <span className="sort-indicator">{isActive ? (sort.direction === 'desc' ? 'v' : '^') : ''}</span>
      </button>
    );
  };

  return (
    <section className="panel min-h-[420px]">
      <div className="panel-header">
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        <span className="count-pill">{events.length}</span>
      </div>

      {sortedRows.length ? (
        <div className="overflow-x-auto rounded-2xl border border-slate-800/80">
          <table className="w-full min-w-[1080px] table-fixed text-left text-[11px] xl:text-xs 2xl:text-sm">
            <thead className="bg-slate-950/70 text-[9px] uppercase tracking-[0.12em] text-slate-500 xl:text-[10px]">
              <tr>
                <th className="w-[7%] px-1.5 py-2">{sortButton('time', 'Time')}</th>
                <th className="w-[10%] px-1.5 py-2">{sortButton('coin', 'Coin')}</th>
                <th className="w-[14%] px-1.5 py-2">Exchange</th>
                <th className="w-[10%] px-1.5 py-2">{sortButton('signal', kind === 'price' ? 'Move' : 'Vol Move')}</th>
                <th className="w-[8%] px-1.5 py-2">Window</th>
                <th className="w-[10%] px-1.5 py-2">{sortButton('price', 'Price')}</th>
                <th className="w-[9%] px-1.5 py-2">Price %</th>
                <th className="w-[12%] px-1.5 py-2">{sortButton('volume24h', 'Vol24')}</th>
                <th className="w-[10%] px-1.5 py-2">{sortButton('alertVolume', 'Alert Vol')}</th>
                <th className="w-[10%] px-1.5 py-2">Threshold</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.slice(0, 24).map((row) => {
                const classificationClasses = getCoinClassificationClasses(row.coin);
                const isLinked = row.coin === hoveredCoin;
                const highlighted = highlightedIds.has(row.event.id);
                return (
                  <tr
                    className={`classification-row border-t border-slate-800/70 ${classificationClasses} ${isLinked ? 'linked-coin-row' : ''} ${highlighted ? 'event-flash' : ''}`}
                    key={`${feedKey}-${row.event.id}-${row.coin}`}
                    onMouseEnter={() => onCoinHover(row.coin)}
                    onMouseLeave={() => onCoinHover(null)}
                    onFocus={() => onCoinHover(row.coin)}
                    onBlur={() => onCoinHover(null)}
                  >
                    <td className="px-1.5 py-2 font-black text-slate-500">{formatTime(row.event.receivedAt)}</td>
                    <td className="px-1.5 py-2">
                      <span className="coin-cell">
                        <button className="coin-button" type="button" onClick={() => copyCoin(row.coin)}>
                          {row.coin}
                        </button>
                        <PerformanceTrendChips coin={row.coin} trends={performanceTrends} />
                      </span>
                    </td>
                    <td className="px-1.5 py-2 font-bold text-slate-200">
                      {row.href ? (
                        <a className="table-link" href={row.href} rel="noreferrer noopener" target="_blank">
                          {row.exchange}
                        </a>
                      ) : (
                        row.exchange
                      )}
                    </td>
                    <td className="px-1.5 py-2">
                      <span className={`alert-signal-badge ${row.direction}`}>{formatSignedPercent(row.signalChangePercent)}</span>
                    </td>
                    <td className="px-1.5 py-2 font-bold text-slate-300">{row.signalWindow ?? '-'}</td>
                    <td className="px-1.5 py-2 font-bold text-slate-200">{formatPrice(row.price)}</td>
                    <td className={`px-1.5 py-2 font-bold ${changeClass(row.priceChangePercent)}`}>{formatSignedPercent(row.priceChangePercent)}</td>
                    <td className="px-1.5 py-2 font-bold text-slate-300">{formatUsdAmount(row.volume24hValue)}</td>
                    <td className={`px-1.5 py-2 font-bold ${changeClass(row.alertVolumeValue)}`}>{formatCompactAmount(row.alertVolumeValue)}</td>
                    <td className="px-1.5 py-2 font-black text-cyan-100">{row.threshold ?? '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-state">Waiting for matching {title.toLowerCase()}</div>
      )}
    </section>
  );
}

function flattenAlertRows(event: NormalizedEvent, kind: AlertKind): Array<ParsedAlertRow | null> {
  return event.entries.map((entry) => toAlertRow(event, entry, kind));
}

function toAlertRow(event: NormalizedEvent, entry: ParsedTopEntry, kind: AlertKind): ParsedAlertRow | null {
  if (!entry.coin) return null;

  return {
    event,
    kind,
    coin: entry.coin,
    exchange: entry.exchange ?? 'Unknown',
    href: entry.href ?? null,
    price: entry.priceUsd,
    priceChangePercent: kind === 'price' ? entry.priceChangePercent ?? entry.percent : entry.priceChangePercent,
    signalChangePercent: entry.percent,
    signalWindow: entry.interval,
    threshold: entry.threshold ?? null,
    volume24hValue: entry.volume24hUsd,
    alertVolumeValue: entry.amountUsd,
    direction: getDirection(entry.percent)
  };
}

function compareAlertRows(left: ParsedAlertRow, right: ParsedAlertRow, sortKey: AlertSortKey, direction: SortDirection): number {
  if (sortKey === 'coin') {
    const result = left.coin.localeCompare(right.coin);
    if (result !== 0) return direction === 'desc' ? -result : result;
  } else {
    const leftScore = getAlertSortScore(left, sortKey);
    const rightScore = getAlertSortScore(right, sortKey);
    if (leftScore === null && rightScore !== null) return 1;
    if (leftScore !== null && rightScore === null) return -1;
    if (leftScore !== null && rightScore !== null && leftScore !== rightScore) {
      return direction === 'desc' ? rightScore - leftScore : leftScore - rightScore;
    }
  }

  return Date.parse(right.event.receivedAt) - Date.parse(left.event.receivedAt);
}

function getAlertSortScore(row: ParsedAlertRow, sortKey: AlertSortKey): number | null {
  if (sortKey === 'time') return Date.parse(row.event.receivedAt);
  if (sortKey === 'signal') return finiteScore(Math.abs(row.signalChangePercent ?? Number.NaN));
  if (sortKey === 'price') return finiteScore(row.price);
  if (sortKey === 'volume24h') return finiteScore(row.volume24hValue);
  return finiteScore(row.alertVolumeValue);
}

function finiteScore(value: number | null | undefined): number | null {
  return Number.isFinite(value) ? (value as number) : null;
}

function formatPrice(value: number | null): string {
  if (!Number.isFinite(value)) return '-';
  const finiteValue = value as number;
  return finiteValue.toLocaleString('en-US', {
    maximumFractionDigits: finiteValue < 1 ? 8 : finiteValue < 10 ? 4 : 2
  });
}

function formatSignedPercent(value: number | null): string {
  if (!Number.isFinite(value)) return '-';
  const finiteValue = value as number;
  const sign = finiteValue > 0 ? '+' : '';
  return `${sign}${formatCompactDecimal(finiteValue)}%`;
}

function formatCompactDecimal(value: number): string {
  return value.toFixed(Math.abs(value) >= 10 ? 1 : 2).replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
}

function formatUsdAmount(value: number | null): string {
  if (!Number.isFinite(value)) return '-';
  return `$${formatCompactAmount(value)}`;
}

function formatCompactAmount(value: number | null): string {
  if (!Number.isFinite(value)) return '-';
  const finiteValue = value as number;
  const abs = Math.abs(finiteValue);
  const suffix = abs >= 1_000_000_000 ? 'B' : abs >= 1_000_000 ? 'M' : abs >= 1_000 ? 'K' : '';
  const divisor = suffix === 'B' ? 1_000_000_000 : suffix === 'M' ? 1_000_000 : suffix === 'K' ? 1_000 : 1;
  const decimals = abs / divisor >= 100 || divisor === 1 ? 0 : abs / divisor >= 10 ? 1 : 2;
  return `${(finiteValue / divisor).toFixed(decimals).replace(/\.0+$/, '')}${suffix}`;
}

function getDirection(value: number | null): SignalDirection {
  if (!Number.isFinite(value) || value === 0) return 'flat';
  return (value as number) > 0 ? 'up' : 'down';
}

function changeClass(value: number | null): string {
  if (!Number.isFinite(value) || value === 0) return 'text-slate-300';
  return (value as number) > 0 ? 'text-emerald-300' : 'text-rose-300';
}

function copyCoin(coin: string): void {
  void navigator.clipboard?.writeText(coin);
}
