import { useState } from 'react';

import { getCoinClassificationClasses, matchesCoinClassificationFilter, type CoinClassificationFilter } from '../coinClassification';
import type { DashboardSnapshot, NormalizedEvent, ParsedTopEntry } from '../types';
import { formatTime } from './format';
import { PerformanceTrendChips, type PerformanceTrendByCoin } from './PerformanceTrendChips';

type FundingView = 'highest' | 'lowest';
type FundingInterval = '30_min' | '4_h';
type FundingSortKey = 'rank' | 'coin' | 'exchange' | 'rate';
type SortDirection = 'asc' | 'desc';

const fundingViews: Array<{ value: FundingView; label: string }> = [
  { value: 'highest', label: 'Highest funding' },
  { value: 'lowest', label: 'Lowest funding' }
];

interface MarketDataPageProps {
  snapshot: DashboardSnapshot;
  highlightedIds: Set<string>;
  classificationFilter: CoinClassificationFilter;
  performanceTrends: PerformanceTrendByCoin;
}

interface FundingRow {
  event: NormalizedEvent;
  rank: number;
  coin: string;
  exchange: string;
  ratePercent: number;
  interval: FundingInterval;
  direction: FundingView;
  rawLine: string;
}

export function MarketDataPage({ snapshot, highlightedIds, classificationFilter, performanceTrends }: MarketDataPageProps) {
  const [fundingView, setFundingView] = useState<FundingView>('highest');
  const [hoveredCoin, setHoveredCoin] = useState<string | null>(null);
  const topFundingEvents = snapshot.feeds.top_funding.events;
  const titlePrefix = fundingView === 'highest' ? 'Highest Funding Rate' : 'Lowest Funding Rate';

  return (
    <main className="mx-auto grid max-w-[1800px] gap-3 px-4 py-3 md:px-6">
      <section className="page-hero market-data">
        <h1>Funding</h1>
        <span>market_data/top_funding as ranked funding-rate tables</span>
      </section>

      <section className="funding-subnav" aria-label="Funding rate views">
        {fundingViews.map((view) => (
          <button
            className={`control-button ${fundingView === view.value ? 'active' : ''}`}
            type="button"
            onClick={() => setFundingView(view.value)}
            key={view.value}
          >
            {view.label}
          </button>
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <FundingTable
          key={`${fundingView}-30_min`}
          title={`${titlePrefix} 30m`}
          subtitle={`${fundingView}/30_min · latest ranked exchanges`}
          event={getLatestFundingEvent(topFundingEvents, fundingView, '30_min')}
          direction={fundingView}
          interval="30_min"
          highlightedIds={highlightedIds}
          classificationFilter={classificationFilter}
          hoveredCoin={hoveredCoin}
          onCoinHover={setHoveredCoin}
          performanceTrends={performanceTrends}
        />

        <FundingTable
          key={`${fundingView}-4_h`}
          title={`${titlePrefix} 4h`}
          subtitle={`${fundingView}/4_h · latest ranked exchanges`}
          event={getLatestFundingEvent(topFundingEvents, fundingView, '4_h')}
          direction={fundingView}
          interval="4_h"
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

function FundingTable({
  title,
  subtitle,
  event,
  direction,
  interval,
  highlightedIds,
  classificationFilter,
  hoveredCoin,
  onCoinHover,
  performanceTrends
}: {
  title: string;
  subtitle: string;
  event: NormalizedEvent | null;
  direction: FundingView;
  interval: FundingInterval;
  highlightedIds: Set<string>;
  classificationFilter: CoinClassificationFilter;
  hoveredCoin: string | null;
  onCoinHover: (coin: string | null) => void;
  performanceTrends: PerformanceTrendByCoin;
}) {
  const [sort, setSort] = useState<{ key: FundingSortKey; direction: SortDirection }>({ key: 'rate', direction: direction === 'highest' ? 'desc' : 'asc' });
  const rows = event ? event.entries.flatMap((entry) => toFundingRow(event, entry, direction, interval)).filter((row) => matchesCoinClassificationFilter(row.coin, classificationFilter)) : [];
  const sortedRows = [...rows].sort((left, right) => compareFundingRows(left, right, sort.key, sort.direction));
  const highlighted = Boolean(event && highlightedIds.has(event.id));
  const sortButton = (key: FundingSortKey, label: string) => {
    const isActive = sort.key === key;
    const nextDirection = isActive && sort.direction === 'desc' ? 'asc' : 'desc';

    return (
      <button
        aria-label={`Sort by ${label} ${nextDirection}`}
        aria-pressed={isActive}
        className={`table-sort-button ${isActive ? 'active' : ''}`}
        type="button"
        onClick={() => setSort((current) => (current.key === key ? { key, direction: current.direction === 'desc' ? 'asc' : 'desc' } : { key, direction: key === 'rate' && direction === 'lowest' ? 'asc' : 'desc' }))}
      >
        <span>{label}</span>
        <span className="sort-indicator">{isActive ? (sort.direction === 'desc' ? 'v' : '^') : ''}</span>
      </button>
    );
  };

  return (
    <section className={`panel min-h-[420px] ${highlighted ? 'event-flash' : ''}`}>
      <div className="panel-header">
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        <span className="count-pill">{event ? formatTime(event.receivedAt) : 'Waiting'}</span>
      </div>

      {sortedRows.length ? (
        <div className="overflow-hidden rounded-2xl border border-slate-800/80">
          <table className="w-full table-fixed text-left text-[11px] xl:text-xs 2xl:text-sm">
            <thead className="bg-slate-950/70 text-[9px] uppercase tracking-[0.12em] text-slate-500 xl:text-[10px]">
              <tr>
                <th className="w-[8%] px-1.5 py-2">{sortButton('rank', '#')}</th>
                <th className="w-[20%] px-1.5 py-2">{sortButton('coin', 'Coin')}</th>
                <th className="w-[24%] px-1.5 py-2">{sortButton('exchange', 'Exchange')}</th>
                <th className="w-[18%] px-1.5 py-2">{sortButton('rate', 'Funding')}</th>
                <th className="w-[14%] px-1.5 py-2">Window</th>
                <th className="w-[16%] px-1.5 py-2">Side</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row) => {
                const classificationClasses = getCoinClassificationClasses(row.coin);
                const isLinked = row.coin === hoveredCoin;
                return (
                  <tr
                    className={`classification-row border-t border-slate-800/70 ${classificationClasses} ${isLinked ? 'linked-coin-row' : ''}`}
                    key={`${event?.id}-${row.rawLine}-${row.rank}`}
                    onMouseEnter={() => onCoinHover(row.coin)}
                    onMouseLeave={() => onCoinHover(null)}
                    onFocus={() => onCoinHover(row.coin)}
                    onBlur={() => onCoinHover(null)}
                  >
                    <td className="px-1.5 py-2 font-black text-slate-500">{row.rank}</td>
                    <td className="px-1.5 py-2">
                      <span className="coin-cell">
                        <button className="coin-button" type="button" onClick={() => copyCoin(row.coin)}>
                          {row.coin}
                        </button>
                        <PerformanceTrendChips coin={row.coin} trends={performanceTrends} />
                      </span>
                    </td>
                    <td className="px-1.5 py-2 font-bold text-slate-200">{row.exchange}</td>
                    <td className={`px-1.5 py-2 font-black ${fundingRateClass(row.ratePercent)}`}>{formatFundingRate(row.ratePercent)}</td>
                    <td className="px-1.5 py-2 font-bold text-slate-300">{formatFundingInterval(row.interval)}</td>
                    <td className="px-1.5 py-2">
                      <span className={`funding-side-badge ${row.direction}`}>{row.direction === 'highest' ? 'High positive' : 'Deep negative'}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : event ? (
        <div className="empty-state">Funding event received, waiting for table rows</div>
      ) : (
        <div className="empty-state">Waiting for first matching funding event</div>
      )}
    </section>
  );
}

function getLatestFundingEvent(events: NormalizedEvent[], direction: FundingView, interval: FundingInterval): NormalizedEvent | null {
  return events.find((event) => event.filters.includes(direction) && event.filters.includes(interval)) ?? null;
}

function toFundingRow(event: NormalizedEvent, entry: ParsedTopEntry, direction: FundingView, interval: FundingInterval): FundingRow[] {
  if (!entry.coin || !entry.exchange || !Number.isFinite(entry.percent)) return [];

  return [{
    event,
    rank: entry.rank ?? 0,
    coin: entry.coin,
    exchange: entry.exchange,
    ratePercent: entry.percent as number,
    interval,
    direction,
    rawLine: entry.rawLine
  }];
}

function compareFundingRows(left: FundingRow, right: FundingRow, sortKey: FundingSortKey, direction: SortDirection): number {
  if (sortKey === 'coin' || sortKey === 'exchange') {
    const result = left[sortKey].localeCompare(right[sortKey]);
    if (result !== 0) return direction === 'desc' ? -result : result;
  } else {
    const leftScore = sortKey === 'rank' ? left.rank : left.ratePercent;
    const rightScore = sortKey === 'rank' ? right.rank : right.ratePercent;
    if (leftScore !== rightScore) return direction === 'desc' ? rightScore - leftScore : leftScore - rightScore;
  }

  return left.rank - right.rank;
}

function formatFundingRate(value: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${formatCompactDecimal(value)}%`;
}

function formatCompactDecimal(value: number): string {
  return value.toFixed(Math.abs(value) >= 10 ? 1 : 2).replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
}

function formatFundingInterval(interval: FundingInterval): string {
  return interval === '30_min' ? '30m' : '4h';
}

function fundingRateClass(value: number): string {
  if (value > 0) return 'text-emerald-300';
  if (value < 0) return 'text-rose-300';
  return 'text-slate-300';
}

function copyCoin(coin: string): void {
  void navigator.clipboard?.writeText(coin);
}
