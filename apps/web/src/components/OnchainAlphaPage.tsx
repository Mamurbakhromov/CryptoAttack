import { useState } from 'react';

import { getCoinClassificationClasses, getCoinClassificationFilterLabel, isCoinClassificationFilterActive, matchesCoinClassificationFilter, type CoinClassificationFilter } from '../coinClassification';
import type { DashboardSnapshot, NormalizedEvent, ParsedTopEntry } from '../types';
import { formatTime } from './format';
import { PerformanceTrendChips, type PerformanceTrendByCoin } from './PerformanceTrendChips';
import { RawEventPanel } from './RawEventPanel';

interface OnchainAlphaPageProps {
  snapshot: DashboardSnapshot;
  highlightedIds: Set<string>;
  classificationFilter: CoinClassificationFilter;
  performanceTrends: PerformanceTrendByCoin;
}

type FlowDirection = 'inflow' | 'outflow';
type FlowWindow = '24h' | '1h';
type OnchainSortKey = 'coin' | 'amount';
type SortDirection = 'asc' | 'desc';

interface OnchainFlowRow {
  event: NormalizedEvent;
  coin: string | null;
  direction: FlowDirection;
  window: FlowWindow;
  amountValue: number | null;
  context: string;
}

interface OnchainSnapshot {
  event: NormalizedEvent;
  rows: OnchainFlowRow[];
}

export function OnchainAlphaPage({ snapshot, highlightedIds, classificationFilter, performanceTrends }: OnchainAlphaPageProps) {
  const [hoveredCoin, setHoveredCoin] = useState<string | null>(null);
  const snapshot24hIn = getLatestOnchainSnapshot(snapshot.feeds.onchain_24_all_flows.events, '24h', 'inflow');
  const snapshot24hOut = getLatestOnchainSnapshot(snapshot.feeds.onchain_24_all_flows.events, '24h', 'outflow');
  const snapshot1hIn = getLatestOnchainSnapshot(snapshot.feeds.onchain_1_all_flows.events, '1h', 'inflow');
  const snapshot1hOut = getLatestOnchainSnapshot(snapshot.feeds.onchain_1_all_flows.events, '1h', 'outflow');
  const rawFallbackEvents = [snapshot24hIn, snapshot24hOut, snapshot1hIn, snapshot1hOut]
    .filter((item): item is OnchainSnapshot => item !== null)
    .filter((item) => item.rows.length === 0)
    .map((item) => item.event);

  return (
    <main className="mx-auto grid max-w-[1800px] gap-3 px-4 py-3 md:px-6">
      <section className="page-hero onchain-alpha">
        <h1>Onchain / Alpha</h1>
        <span>Latest 1h and 24h onchain snapshots split into inflow and outflow for faster browsing</span>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <OnchainFlowTable
          title="24h Inflows"
          subtitle="onchain/24_all_flows · latest inflow snapshot"
          snapshot={snapshot24hIn}
          highlightedIds={highlightedIds}
          hoveredCoin={hoveredCoin}
          onCoinHover={setHoveredCoin}
          performanceTrends={performanceTrends}
          classificationFilter={classificationFilter}
          emptyState={getOnchainEmptyState('24h', 'inflow', classificationFilter)}
        />
        <OnchainFlowTable
          title="24h Outflows"
          subtitle="onchain/24_all_flows · latest outflow snapshot"
          snapshot={snapshot24hOut}
          highlightedIds={highlightedIds}
          hoveredCoin={hoveredCoin}
          onCoinHover={setHoveredCoin}
          performanceTrends={performanceTrends}
          classificationFilter={classificationFilter}
          emptyState={getOnchainEmptyState('24h', 'outflow', classificationFilter)}
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <OnchainFlowTable
          title="1h Inflows"
          subtitle="onchain/1_all_flows · latest inflow snapshot"
          snapshot={snapshot1hIn}
          highlightedIds={highlightedIds}
          hoveredCoin={hoveredCoin}
          onCoinHover={setHoveredCoin}
          performanceTrends={performanceTrends}
          classificationFilter={classificationFilter}
          emptyState={getOnchainEmptyState('1h', 'inflow', classificationFilter)}
        />
        <OnchainFlowTable
          title="1h Outflows"
          subtitle="onchain/1_all_flows · latest outflow snapshot"
          snapshot={snapshot1hOut}
          highlightedIds={highlightedIds}
          hoveredCoin={hoveredCoin}
          onCoinHover={setHoveredCoin}
          performanceTrends={performanceTrends}
          classificationFilter={classificationFilter}
          emptyState={getOnchainEmptyState('1h', 'outflow', classificationFilter)}
        />
      </section>

      {rawFallbackEvents.length ? <RawEventPanel title="Latest raw onchain flow events" events={rawFallbackEvents} compact /> : null}
    </main>
  );
}

function OnchainFlowTable({
  title,
  subtitle,
  snapshot,
  highlightedIds,
  hoveredCoin,
  onCoinHover,
  performanceTrends,
  classificationFilter,
  emptyState
}: {
  title: string;
  subtitle: string;
  snapshot: OnchainSnapshot | null;
  highlightedIds: Set<string>;
  hoveredCoin: string | null;
  onCoinHover: (coin: string | null) => void;
  performanceTrends: PerformanceTrendByCoin;
  classificationFilter: CoinClassificationFilter;
  emptyState: string;
}) {
  const [sort, setSort] = useState<{ key: OnchainSortKey; direction: SortDirection }>({ key: 'amount', direction: 'desc' });
  const baseRows = snapshot?.rows ?? [];
  const visibleRows = baseRows.filter((row) => matchesCoinClassificationFilter(row.coin, classificationFilter));
  const rows = [...visibleRows].sort((left, right) => compareOnchainRows(left, right, sort.key, sort.direction));
  const highlighted = Boolean(snapshot && highlightedIds.has(snapshot.event.id));
  const sortButton = (key: OnchainSortKey, label: string) => {
    const isActive = sort.key === key;
    const nextDirection = isActive && sort.direction === 'desc' ? 'asc' : 'desc';

    return (
      <button
        aria-label={`Sort by ${label} ${nextDirection}`}
        aria-pressed={isActive}
        className={`table-sort-button ${isActive ? 'active' : ''}`}
        type="button"
        onClick={() => setSort((current) => (current.key === key ? { key, direction: current.direction === 'desc' ? 'asc' : 'desc' } : { key, direction: key === 'coin' ? 'asc' : 'desc' }))}
      >
        <span>{label}</span>
        <span className="sort-indicator">{isActive ? (sort.direction === 'desc' ? 'v' : '^') : ''}</span>
      </button>
    );
  };

  return (
    <section className={`panel min-h-[340px] ${highlighted ? 'event-flash' : ''}`}>
      <div className="panel-header">
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        <span className="count-pill">{snapshot ? formatTime(snapshot.event.receivedAt) : 'Waiting'}</span>
      </div>

      {rows.length ? (
        <div className="overflow-x-auto rounded-2xl border border-slate-800/80">
          <table className="w-full min-w-[860px] table-fixed text-left text-[11px] xl:text-xs 2xl:text-sm">
            <thead className="bg-slate-950/70 text-[9px] uppercase tracking-[0.12em] text-slate-500 xl:text-[10px]">
              <tr>
                <th className="w-[8%] px-1.5 py-2">#</th>
                <th className="w-[20%] px-1.5 py-2">{sortButton('coin', 'Coin')}</th>
                <th className="w-[14%] px-1.5 py-2">Flow</th>
                <th className="w-[18%] px-1.5 py-2">{sortButton('amount', 'Amount')}</th>
                <th className="w-[40%] px-1.5 py-2">Context</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 18).map((row, index) => {
                const classificationClasses = getCoinClassificationClasses(row.coin);
                const isLinked = Boolean(row.coin && row.coin === hoveredCoin);
                return (
                  <tr
                    className={`classification-row border-t border-slate-800/70 ${classificationClasses} ${isLinked ? 'linked-coin-row' : ''}`}
                    key={`${row.event.id}-${row.coin}-${index}`}
                    onMouseEnter={() => onCoinHover(row.coin)}
                    onMouseLeave={() => onCoinHover(null)}
                    onFocus={() => onCoinHover(row.coin)}
                    onBlur={() => onCoinHover(null)}
                  >
                    <td className="px-1.5 py-2 font-black text-slate-500">{index + 1}</td>
                    <td className="px-1.5 py-2">
                      <span className="coin-cell">
                        {row.coin ? (
                          <button className="coin-button" type="button" onClick={() => copyText(row.coin!)}>
                            {row.coin}
                          </button>
                        ) : (
                          <span className="text-slate-500">Unknown</span>
                        )}
                        <PerformanceTrendChips coin={row.coin} trends={performanceTrends} />
                      </span>
                    </td>
                    <td className="px-1.5 py-2">
                      <span className={`cex-action-badge ${row.direction === 'inflow' ? 'buying' : 'selling'}`}>{row.direction === 'inflow' ? 'Inflow' : 'Outflow'}</span>
                    </td>
                    <td className={`px-1.5 py-2 font-bold ${row.direction === 'inflow' ? 'text-emerald-300' : 'text-rose-300'}`}>{formatUsdAmount(row.amountValue)}</td>
                    <td className="px-1.5 py-2 font-bold text-slate-300">{row.context}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : snapshot && baseRows.length === 0 ? (
        <div className="empty-state">Snapshot received, waiting for structured rows</div>
      ) : (
        <div className="empty-state">{emptyState}</div>
      )}
    </section>
  );
}

function getLatestOnchainSnapshot(events: NormalizedEvent[], window: FlowWindow, direction: FlowDirection): OnchainSnapshot | null {
  const event = events.find((candidate) => candidate.entries.some((entry) => entry.direction === direction)) ?? null;
  if (!event) return null;

  const rows = event.entries.flatMap((entry) => toOnchainFlowRow(event, entry, window, direction));
  return { event, rows };
}

function toOnchainFlowRow(event: NormalizedEvent, entry: ParsedTopEntry, window: FlowWindow, direction: FlowDirection): OnchainFlowRow[] {
  if (!entry.coin || entry.direction !== direction) return [];

  return [{
    event,
    coin: entry.coin,
    direction,
    window,
    amountValue: entry.amountUsd,
    context: extractHeaderContext(event.title)
  }];
}

function getOnchainEmptyState(window: FlowWindow, direction: FlowDirection, classificationFilter: CoinClassificationFilter): string {
  if (!isCoinClassificationFilterActive(classificationFilter)) return `Waiting for ${window} ${direction} snapshot`;
  return `No ${window} ${direction} rows match ${getCoinClassificationFilterLabel(classificationFilter)}`;
}

function extractHeaderContext(value: string): string {
  return value
    .replace(/^[^A-Za-z0-9#]+/, '')
    .replace(/#CEXFlows\d+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function compareOnchainRows(left: OnchainFlowRow, right: OnchainFlowRow, sortKey: OnchainSortKey, direction: SortDirection): number {
  if (sortKey === 'coin') {
    const result = (left.coin ?? '').localeCompare(right.coin ?? '');
    if (result !== 0) return direction === 'desc' ? -result : result;
  } else {
    const leftScore = finiteScore(left.amountValue);
    const rightScore = finiteScore(right.amountValue);
    if (leftScore === null && rightScore !== null) return 1;
    if (leftScore !== null && rightScore === null) return -1;
    if (leftScore !== null && rightScore !== null && leftScore !== rightScore) {
      return direction === 'desc' ? rightScore - leftScore : leftScore - rightScore;
    }
  }

  return (right.amountValue ?? 0) - (left.amountValue ?? 0);
}

function finiteScore(value: number | null | undefined): number | null {
  return Number.isFinite(value) ? (value as number) : null;
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

function copyText(value: string): void {
  void navigator.clipboard?.writeText(value);
}
