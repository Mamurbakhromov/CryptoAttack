import { type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, useEffect, useState } from 'react';

import type { ExchangeMarket, NormalizedEvent } from '../types';
import { getCoinClassificationClasses, getCoinClassificationFilterLabel, isCoinClassificationFilterActive, matchesCoinClassificationFilter, type CoinClassificationFilter } from '../coinClassification';
import { ExchangeChips, getCoinExchangeChips, type ExchangeAvailabilityByMarket } from './ExchangeChips';
import { formatMoney, formatTime } from './format';
import { PerformanceTrendChips, type PerformanceTrendByCoin } from './PerformanceTrendChips';
import { RawEventPanel } from './RawEventPanel';
import { countCoinHitsLastHour, formatHitCount } from './topHits';

interface TopTableProps {
  title: string;
  subtitle: string;
  event: NormalizedEvent | null;
  historyEvents?: NormalizedEvent[];
  comparisonHistoryEvents?: NormalizedEvent[];
  market: ExchangeMarket;
  exchangeAvailability: ExchangeAvailabilityByMarket;
  classificationFilter: CoinClassificationFilter;
  performanceTrends: PerformanceTrendByCoin;
  hoveredCoin?: string | null;
  onCoinHover?: (coin: string | null) => void;
  highlighted: boolean;
  compact?: boolean;
}

type TopTableSortKey = 'hits' | 'ratio' | 'avgRatio' | 'delta' | 'percent';
type SortDirection = 'asc' | 'desc';
type RatioMode = 'buy-sell' | 'sell-buy';
const HISTORY_WINDOW_MS = 60 * 60 * 1_000;

interface RatioHistoryHit {
  eventId: string;
  receivedAt: string;
  title: string;
  feedKey: string;
  rank: number | null;
  coin: string;
  exchange: string | null;
  buyUsd: number | null;
  sellUsd: number | null;
  deltaUsd: number | null;
  buySellRatio: number | null;
  displayRatio: number;
  percent: number | null;
  volume24hUsd: number | null;
  rawLine: string;
}

interface RatioAverage {
  average: number;
  count: number;
}

interface RatioChartPoint {
  x: number;
  y: number;
  time: number;
  ratio: number;
  signedRatio: number;
  label: string;
  side: 'bull' | 'bear';
}

interface RatioChartRollingPoint {
  x: number;
  y: number;
  time: number;
  ratio: number;
}

interface RatioChartData {
  points: RatioChartPoint[];
  rollingPoints: RatioChartRollingPoint[];
  startLabel: string;
  endLabel: string;
  maxRatioLabel: string;
  midRatioLabel: string;
  positiveMidY: number;
  negativeMidY: number;
}

export function TopTable({ title, subtitle, event, historyEvents = [], comparisonHistoryEvents = [], market, exchangeAvailability, classificationFilter, performanceTrends, hoveredCoin = null, onCoinHover, highlighted, compact = false }: TopTableProps) {
  const [sort, setSort] = useState<{ key: TopTableSortKey; direction: SortDirection }>({ key: 'ratio', direction: 'desc' });
  const rawEntries = event?.entries ?? [];
  const visibleEntries = rawEntries.filter((entry) => matchesCoinClassificationFilter(entry.coin, classificationFilter));
  const sourceEvents = historyEvents.length ? historyEvents : event ? [event] : [];
  const hitCounts = countCoinHitsLastHour(sourceEvents, event);
  const ratioMode: RatioMode = event?.entries[0]?.direction === 'sell' ? 'sell-buy' : 'buy-sell';
  const isSellTable = ratioMode === 'sell-buy';
  const ratioHistories = buildRatioHistoriesLastHour(sourceEvents, event, ratioMode);
  const comparisonRatioMode: RatioMode = isSellTable ? 'buy-sell' : 'sell-buy';
  const comparisonRatioHistories = buildRatioHistoriesLastHour(comparisonHistoryEvents, event, comparisonRatioMode);
  const ratioAverages = buildRatioAverages(ratioHistories);
  const [selectedCoin, setSelectedCoin] = useState<string | null>(null);
  const entries = [...visibleEntries].sort((left, right) => compareTopEntries(left, right, sort.key, sort.direction, ratioMode, hitCounts, ratioAverages));
  const ratioLabel = isSellTable ? 'S/B' : 'B/S';
  const comparisonRatioLabel = isSellTable ? 'B/S' : 'S/B';
  const selectedHistory = selectedCoin ? ratioHistories.get(selectedCoin) ?? [] : [];
  const selectedComparisonHistory = selectedCoin ? comparisonRatioHistories.get(selectedCoin) ?? [] : [];

  useEffect(() => {
    if (!selectedCoin) return;
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedCoin(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [selectedCoin]);

  const sortButton = (key: TopTableSortKey, label: string) => {
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
    <section className={`panel ${compact ? 'min-h-[320px]' : 'min-h-[420px]'} ${highlighted ? 'event-flash' : ''}`}>
      <div className="panel-header">
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        <span className="count-pill">{event ? formatTime(event.receivedAt) : 'Waiting'}</span>
      </div>

      {entries.length ? (
        <div className="overflow-hidden rounded-2xl border border-slate-800/80">
          <table className="w-full table-fixed text-left text-[11px] xl:text-xs 2xl:text-sm">
            <thead className="bg-slate-950/70 text-[9px] uppercase tracking-[0.12em] text-slate-500 xl:text-[10px]">
              <tr>
                <th className="w-[4%] px-1.5 py-2">#</th>
                <th className="w-[13%] px-1.5 py-2">Coin</th>
                <th className="w-[7%] px-1.5 py-2">{sortButton('hits', '1h Hits')}</th>
                <th className="w-[12%] px-1.5 py-2">Buy</th>
                <th className="w-[12%] px-1.5 py-2">Sell</th>
                <th className="w-[8%] px-1.5 py-2">{sortButton('ratio', ratioLabel)}</th>
                <th className="w-[9%] px-1.5 py-2">{sortButton('avgRatio', `${ratioLabel} 3 Avg`)}</th>
                <th className="w-[12%] px-1.5 py-2">{sortButton('delta', 'Delta')}</th>
                <th className="w-[8%] px-1.5 py-2">{sortButton('percent', '%')}</th>
                <th className="w-[15%] px-1.5 py-2">Vol24</th>
              </tr>
            </thead>
            <tbody>
              {entries.slice(0, 10).map((entry, index) => {
                const classificationClasses = getCoinClassificationClasses(entry.coin);
                const isLinked = Boolean(entry.coin && entry.coin === hoveredCoin);
                const exchangeChips = getCoinExchangeChips(entry.coin, market, exchangeAvailability);
                const ratioAverage = entry.coin ? ratioAverages.get(entry.coin) ?? null : null;
                return (
                  <tr
                    className={`classification-row top-table-clickable-row border-t border-slate-800/70 ${classificationClasses} ${isLinked ? 'linked-coin-row' : ''}`}
                    key={`${event?.id}-${entry.rawLine}-${index}`}
                    role={entry.coin ? 'button' : undefined}
                    tabIndex={entry.coin ? 0 : undefined}
                    onClick={() => openRatioHistory(entry.coin, setSelectedCoin)}
                    onKeyDown={(event) => openRatioHistoryFromKey(event, entry.coin, setSelectedCoin)}
                    onMouseEnter={() => onCoinHover?.(entry.coin)}
                    onMouseLeave={() => onCoinHover?.(null)}
                    onFocus={() => onCoinHover?.(entry.coin)}
                    onBlur={() => onCoinHover?.(null)}
                  >
                    <td className="px-1.5 py-2 font-black text-slate-500">{entry.rank ?? index + 1}</td>
                    <td className="px-1.5 py-2">
                      <span className="coin-cell">
                        {entry.coin ? (
                          <span className="coin-button" title="Open B/S history">
                            {entry.coin}
                          </span>
                        ) : (
                          <span className="text-slate-500">Unknown</span>
                        )}
                        <ExchangeChips chips={exchangeChips} />
                        <PerformanceTrendChips coin={entry.coin} trends={performanceTrends} />
                      </span>
                    </td>
                    <td className="px-1.5 py-2 font-bold text-cyan-200">{formatHitCount(entry.coin, hitCounts)}</td>
                    <td className="px-1.5 py-2 font-bold text-slate-200">{formatOptionalMoney(entry.buyUsd)}</td>
                    <td className="px-1.5 py-2 font-bold text-slate-200">{formatOptionalMoney(entry.sellUsd)}</td>
                    <td className={`px-1.5 py-2 font-bold ${isSellTable ? 'text-rose-300' : 'text-emerald-300'}`}>
                      {formatEntryRatio(entry, ratioMode)}
                    </td>
                    <td className={`px-1.5 py-2 font-black ${isSellTable ? 'text-rose-200' : 'text-emerald-200'}`} title={formatAverageTitle(ratioAverage, ratioLabel)}>
                      {formatAverageRatio(ratioAverage)}
                    </td>
                    <td className={`px-1.5 py-2 font-bold ${isSellTable ? 'text-rose-200' : 'text-cyan-100'}`}>
                      {formatOptionalMoney(entry.deltaUsd)}
                    </td>
                    <td className="px-1.5 py-2 font-bold text-emerald-300">{formatPercent(entry.percent)}</td>
                    <td className="px-1.5 py-2 font-bold text-slate-300">{formatOptionalMoney(entry.volume24hUsd)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : event && rawEntries.length && isCoinClassificationFilterActive(classificationFilter) ? (
        <div className="empty-state">No coins match {getCoinClassificationFilterLabel(classificationFilter)} in this latest top 10</div>
      ) : event ? (
        <RawEventPanel title="Latest raw event" events={[event]} compact />
      ) : (
        <div className="empty-state">Waiting for first matching event</div>
      )}
      {selectedCoin ? (
        <BsHistoryModal coin={selectedCoin} hits={selectedHistory} comparisonHits={selectedComparisonHistory} ratioLabel={ratioLabel} comparisonRatioLabel={comparisonRatioLabel} onClose={() => setSelectedCoin(null)} />
      ) : null}
    </section>
  );
}

function formatOptionalMoney(value: number | null | undefined): string {
  return Number.isFinite(value) ? formatMoney(value) : '-';
}

function openRatioHistory(coin: string | null, setSelectedCoin: (coin: string) => void): void {
  if (coin) setSelectedCoin(coin);
}

function openRatioHistoryFromKey(event: ReactKeyboardEvent<HTMLTableRowElement>, coin: string | null, setSelectedCoin: (coin: string) => void): void {
  if (!coin || (event.key !== 'Enter' && event.key !== ' ')) return;
  event.preventDefault();
  setSelectedCoin(coin);
}

function formatRatio(value: number | null | undefined, mode: 'buy-sell' | 'sell-buy'): string {
  if (!Number.isFinite(value) || value === 0) return '-';
  const finiteValue = value as number;
  const ratio = mode === 'sell-buy' ? 1 / finiteValue : finiteValue;
  return `${ratio.toFixed(2)}x`;
}

function formatAverageRatio(value: RatioAverage | null): string {
  return value ? `${value.average.toFixed(2)}x` : '-';
}

function formatAverageTitle(value: RatioAverage | null, ratioLabel: string): string {
  if (!value) return `No ${ratioLabel} history in the last hour`;
  return `${ratioLabel} average from latest ${value.count} hit${value.count === 1 ? '' : 's'} in the last hour`;
}

function compareTopEntries(
  left: NormalizedEvent['entries'][number],
  right: NormalizedEvent['entries'][number],
  sortKey: TopTableSortKey,
  direction: SortDirection,
  ratioMode: 'buy-sell' | 'sell-buy',
  hitCounts: Map<string, number>,
  ratioAverages: Map<string, RatioAverage>
): number {
  const leftScore = getTopEntrySortScore(left, sortKey, ratioMode, hitCounts, ratioAverages);
  const rightScore = getTopEntrySortScore(right, sortKey, ratioMode, hitCounts, ratioAverages);

  if (leftScore === null && rightScore !== null) return 1;
  if (leftScore !== null && rightScore === null) return -1;
  if (leftScore !== null && rightScore !== null && leftScore !== rightScore) {
    return direction === 'desc' ? rightScore - leftScore : leftScore - rightScore;
  }

  const ratioFallback = entryRatioScore(right, ratioMode) - entryRatioScore(left, ratioMode);
  if (ratioFallback !== 0) return ratioFallback;

  return (left.rank ?? Number.MAX_SAFE_INTEGER) - (right.rank ?? Number.MAX_SAFE_INTEGER);
}

function getTopEntrySortScore(
  entry: NormalizedEvent['entries'][number],
  sortKey: TopTableSortKey,
  ratioMode: 'buy-sell' | 'sell-buy',
  hitCounts: Map<string, number>,
  ratioAverages: Map<string, RatioAverage>
): number | null {
  if (sortKey === 'hits') return entry.coin ? hitCounts.get(entry.coin) ?? 0 : null;
  if (sortKey === 'ratio') return finiteScore(entryRatioScore(entry, ratioMode));
  if (sortKey === 'avgRatio') return entry.coin ? finiteScore(ratioAverages.get(entry.coin)?.average) : null;
  if (sortKey === 'delta') return finiteScore(entry.deltaUsd);
  return finiteScore(entry.percent);
}

function finiteScore(value: number | null | undefined): number | null {
  return Number.isFinite(value) ? (value as number) : null;
}

function ratioScore(value: number | null | undefined, mode: 'buy-sell' | 'sell-buy'): number {
  if (!Number.isFinite(value) || value === 0) return Number.NEGATIVE_INFINITY;
  const finiteValue = value as number;
  return mode === 'sell-buy' ? 1 / finiteValue : finiteValue;
}

function entryRatioScore(entry: NormalizedEvent['entries'][number], mode: RatioMode): number {
  const parsedRatio = ratioScore(entry.buySellRatio, mode);
  if (Number.isFinite(parsedRatio)) return parsedRatio;
  if (!Number.isFinite(entry.buyUsd) || !Number.isFinite(entry.sellUsd) || entry.buyUsd === null || entry.sellUsd === null) return Number.NEGATIVE_INFINITY;
  if (entry.buyUsd <= 0 || entry.sellUsd <= 0) return Number.NEGATIVE_INFINITY;
  return mode === 'sell-buy' ? entry.sellUsd / entry.buyUsd : entry.buyUsd / entry.sellUsd;
}

function formatEntryRatio(entry: NormalizedEvent['entries'][number], mode: RatioMode): string {
  const value = entryRatioScore(entry, mode);
  return Number.isFinite(value) ? `${value.toFixed(2)}x` : '-';
}

function formatPercent(value: number | null | undefined): string {
  return Number.isFinite(value) ? `${value?.toFixed(2)}%` : '-';
}

function buildRatioHistoriesLastHour(events: NormalizedEvent[], referenceEvent: NormalizedEvent | null, ratioMode: RatioMode): Map<string, RatioHistoryHit[]> {
  const referenceMs = parseTime(referenceEvent?.receivedAt) ?? Date.now();
  const cutoffMs = referenceMs - 60 * 60 * 1_000;
  const histories = new Map<string, RatioHistoryHit[]>();

  for (const event of events) {
    const eventMs = parseTime(event.receivedAt);
    if (eventMs === null || eventMs < cutoffMs || eventMs > referenceMs) continue;

    for (const entry of event.entries) {
      if (!entry.coin) continue;
      const displayRatio = entryRatioScore(entry, ratioMode);
      if (!Number.isFinite(displayRatio)) continue;
      const hit: RatioHistoryHit = {
        eventId: event.id,
        receivedAt: event.receivedAt,
        title: event.title,
        feedKey: event.feedKey,
        rank: entry.rank,
        coin: entry.coin,
        exchange: entry.exchange,
        buyUsd: entry.buyUsd,
        sellUsd: entry.sellUsd,
        deltaUsd: entry.deltaUsd,
        buySellRatio: entry.buySellRatio,
        displayRatio,
        percent: entry.percent,
        volume24hUsd: entry.volume24hUsd,
        rawLine: entry.rawLine
      };
      histories.set(entry.coin, [...(histories.get(entry.coin) ?? []), hit]);
    }
  }

  for (const [coin, hits] of histories) {
    histories.set(coin, hits.sort((left, right) => Date.parse(right.receivedAt) - Date.parse(left.receivedAt)));
  }

  return histories;
}

function buildRatioAverages(histories: Map<string, RatioHistoryHit[]>): Map<string, RatioAverage> {
  const averages = new Map<string, RatioAverage>();
  for (const [coin, hits] of histories) {
    const latest = hits.slice(0, 3).map((hit) => hit.displayRatio).filter(Number.isFinite);
    if (!latest.length) continue;
    averages.set(coin, { average: latest.reduce((sum, value) => sum + value, 0) / latest.length, count: latest.length });
  }
  return averages;
}

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function BsHistoryModal({ coin, hits, comparisonHits, ratioLabel, comparisonRatioLabel, onClose }: { coin: string; hits: RatioHistoryHit[]; comparisonHits: RatioHistoryHit[]; ratioLabel: string; comparisonRatioLabel: string; onClose: () => void }) {
  const latestAverage = buildRatioAverages(new Map([[coin, hits]])).get(coin) ?? null;
  const [view, setView] = useState<'graph' | 'details'>('graph');
  return (
    <div className="bs-history-modal-backdrop" role="presentation" onClick={onClose}>
      <div className="bs-history-modal-shell" role="dialog" aria-modal="true" aria-labelledby="bs-history-title" onClick={(event) => event.stopPropagation()}>
        <button className="modal-close-button bs-history-close-button" type="button" aria-label="Close B/S history" onClick={onClose}>×</button>
        <section className="panel bs-history-modal">
          <div className="panel-header">
            <div>
              <h2 id="bs-history-title">{coin} {ratioLabel} History</h2>
              <p>Latest 1h hits in this same table source, with exact received time.</p>
            </div>
          </div>

          <div className="bs-history-summary">
            <span>{hits.length} hit{hits.length === 1 ? '' : 's'} in 1h</span>
            <strong>{ratioLabel} 3 Avg {formatAverageRatio(latestAverage)}</strong>
          </div>

          {hits.length ? (
            <div className="bs-history-view-tabs" role="tablist" aria-label="B/S history view">
              <button className={view === 'graph' ? 'active' : ''} type="button" role="tab" aria-selected={view === 'graph'} onClick={() => setView('graph')}>Graph</button>
              <button className={view === 'details' ? 'active' : ''} type="button" role="tab" aria-selected={view === 'details'} onClick={() => setView('details')}>Details</button>
            </div>
          ) : null}

          {hits.length ? (
            <div className={`bs-history-content ${view}`}>
              {view === 'graph' ? (
                <BsHistoryChart coin={coin} hits={hits} comparisonHits={comparisonHits} ratioLabel={ratioLabel} comparisonRatioLabel={comparisonRatioLabel} />
              ) : (
                <BsHistoryDetailsTable hits={hits} ratioLabel={ratioLabel} />
              )}
            </div>
          ) : <div className="empty-state">No {ratioLabel} hits found for {coin} in the latest 1h window.</div>}
        </section>
      </div>
    </div>
  );
}

function BsHistoryDetailsTable({ hits, ratioLabel }: { hits: RatioHistoryHit[]; ratioLabel: string }) {
  return (
    <div className="bs-history-table-panel">
      <div className="bs-history-table-title">
        <h3>Hits by time</h3>
        <span>Newest first</span>
      </div>
      <div className="bs-history-table-wrap">
        <table className="w-full text-left text-xs">
          <thead>
            <tr>
              <th>Time</th>
              <th>Buy</th>
              <th>Sell</th>
              <th>{ratioLabel}</th>
              <th>Vol24</th>
            </tr>
          </thead>
          <tbody>
            {hits.map((hit, index) => (
              <tr className={index < 3 ? 'latest-three' : ''} key={`${hit.eventId}-${hit.rawLine}-${index}`}>
                <td>{formatExactDateTime(hit.receivedAt)}</td>
                <td>{formatOptionalMoney(hit.buyUsd)}</td>
                <td>{formatOptionalMoney(hit.sellUsd)}</td>
                <td className="bs-history-ratio">{hit.displayRatio.toFixed(2)}x</td>
                <td>{formatOptionalMoney(hit.volume24hUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BsHistoryChart({ coin, hits, comparisonHits, ratioLabel, comparisonRatioLabel }: { coin: string; hits: RatioHistoryHit[]; comparisonHits: RatioHistoryHit[]; ratioLabel: string; comparisonRatioLabel: string }) {
  const chart = buildRatioChart(hits, comparisonHits, ratioLabel, comparisonRatioLabel);
  const [activePoint, setActivePoint] = useState<RatioChartPoint | null>(null);
  const barWidth = getChartBarWidth(chart.points);
  const latest = hits[0]?.displayRatio ?? null;
  const tooltipPosition = activePoint ? getChartTooltipPosition(activePoint) : null;

  const showNearestPoint = (event: ReactMouseEvent<SVGRectElement>) => {
    if (!chart.points.length) return;
    const fallbackPoint = chart.points[chart.points.length - 1];
    if (!fallbackPoint) return;
    const svgBounds = event.currentTarget.ownerSVGElement?.getBoundingClientRect();
    const x = svgBounds && svgBounds.width > 0
      ? ((event.clientX - svgBounds.left) / svgBounds.width) * 640
      : fallbackPoint.x;
    const closestPoint = getClosestChartPoint(chart.points, Math.max(56, Math.min(608, x)));
    if (closestPoint) setActivePoint(closestPoint);
  };

  return (
    <div className="bs-history-chart-card">
      <div className="bs-history-chart-head">
        <div>
          <h3>{ratioLabel} and {comparisonRatioLabel} trend</h3>
        </div>
        <strong>{latest === null ? '-' : `${latest.toFixed(2)}x`}</strong>
      </div>
      <div className="bs-history-chart-legend" aria-hidden="true">
        <span><i className="bull" />B/S positive</span>
        <span><i className="bear" />S/B negative</span>
        <span><i className="rolling" />Rolling 3 avg</span>
      </div>
      <svg className="bs-history-chart" viewBox="0 0 640 220" preserveAspectRatio="none" role="img" aria-label={`${coin} ${ratioLabel} and ${comparisonRatioLabel} ratio history bar chart from -${chart.maxRatioLabel} to ${chart.maxRatioLabel}`}>
        <line className="bs-history-chart-grid" x1="56" y1="24" x2="608" y2="24" />
        <line className="bs-history-chart-grid" x1="56" y1={chart.positiveMidY} x2="608" y2={chart.positiveMidY} />
        <line className="bs-history-chart-grid" x1="56" y1="96" x2="608" y2="96" />
        <line className="bs-history-chart-grid" x1="56" y1={chart.negativeMidY} x2="608" y2={chart.negativeMidY} />
        <line className="bs-history-chart-grid" x1="56" y1="168" x2="608" y2="168" />
        <line className="bs-history-chart-axis" x1="56" y1="24" x2="56" y2="168" />
        <line className="bs-history-chart-axis" x1="56" y1="168" x2="608" y2="168" />
        <line className="bs-history-chart-zero" x1="56" y1="96" x2="608" y2="96" />
        <text className="bs-history-chart-label" x="46" y="28" textAnchor="end">{chart.maxRatioLabel}</text>
        <text className="bs-history-chart-label" x="46" y={chart.positiveMidY + 4} textAnchor="end">{chart.midRatioLabel}</text>
        <text className="bs-history-chart-label" x="46" y="100" textAnchor="end">0</text>
        <text className="bs-history-chart-label" x="46" y={chart.negativeMidY + 4} textAnchor="end">-{chart.midRatioLabel}</text>
        <text className="bs-history-chart-label" x="46" y="172" textAnchor="end">-{chart.maxRatioLabel}</text>
        <text className="bs-history-chart-label bs-history-chart-time" x="56" y="198">{chart.startLabel}</text>
        <text className="bs-history-chart-label bs-history-chart-time" x="608" y="198" textAnchor="end">{chart.endLabel}</text>
        <text className="bs-history-chart-label" x="332" y="214" textAnchor="middle">Time</text>
        <text className="bs-history-chart-label" x="16" y="96" textAnchor="middle" transform="rotate(-90 16 96)">B/S positive, S/B negative</text>
        <rect className="bs-history-chart-hit-area" x="56" y="24" width="552" height="144" onMouseMove={showNearestPoint} onMouseLeave={() => setActivePoint(null)} />
        {chart.rollingPoints.length > 1 ? (
          <polyline className="bs-history-chart-rolling-line" points={chart.rollingPoints.map((point) => `${point.x},${point.y}`).join(' ')} />
        ) : null}
        {chart.points.map((point, index) => (
          <rect
            aria-label={`${formatAxisTime(point.time)} ${point.label} ${point.signedRatio.toFixed(2)}x`}
            className={`bs-history-chart-bar ${point.side} ${activePoint?.time === point.time && activePoint.label === point.label ? 'active' : ''}`}
            height={Math.abs(96 - point.y)}
            key={`${point.time}-${index}`}
            onBlur={() => setActivePoint(null)}
            onFocus={() => setActivePoint(point)}
            onMouseEnter={() => setActivePoint(point)}
            rx="5"
            tabIndex={0}
            width={barWidth}
            x={point.x - barWidth / 2}
            y={Math.min(point.y, 96)}
          >
            <title>{`${formatAxisTime(point.time)}: ${point.label} ${point.signedRatio.toFixed(2)}x`}</title>
          </rect>
        ))}
        {activePoint && tooltipPosition ? (
          <g className="bs-history-chart-hover">
            <line className="bs-history-chart-cursor" x1={activePoint.x} y1="24" x2={activePoint.x} y2="168" />
            <rect className={`bs-history-chart-hover-bar ${activePoint.side}`} x={activePoint.x - barWidth / 2} y={Math.min(activePoint.y, 96)} width={barWidth} height={Math.abs(96 - activePoint.y)} rx="5" />
            <g transform={`translate(${tooltipPosition.x} ${tooltipPosition.y})`}>
              <rect className="bs-history-chart-tooltip-bg" width="132" height="48" rx="10" />
              <text className="bs-history-chart-tooltip-time" x="12" y="18">{formatAxisTime(activePoint.time)}</text>
              <text className="bs-history-chart-tooltip-ratio" x="12" y="36">{activePoint.label} {activePoint.signedRatio.toFixed(2)}x</text>
            </g>
          </g>
        ) : null}
      </svg>
    </div>
  );
}

function buildRatioChart(hits: RatioHistoryHit[], comparisonHits: RatioHistoryHit[], ratioLabel: string, comparisonRatioLabel: string): RatioChartData {
  const primarySign = ratioLabel === 'S/B' ? -1 : 1;
  const comparisonSign = primarySign * -1;
  const primaryPoints = hits.map((hit) => ({ time: parseTime(hit.receivedAt), ratio: hit.displayRatio, signedRatio: primarySign * hit.displayRatio, label: ratioLabel, side: primarySign > 0 ? 'bull' as const : 'bear' as const }));
  const ordered = [
    ...primaryPoints,
    ...comparisonHits.map((hit) => ({ time: parseTime(hit.receivedAt), ratio: hit.displayRatio, signedRatio: comparisonSign * hit.displayRatio, label: comparisonRatioLabel, side: comparisonSign > 0 ? 'bull' as const : 'bear' as const }))
  ]
    .filter((point): point is { time: number; ratio: number; signedRatio: number; label: string; side: 'bull' | 'bear' } => point.time !== null && Number.isFinite(point.ratio))
    .sort((left, right) => left.time - right.time);
  const maxTime = ordered.at(-1)?.time ?? Date.now();
  const minTime = maxTime - HISTORY_WINDOW_MS;
  const timeRange = HISTORY_WINDOW_MS;
  const maxRatio = Math.max(3, ...ordered.map((point) => point.ratio));
  const ratioScaleMax = maxRatio > 3 ? Math.ceil(maxRatio) : 3;
  const points = ordered.map((point) => {
    const x = ordered.length === 1 ? 608 : 56 + ((point.time - minTime) / timeRange) * 552;
    const ratio = Math.max(0, Math.min(ratioScaleMax, point.ratio));
    const y = 96 - ((point.signedRatio < 0 ? -ratio : ratio) / ratioScaleMax) * 72;
    return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, time: point.time, ratio: point.ratio, signedRatio: point.signedRatio, label: point.label, side: point.side };
  });
  const rollingPoints = buildRollingPoints(primaryPoints, minTime, timeRange, ratioScaleMax);

  return {
    points,
    rollingPoints,
    startLabel: formatAxisTime(minTime),
    endLabel: formatAxisTime(maxTime),
    maxRatioLabel: formatRatioAxisTick(ratioScaleMax),
    midRatioLabel: '1.5',
    positiveMidY: ratioAxisY(1.5, ratioScaleMax),
    negativeMidY: ratioAxisY(-1.5, ratioScaleMax)
  };
}

function buildRollingPoints(
  points: Array<{ time: number | null; ratio: number; signedRatio: number }>,
  minTime: number,
  timeRange: number,
  ratioScaleMax: number
): RatioChartRollingPoint[] {
  return points
    .filter((point): point is { time: number; ratio: number; signedRatio: number } => point.time !== null && Number.isFinite(point.ratio))
    .sort((left, right) => left.time - right.time)
    .map((point, index, orderedPoints) => {
      const window = orderedPoints.slice(Math.max(0, index - 2), index + 1);
      const average = window.reduce((sum, item) => sum + item.signedRatio, 0) / window.length;
      const x = orderedPoints.length === 1 ? 608 : 56 + ((point.time - minTime) / timeRange) * 552;
      const clampedAverage = Math.max(-ratioScaleMax, Math.min(ratioScaleMax, average));
      const y = 96 - (clampedAverage / ratioScaleMax) * 72;
      return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, time: point.time, ratio: Math.abs(average) };
    });
}

function ratioAxisY(value: number, scaleMax: number): number {
  return Math.round((96 - (value / scaleMax) * 72) * 10) / 10;
}

function getChartBarWidth(points: RatioChartPoint[]): number {
  if (points.length <= 1) return 42;
  const minGap = points.slice(1).reduce((smallestGap, point, index) => {
    const previousPoint = points[index];
    if (!previousPoint) return smallestGap;
    return Math.min(smallestGap, Math.abs(point.x - previousPoint.x));
  }, Number.POSITIVE_INFINITY);
  return Math.max(8, Math.min(42, minGap * 0.58));
}

function getClosestChartPoint(points: RatioChartPoint[], x: number): RatioChartPoint | null {
  const firstPoint = points[0];
  if (!firstPoint) return null;
  return points.slice(1).reduce((closest, point) => (Math.abs(point.x - x) < Math.abs(closest.x - x) ? point : closest), firstPoint);
}

function getChartTooltipPosition(point: RatioChartPoint): { x: number; y: number } {
  const width = 132;
  const height = 48;
  const x = Math.min(608 - width, Math.max(56, point.x - width / 2));
  const preferredY = point.y < 82 ? point.y + 14 : point.y - height - 14;
  const y = Math.min(168 - height, Math.max(24, preferredY));
  return { x: Math.round(x), y: Math.round(y) };
}

function formatRatioAxisTick(value: number): string {
  return Number.isInteger(value) ? value.toString() : value.toFixed(1);
}

function formatAxisTime(value: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function formatExactDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Unknown';
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(parsed);
}

function copyText(value: string): void {
  void navigator.clipboard?.writeText(value);
}
