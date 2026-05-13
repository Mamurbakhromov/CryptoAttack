import { useState } from 'react';

import { getCoinClassificationClasses, matchesCoinClassificationFilter, type CoinClassificationFilter } from '../coinClassification';
import type { DashboardSnapshot, NormalizedEvent, ParsedTopEntry } from '../types';
import { formatTime } from './format';
import { PerformanceTrendChips, type PerformanceTrendByCoin } from './PerformanceTrendChips';

interface BigActivitiesPageProps {
  snapshot: DashboardSnapshot;
  highlightedIds: Set<string>;
  classificationFilter: CoinClassificationFilter;
  performanceTrends: PerformanceTrendByCoin;
  mode: BigActivitiesMode;
}

export type BigActivitiesMode = 'buying' | 'selling' | 'activity';
type CexTrackAction = BigActivitiesMode;
type CexTrackSortKey = 'time' | 'amount' | 'share' | 'priceChange' | 'volume';
type SortDirection = 'asc' | 'desc';

interface CexTrackRow {
  event: NormalizedEvent;
  coin: string | null;
  action: CexTrackAction;
  exchange: string | null;
  href: string | null;
  amountValue: number | null;
  amountDisplay: string;
  window: string | null;
  sharePercent: number | null;
  price: number | null;
  priceChangePercent: number | null;
  volume24hValue: number | null;
  volume24hDisplay: string;
  lastSeen: string | null;
}

export function BigActivitiesPage({ snapshot, highlightedIds, classificationFilter, performanceTrends, mode }: BigActivitiesPageProps) {
  const [hoveredCoin, setHoveredCoin] = useState<string | null>(null);
  const page = getPageConfig(mode);
  const rows = snapshot.feeds.cex_track.events
    .flatMap(flattenCexTrackRows)
    .filter((row): row is CexTrackRow => row !== null)
    .filter((row) => row.action === mode)
    .filter((row) => matchesCoinClassificationFilter(row.coin, classificationFilter));

  return (
    <main className="mx-auto grid max-w-[1800px] gap-3 px-4 py-3 md:px-6">
      <section className={`page-hero ${page.heroClass}`}>
        <h1>{page.heroTitle}</h1>
        <span>{page.heroSubtitle}</span>
      </section>

      <section className="grid gap-4">
        <CexTrackTable
          title={page.tableTitle}
          subtitle={page.tableSubtitle}
          rows={rows}
          highlightedIds={highlightedIds}
          hoveredCoin={hoveredCoin}
          onCoinHover={setHoveredCoin}
          performanceTrends={performanceTrends}
          maxRows={page.maxRows}
        />
      </section>
    </main>
  );
}

function getPageConfig(mode: BigActivitiesMode): {
  heroClass: string;
  heroTitle: string;
  heroSubtitle: string;
  tableTitle: string;
  tableSubtitle: string;
  maxRows: number;
} {
  if (mode === 'buying') {
    return {
      heroClass: 'big-buying',
      heroTitle: 'Big buying',
      heroSubtitle: 'Large CEX buying alerts',
      tableTitle: 'Big Buying',
      tableSubtitle: 'cex_alerts/cex_track · recent buying alerts',
      maxRows: 30
    };
  }

  if (mode === 'selling') {
    return {
      heroClass: 'big-selling',
      heroTitle: 'Big selling',
      heroSubtitle: 'Large CEX selling alerts',
      tableTitle: 'Big Selling',
      tableSubtitle: 'cex_alerts/cex_track · recent selling alerts',
      maxRows: 30
    };
  }

  return {
    heroClass: 'big-activities',
    heroTitle: 'Big activities',
    heroSubtitle: 'Large neutral CEX activity alerts',
    tableTitle: 'Big Activities',
    tableSubtitle: 'cex_alerts/cex_track · neutral activity alerts',
    maxRows: 30
  };
}

function CexTrackTable({
  title,
  subtitle,
  rows,
  highlightedIds,
  hoveredCoin,
  onCoinHover,
  performanceTrends,
  maxRows = 18
}: {
  title: string;
  subtitle: string;
  rows: CexTrackRow[];
  highlightedIds: Set<string>;
  hoveredCoin: string | null;
  onCoinHover: (coin: string | null) => void;
  performanceTrends: PerformanceTrendByCoin;
  maxRows?: number;
}) {
  const [sort, setSort] = useState<{ key: CexTrackSortKey; direction: SortDirection }>({ key: 'time', direction: 'desc' });
  const sortedRows = [...rows].sort((left, right) => compareCexTrackRows(left, right, sort.key, sort.direction));
  const sortButton = (key: CexTrackSortKey, label: string) => {
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
        <span className="count-pill">{rows.length}</span>
      </div>

      {sortedRows.length ? (
        <div className="overflow-x-auto rounded-2xl border border-slate-800/80">
          <table className="w-full min-w-[1080px] table-fixed text-left text-[11px] xl:text-xs 2xl:text-sm">
            <thead className="bg-slate-950/70 text-[9px] uppercase tracking-[0.12em] text-slate-500 xl:text-[10px]">
              <tr>
                <th className="w-[7%] px-1.5 py-2">{sortButton('time', 'Time')}</th>
                <th className="w-[10%] px-1.5 py-2">Coin</th>
                <th className="w-[12%] px-1.5 py-2">Exchange</th>
                <th className="w-[8%] px-1.5 py-2">Signal</th>
                <th className="w-[12%] px-1.5 py-2">{sortButton('amount', 'Amount')}</th>
                <th className="w-[8%] px-1.5 py-2">Window</th>
                <th className="w-[7%] px-1.5 py-2">{sortButton('share', 'Share')}</th>
                <th className="w-[9%] px-1.5 py-2">Price</th>
                <th className="w-[7%] px-1.5 py-2">{sortButton('priceChange', 'Move')}</th>
                <th className="w-[9%] px-1.5 py-2">{sortButton('volume', 'Vol24')}</th>
                <th className="w-[11%] px-1.5 py-2">Last Seen</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.slice(0, maxRows).map((row) => {
                const classificationClasses = getCoinClassificationClasses(row.coin);
                const isLinked = Boolean(row.coin && row.coin === hoveredCoin);
                const highlighted = highlightedIds.has(row.event.id);
                return (
                  <tr
                    className={`classification-row border-t border-slate-800/70 ${classificationClasses} ${isLinked ? 'linked-coin-row' : ''} ${highlighted ? 'event-flash' : ''}`}
                    key={`${row.event.id}-${row.coin}-${row.action}`}
                    onMouseEnter={() => onCoinHover(row.coin)}
                    onMouseLeave={() => onCoinHover(null)}
                    onFocus={() => onCoinHover(row.coin)}
                    onBlur={() => onCoinHover(null)}
                  >
                    <td className="px-1.5 py-2 font-black text-slate-500">{formatTime(row.event.receivedAt)}</td>
                    <td className="px-1.5 py-2">
                      <span className="coin-cell">
                        {row.coin ? (
                          <button className="coin-button" type="button" onClick={() => copyCoin(row.coin!)}>
                            {row.coin}
                          </button>
                        ) : (
                          <span className="text-slate-500">Unknown</span>
                        )}
                        <PerformanceTrendChips coin={row.coin} trends={performanceTrends} />
                      </span>
                    </td>
                    <td className="px-1.5 py-2 font-bold text-slate-200">
                      {row.href ? (
                        <a className="table-link" href={row.href} rel="noreferrer noopener" target="_blank">
                          {row.exchange ?? 'Open'}
                        </a>
                      ) : (
                        row.exchange ?? '-'
                      )}
                    </td>
                    <td className="px-1.5 py-2">
                      <span className={`cex-action-badge ${row.action}`}>{formatAction(row.action)}</span>
                    </td>
                    <td className="px-1.5 py-2 font-bold text-cyan-100">{row.amountDisplay}</td>
                    <td className="px-1.5 py-2 font-bold text-slate-300">{row.window ?? '-'}</td>
                    <td className="px-1.5 py-2 font-bold text-amber-200">{formatPercent(row.sharePercent)}</td>
                    <td className="px-1.5 py-2 font-bold text-slate-200">{formatPrice(row.price)}</td>
                    <td className={`px-1.5 py-2 font-bold ${changeClass(row.priceChangePercent)}`}>{formatSignedPercent(row.priceChangePercent)}</td>
                    <td className="px-1.5 py-2 font-bold text-slate-300">{row.volume24hDisplay}</td>
                    <td className="px-1.5 py-2 font-bold text-slate-400">{row.lastSeen ?? '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-state">Waiting for matching CEX Track alerts</div>
      )}
    </section>
  );
}

function flattenCexTrackRows(event: NormalizedEvent): Array<CexTrackRow | null> {
  return event.entries.map((entry) => toCexTrackRow(event, entry));
}

function toCexTrackRow(event: NormalizedEvent, entry: ParsedTopEntry): CexTrackRow | null {
  const action = mapTrackAction(entry.direction);
  if (!entry.coin || !action) return null;

  return {
    event,
    coin: entry.coin,
    action,
    exchange: entry.exchange,
    href: entry.href ?? null,
    amountValue: entry.amountUsd,
    amountDisplay: formatAmount(entry.amountUsd, entry.amountAsset),
    window: entry.interval,
    sharePercent: entry.percent,
    price: entry.priceUsd,
    priceChangePercent: entry.priceChangePercent,
    volume24hValue: entry.volume24hUsd,
    volume24hDisplay: formatAmount(entry.volume24hUsd, entry.volume24hAsset),
    lastSeen: entry.lastSeen ?? null
  };
}

function mapTrackAction(direction: ParsedTopEntry['direction']): CexTrackAction | null {
  if (direction === 'buy') return 'buying';
  if (direction === 'sell') return 'selling';
  if (direction === 'activity') return 'activity';
  return null;
}

function compareCexTrackRows(left: CexTrackRow, right: CexTrackRow, sortKey: CexTrackSortKey, direction: SortDirection): number {
  const leftScore = getCexTrackSortScore(left, sortKey);
  const rightScore = getCexTrackSortScore(right, sortKey);

  if (leftScore === null && rightScore !== null) return 1;
  if (leftScore !== null && rightScore === null) return -1;
  if (leftScore !== null && rightScore !== null && leftScore !== rightScore) {
    return direction === 'desc' ? rightScore - leftScore : leftScore - rightScore;
  }

  return Date.parse(right.event.receivedAt) - Date.parse(left.event.receivedAt);
}

function getCexTrackSortScore(row: CexTrackRow, sortKey: CexTrackSortKey): number | null {
  if (sortKey === 'time') return Date.parse(row.event.receivedAt);
  if (sortKey === 'amount') return finiteScore(row.amountValue);
  if (sortKey === 'share') return finiteScore(row.sharePercent);
  if (sortKey === 'priceChange') return finiteScore(Math.abs(row.priceChangePercent ?? Number.NaN));
  return finiteScore(row.volume24hValue);
}

function finiteScore(value: number | null | undefined): number | null {
  return Number.isFinite(value) ? (value as number) : null;
}

function formatAmount(value: number | null | undefined, quoteAsset: string | null | undefined): string {
  if (!Number.isFinite(value)) return '-';
  const finiteValue = value as number;
  const abs = Math.abs(finiteValue);
  const suffix = abs >= 1_000_000_000 ? 'B' : abs >= 1_000_000 ? 'M' : abs >= 1_000 ? 'K' : '';
  const divisor = suffix === 'B' ? 1_000_000_000 : suffix === 'M' ? 1_000_000 : suffix === 'K' ? 1_000 : 1;
  const decimals = abs / divisor >= 100 || divisor === 1 ? 0 : abs / divisor >= 10 ? 1 : 2;
  return `${(finiteValue / divisor).toFixed(decimals).replace(/\.0+$/, '')}${suffix}${quoteAsset ? ` ${quoteAsset}` : ''}`;
}

function formatAction(action: CexTrackAction): string {
  if (action === 'buying') return 'Buying';
  if (action === 'selling') return 'Selling';
  return 'Activity';
}

function formatPercent(value: number | null | undefined): string {
  if (!Number.isFinite(value)) return '-';
  return `${(value as number).toFixed(0)}%`;
}

function formatPrice(value: number | null | undefined): string {
  if (!Number.isFinite(value)) return '-';
  const finiteValue = value as number;
  const maximumFractionDigits = finiteValue >= 100 ? 2 : finiteValue >= 1 ? 4 : 8;
  return new Intl.NumberFormat(undefined, { maximumFractionDigits }).format(finiteValue);
}

function formatSignedPercent(value: number | null | undefined): string {
  if (!Number.isFinite(value)) return '-';
  const finiteValue = value as number;
  return `${finiteValue > 0 ? '+' : ''}${finiteValue.toFixed(2)}%`;
}

function changeClass(value: number | null | undefined): string {
  if (!Number.isFinite(value) || value === 0) return 'text-slate-300';
  return (value as number) > 0 ? 'text-emerald-300' : 'text-rose-300';
}

function copyCoin(coin: string): void {
  void navigator.clipboard?.writeText(coin);
}
