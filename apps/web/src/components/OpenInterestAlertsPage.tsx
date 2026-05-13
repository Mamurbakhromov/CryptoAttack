import { useState } from 'react';

import { getCoinClassificationClasses, getCoinClassificationFilterLabel, isCoinClassificationFilterActive, matchesCoinClassificationFilter, type CoinClassificationFilter } from '../coinClassification';
import type { DashboardSnapshot, NormalizedEvent } from '../types';
import { ExchangeChips, getCoinExchangeChips, type ExchangeAvailabilityByMarket } from './ExchangeChips';
import { formatDateTime, formatTime } from './format';
import { PerformanceTrendChips, type PerformanceTrendByCoin } from './PerformanceTrendChips';
import { RawEventPanel } from './RawEventPanel';
import { countCoinHitsLastHour, formatHitCount } from './topHits';

interface OpenInterestAlertsPageProps {
  snapshot: DashboardSnapshot;
  highlightedIds: Set<string>;
  exchangeAvailability: ExchangeAvailabilityByMarket;
  classificationFilter: CoinClassificationFilter;
  performanceTrends: PerformanceTrendByCoin;
}

type OiAlertBias = 'bull' | 'bear';
type OiAlertStage = 'trigger' | 'followup';
type OiAlertSortKey = 'time' | 'hits' | 'oi15' | 'oi30' | 'followup' | 'price' | 'alerts';
type SortDirection = 'asc' | 'desc';

interface OiAlertRow {
  event: NormalizedEvent;
  coin: string | null;
  exchange: string | null;
  primaryPercent: number | null;
  oiChange15mPercent: number | null;
  oiChange30mPercent: number | null;
  followupPriceChangePercent: number | null;
  priceUsd: number | null;
  totalAlerts: number | null;
  notifiedAt: string | null;
  stage: OiAlertStage;
  rawLine: string;
}

export function OpenInterestAlertsPage({ snapshot, highlightedIds, exchangeAvailability, classificationFilter, performanceTrends }: OpenInterestAlertsPageProps) {
  const [hoveredCoin, setHoveredCoin] = useState<string | null>(null);
  const oiAlertEvents = snapshot.feeds.oi_alerts.events;
  const parsedRows = oiAlertEvents
    .flatMap(flattenOiAlertRows)
    .filter((row) => matchesCoinClassificationFilter(row.coin, classificationFilter));
  const hasStructuredRows = parsedRows.length > 0;

  return (
    <main className="mx-auto grid max-w-[1800px] gap-3 px-4 py-3 md:px-6">
      <section className="page-hero oi-alerts">
        <h1>Open Interest Alerts</h1>
        <span>Triggers and follow-up moves in one ranked table with bull and bear signals together</span>
      </section>

      <section className="grid gap-4">
        <OiAlertsTable
          title="Open Interest Alerts"
          subtitle="signals/oi_alerts with trigger/follow-up stages and bull/bear bias"
          rows={parsedRows}
          allEvents={oiAlertEvents}
          highlightedIds={highlightedIds}
          exchangeAvailability={exchangeAvailability}
          performanceTrends={performanceTrends}
          hoveredCoin={hoveredCoin}
          onCoinHover={setHoveredCoin}
          emptyState={getOiEmptyState(classificationFilter)}
        />
      </section>

      {!hasStructuredRows && oiAlertEvents.length ? <RawEventPanel title="Latest raw OI alerts" events={oiAlertEvents} compact /> : null}
    </main>
  );
}

function OiAlertsTable({
  title,
  subtitle,
  rows,
  allEvents,
  highlightedIds,
  exchangeAvailability,
  performanceTrends,
  hoveredCoin,
  onCoinHover,
  emptyState
}: {
  title: string;
  subtitle: string;
  rows: OiAlertRow[];
  allEvents: NormalizedEvent[];
  highlightedIds: Set<string>;
  exchangeAvailability: ExchangeAvailabilityByMarket;
  performanceTrends: PerformanceTrendByCoin;
  hoveredCoin: string | null;
  onCoinHover: (coin: string | null) => void;
  emptyState: string;
}) {
  const [sort, setSort] = useState<{ key: OiAlertSortKey; direction: SortDirection }>({ key: 'time', direction: 'desc' });
  const referenceEvent = rows[0]?.event ?? allEvents[0] ?? null;
  const hitCounts = countCoinHitsLastHour(allEvents, referenceEvent);
  const sortedRows = [...rows].sort((left, right) => compareOiAlertRows(left, right, sort.key, sort.direction, hitCounts));
  const highlighted = rows.some((row) => highlightedIds.has(row.event.id));
  const sortButton = (key: OiAlertSortKey, label: string) => {
    const isActive = sort.key === key;
    const nextDirection = isActive && sort.direction === 'desc' ? 'asc' : 'desc';

    return (
      <button
        aria-label={`Sort by ${label} ${nextDirection}`}
        aria-pressed={isActive}
        className={`table-sort-button ${isActive ? 'active' : ''}`}
        type="button"
        onClick={() => setSort((current) => (current.key === key ? { key, direction: current.direction === 'desc' ? 'asc' : 'desc' } : { key, direction: key === 'time' ? 'desc' : 'desc' }))}
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
        <span className="count-pill">{rows.length ? `${rows.length} rows` : 'Waiting'}</span>
      </div>

      {sortedRows.length ? (
        <div className="overflow-x-auto rounded-2xl border border-slate-800/80">
          <table className="w-full min-w-[1320px] table-fixed text-left text-[11px] xl:text-xs 2xl:text-sm">
            <thead className="bg-slate-950/70 text-[9px] uppercase tracking-[0.12em] text-slate-500 xl:text-[10px]">
              <tr>
                <th className="w-[8%] px-1.5 py-2">{sortButton('time', 'Time')}</th>
                <th className="w-[14%] px-1.5 py-2">Coin</th>
                <th className="w-[8%] px-1.5 py-2">{sortButton('hits', '1h Hits')}</th>
                <th className="w-[11%] px-1.5 py-2">Exchange</th>
                <th className="w-[8%] px-1.5 py-2">Bias</th>
                <th className="w-[12%] px-1.5 py-2">Alert Type</th>
                <th className="w-[9%] px-1.5 py-2">{sortButton('oi15', 'OI 15m')}</th>
                <th className="w-[9%] px-1.5 py-2">{sortButton('oi30', 'OI 30m')}</th>
                <th className="w-[9%] px-1.5 py-2">{sortButton('followup', 'Follow-up')}</th>
                <th className="w-[8%] px-1.5 py-2">{sortButton('price', 'Price')}</th>
                <th className="w-[6%] px-1.5 py-2">{sortButton('alerts', 'Alerts')}</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.slice(0, 24).map((row) => {
                const classificationClasses = getCoinClassificationClasses(row.coin);
                const isLinked = Boolean(row.coin && row.coin === hoveredCoin);
                const exchangeChips = getCoinExchangeChips(row.coin, 'perpetual', exchangeAvailability, row.exchange);
                const bias = getOiAlertBias(row);
                return (
                  <tr
                    className={`classification-row border-t border-slate-800/70 ${classificationClasses} ${isLinked ? 'linked-coin-row' : ''} ${highlightedIds.has(row.event.id) ? 'event-flash' : ''}`}
                    key={`${row.event.id}-${row.rawLine}`}
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
                        <ExchangeChips chips={exchangeChips} />
                        <PerformanceTrendChips coin={row.coin} trends={performanceTrends} />
                      </span>
                    </td>
                    <td className="px-1.5 py-2 font-bold text-cyan-200">{formatHitCount(row.coin, hitCounts)}</td>
                    <td className="px-1.5 py-2 font-bold text-slate-300">{row.exchange ?? '-'}</td>
                    <td className="px-1.5 py-2">
                      <span className={`cex-action-badge ${bias === 'bull' ? 'buying' : bias === 'bear' ? 'selling' : 'activity'}`}>
                        {bias === 'bull' ? 'Bull' : bias === 'bear' ? 'Bear' : 'Flat'}
                      </span>
                    </td>
                    <td className="px-1.5 py-2">
                      <div className="flex flex-col gap-1">
                        <span className={`chip ${row.stage === 'followup' ? 'warn' : ''}`}>{row.stage === 'followup' ? 'Follow-up' : 'Trigger'}</span>
                        <span className="text-[10px] font-bold text-slate-400">{row.notifiedAt ? formatDateTime(row.notifiedAt) : '-'}</span>
                      </div>
                    </td>
                    <td className={`px-1.5 py-2 font-bold ${changeClass(row.oiChange15mPercent)}`}>{formatSignedPercent(row.oiChange15mPercent)}</td>
                    <td className={`px-1.5 py-2 font-bold ${changeClass(row.oiChange30mPercent ?? row.primaryPercent)}`}>{formatSignedPercent(row.oiChange30mPercent ?? row.primaryPercent)}</td>
                    <td className={`px-1.5 py-2 font-bold ${changeClass(row.followupPriceChangePercent)}`}>{formatSignedPercent(row.followupPriceChangePercent)}</td>
                    <td className="px-1.5 py-2 font-bold text-slate-200">{formatPrice(row.priceUsd)}</td>
                    <td className="px-1.5 py-2 font-bold text-amber-200">{formatAlertCount(row.totalAlerts)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : allEvents.length ? (
        <div className="empty-state">{emptyState}</div>
      ) : (
        <div className="empty-state">Waiting for first matching event</div>
      )}
    </section>
  );
}

function flattenOiAlertRows(event: NormalizedEvent): OiAlertRow[] {
  return event.entries.map((entry) => ({
    event,
    coin: entry.coin ?? event.coins[0] ?? null,
    exchange: entry.exchange,
    primaryPercent: entry.percent ?? null,
    oiChange15mPercent: entry.oiChange15mPercent ?? null,
    oiChange30mPercent: entry.oiChange30mPercent ?? null,
    followupPriceChangePercent: entry.followupPriceChangePercent ?? null,
    priceUsd: entry.priceUsd ?? null,
    totalAlerts: entry.totalAlerts ?? null,
    notifiedAt: entry.notifiedAt ?? null,
    stage: isFollowup(event) ? 'followup' : 'trigger',
    rawLine: entry.rawLine
  }));
}

function getOiEmptyState(classificationFilter: CoinClassificationFilter): string {
  if (!isCoinClassificationFilterActive(classificationFilter)) return 'Waiting for OI alerts';
  return `No OI alerts match ${getCoinClassificationFilterLabel(classificationFilter)}`;
}

function getOiAlertBias(row: OiAlertRow): OiAlertBias | null {
  const signal = row.oiChange30mPercent ?? row.oiChange15mPercent ?? row.primaryPercent ?? row.followupPriceChangePercent;
  if (!Number.isFinite(signal) || signal === 0) return null;
  return (signal as number) > 0 ? 'bull' : 'bear';
}

function compareOiAlertRows(
  left: OiAlertRow,
  right: OiAlertRow,
  sortKey: OiAlertSortKey,
  direction: SortDirection,
  hitCounts: Map<string, number>
): number {
  const leftScore = getOiAlertSortScore(left, sortKey, hitCounts);
  const rightScore = getOiAlertSortScore(right, sortKey, hitCounts);

  if (leftScore === null && rightScore !== null) return 1;
  if (leftScore !== null && rightScore === null) return -1;
  if (leftScore !== null && rightScore !== null && leftScore !== rightScore) {
    return direction === 'desc' ? rightScore - leftScore : leftScore - rightScore;
  }

  return Date.parse(right.event.receivedAt) - Date.parse(left.event.receivedAt);
}

function getOiAlertSortScore(row: OiAlertRow, sortKey: OiAlertSortKey, hitCounts: Map<string, number>): number | null {
  if (sortKey === 'time') return Date.parse(row.event.receivedAt);
  if (sortKey === 'hits') return row.coin ? hitCounts.get(row.coin) ?? 0 : null;
  if (sortKey === 'oi15') return finiteScore(row.oiChange15mPercent);
  if (sortKey === 'oi30') return finiteScore(row.oiChange30mPercent ?? row.primaryPercent);
  if (sortKey === 'followup') return finiteScore(row.followupPriceChangePercent);
  if (sortKey === 'price') return finiteScore(row.priceUsd);
  return finiteScore(row.totalAlerts);
}

function isFollowup(event: NormalizedEvent): boolean {
  return /\b(?:5\s*min(?:ute)?|1\s*hour)\s+price\s+change\s+after\s+notification\b/i.test(event.plainText);
}

function finiteScore(value: number | null | undefined): number | null {
  return Number.isFinite(value) ? (value as number) : null;
}

function formatSignedPercent(value: number | null | undefined): string {
  if (!Number.isFinite(value)) return '-';
  const finiteValue = value as number;
  return `${finiteValue > 0 ? '+' : ''}${finiteValue.toFixed(2)}%`;
}

function formatPrice(value: number | null | undefined): string {
  if (!Number.isFinite(value)) return '-';
  const finiteValue = value as number;
  const maximumFractionDigits = finiteValue >= 100 ? 2 : finiteValue >= 1 ? 4 : 8;
  return `$${new Intl.NumberFormat(undefined, { maximumFractionDigits }).format(finiteValue)}`;
}

function formatAlertCount(value: number | null | undefined): string {
  return Number.isFinite(value) ? String(value) : '-';
}

function changeClass(value: number | null | undefined): string {
  if (!Number.isFinite(value) || value === 0) return 'text-slate-300';
  return (value as number) > 0 ? 'text-emerald-300' : 'text-rose-300';
}

function copyCoin(coin: string): void {
  void navigator.clipboard?.writeText(coin);
}
