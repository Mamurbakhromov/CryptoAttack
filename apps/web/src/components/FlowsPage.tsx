import { useState } from 'react';

import { getCoinClassificationClasses, getCoinClassificationFilterLabel, isCoinClassificationFilterActive, matchesCoinClassificationFilter, type CoinClassificationFilter } from '../coinClassification';
import type { DashboardSnapshot, NormalizedEvent, ParsedTopEntry } from '../types';
import { formatTime } from './format';
import { PerformanceTrendChips, type PerformanceTrendByCoin } from './PerformanceTrendChips';
import { RawEventPanel } from './RawEventPanel';

interface FlowsPageProps {
  snapshot: DashboardSnapshot;
  highlightedIds: Set<string>;
  classificationFilter: CoinClassificationFilter;
  performanceTrends: PerformanceTrendByCoin;
}

type FlowDirection = 'inflow' | 'outflow';
type FlowSortKey = 'time' | 'amount';
type SortDirection = 'asc' | 'desc';

interface FlowRow {
  event: NormalizedEvent;
  coin: string | null;
  exchange: string | null;
  direction: FlowDirection;
  amountValue: number | null;
  href: string | null;
}

export function FlowsPage({ snapshot, highlightedIds, classificationFilter, performanceTrends }: FlowsPageProps) {
  const [hoveredCoin, setHoveredCoin] = useState<string | null>(null);
  const flowAlertEvents = snapshot.feeds.flows_alert.events;
  const flowRows = flowAlertEvents
    .flatMap(flattenFlowRows)
    .filter((row): row is FlowRow => row !== null)
    .filter((row) => matchesCoinClassificationFilter(row.coin, classificationFilter));
  const inflowRows = flowRows.filter((row) => row.direction === 'inflow');
  const outflowRows = flowRows.filter((row) => row.direction === 'outflow');
  const showRawFallback = flowAlertEvents.length > 0 && flowRows.length === 0;

  return (
    <main className="mx-auto grid max-w-[1800px] gap-3 px-4 py-3 md:px-6">
      <section className="page-hero flows">
        <h1>Flows</h1>
        <span>Compact onchain flow tables with the same ranked dashboard UX as the market pages</span>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <FlowTable
          title="Onchain Inflows"
          subtitle="cex_alerts/flows_alert · recent CEX inflows"
          rows={inflowRows}
          highlightedIds={highlightedIds}
          hoveredCoin={hoveredCoin}
          onCoinHover={setHoveredCoin}
          performanceTrends={performanceTrends}
          emptyState={getFlowEmptyState('inflow', classificationFilter)}
        />
        <FlowTable
          title="Onchain Outflows"
          subtitle="cex_alerts/flows_alert · recent CEX outflows"
          rows={outflowRows}
          highlightedIds={highlightedIds}
          hoveredCoin={hoveredCoin}
          onCoinHover={setHoveredCoin}
          performanceTrends={performanceTrends}
          emptyState={getFlowEmptyState('outflow', classificationFilter)}
        />
      </section>

      {showRawFallback ? <RawEventPanel title="Latest raw flow events" events={flowAlertEvents.slice(0, 2)} compact /> : null}
    </main>
  );
}

function FlowTable({
  title,
  subtitle,
  rows,
  highlightedIds,
  hoveredCoin,
  onCoinHover,
  performanceTrends,
  emptyState
}: {
  title: string;
  subtitle: string;
  rows: FlowRow[];
  highlightedIds: Set<string>;
  hoveredCoin: string | null;
  onCoinHover: (coin: string | null) => void;
  performanceTrends: PerformanceTrendByCoin;
  emptyState: string;
}) {
  const [sort, setSort] = useState<{ key: FlowSortKey; direction: SortDirection }>({ key: 'time', direction: 'desc' });
  const sortedRows = [...rows].sort((left, right) => compareFlowRows(left, right, sort.key, sort.direction));
  const sortButton = (key: FlowSortKey, label: string) => {
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
    <section className="panel min-h-[340px]">
      <div className="panel-header">
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        <span className="count-pill">{rows.length}</span>
      </div>

      {sortedRows.length ? (
        <div className="overflow-x-auto rounded-2xl border border-slate-800/80">
          <table className="w-full min-w-[760px] table-fixed text-left text-[11px] xl:text-xs 2xl:text-sm">
            <thead className="bg-slate-950/70 text-[9px] uppercase tracking-[0.12em] text-slate-500 xl:text-[10px]">
              <tr>
                <th className="w-[15%] px-1.5 py-2">{sortButton('time', 'Time')}</th>
                <th className="w-[21%] px-1.5 py-2">Coin</th>
                <th className="w-[18%] px-1.5 py-2">Exchange</th>
                <th className="w-[14%] px-1.5 py-2">Flow</th>
                <th className="w-[18%] px-1.5 py-2">{sortButton('amount', 'Amount')}</th>
                <th className="w-[14%] px-1.5 py-2">Tx</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.slice(0, 18).map((row) => {
                const classificationClasses = getCoinClassificationClasses(row.coin);
                const isLinked = Boolean(row.coin && row.coin === hoveredCoin);
                const highlighted = highlightedIds.has(row.event.id);
                return (
                  <tr
                    className={`classification-row border-t border-slate-800/70 ${classificationClasses} ${isLinked ? 'linked-coin-row' : ''} ${highlighted ? 'event-flash' : ''}`}
                    key={`${row.event.id}-${row.coin}-${row.direction}`}
                    onMouseEnter={() => onCoinHover(row.coin)}
                    onMouseLeave={() => onCoinHover(null)}
                    onFocus={() => onCoinHover(row.coin)}
                    onBlur={() => onCoinHover(null)}
                  >
                    <td className="px-1.5 py-2 font-black text-slate-500">{formatTime(row.event.receivedAt)}</td>
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
                    <td className="px-1.5 py-2 font-bold text-slate-200">{row.exchange ?? '-'}</td>
                    <td className="px-1.5 py-2">
                      <span className={`cex-action-badge ${row.direction === 'inflow' ? 'buying' : 'selling'}`}>{row.direction === 'inflow' ? 'Inflow' : 'Outflow'}</span>
                    </td>
                    <td className={`px-1.5 py-2 font-bold ${row.direction === 'inflow' ? 'text-emerald-300' : 'text-rose-300'}`}>{formatUsdAmount(row.amountValue)}</td>
                    <td className="px-1.5 py-2 font-bold text-cyan-100">
                      {row.href ? (
                        <a className="table-link" href={row.href} rel="noreferrer noopener" target="_blank">
                          HashTx
                        </a>
                      ) : (
                        '-'
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-state">{emptyState}</div>
      )}
    </section>
  );
}

function flattenFlowRows(event: NormalizedEvent): Array<FlowRow | null> {
  return event.entries.map((entry) => toFlowRow(event, entry));
}

function toFlowRow(event: NormalizedEvent, entry: ParsedTopEntry): FlowRow | null {
  if (!entry.coin) return null;
  if (entry.direction !== 'inflow' && entry.direction !== 'outflow') return null;

  return {
    event,
    coin: entry.coin,
    exchange: entry.exchange,
    direction: entry.direction,
    amountValue: entry.amountUsd,
    href: entry.href ?? null
  };
}

function getFlowEmptyState(direction: FlowDirection, classificationFilter: CoinClassificationFilter): string {
  if (!isCoinClassificationFilterActive(classificationFilter)) return `Waiting for ${direction} rows`;
  return `No ${direction} rows match ${getCoinClassificationFilterLabel(classificationFilter)}`;
}

function compareFlowRows(left: FlowRow, right: FlowRow, sortKey: FlowSortKey, direction: SortDirection): number {
  const leftScore = getFlowSortScore(left, sortKey);
  const rightScore = getFlowSortScore(right, sortKey);

  if (leftScore === null && rightScore !== null) return 1;
  if (leftScore !== null && rightScore === null) return -1;
  if (leftScore !== null && rightScore !== null && leftScore !== rightScore) {
    return direction === 'desc' ? rightScore - leftScore : leftScore - rightScore;
  }

  return Date.parse(right.event.receivedAt) - Date.parse(left.event.receivedAt);
}

function getFlowSortScore(row: FlowRow, sortKey: FlowSortKey): number | null {
  if (sortKey === 'time') return Date.parse(row.event.receivedAt);
  return finiteScore(row.amountValue);
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
