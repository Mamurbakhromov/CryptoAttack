import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import type { ExchangeMarket, NormalizedEvent } from '../types';
import { getCoinClassificationClasses, getCoinClassificationFilterLabel, isCoinClassificationFilterActive, matchesCoinClassificationFilter, type CoinClassificationFilter } from '../coinClassification';
import { ExchangeChips, getCoinExchangeChips, type ExchangeAvailabilityByMarket } from './ExchangeChips';
import { formatMoney, formatTime } from './format';
import { BsHistoryChart, BsHistoryDetailsTable, buildRatioAverages, formatAverageRatio, type RatioAverage, type RatioHistoryHit } from './BsHistoryPanel';
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
  maxRows?: number | null;
  historyWindowStart?: string | Date | undefined;
  historyWindowEnd?: string | Date | undefined;
}

type TopTableSortKey = 'hits' | 'ratio' | 'avgRatio' | 'delta' | 'percent';
type SortDirection = 'asc' | 'desc';
type RatioMode = 'buy-sell' | 'sell-buy';

export function TopTable({ title, subtitle, event, historyEvents = [], comparisonHistoryEvents = [], market, exchangeAvailability, classificationFilter, performanceTrends, hoveredCoin = null, onCoinHover, highlighted, compact = false, maxRows = 10, historyWindowStart, historyWindowEnd }: TopTableProps) {
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
  const renderedEntries = maxRows === null ? entries : entries.slice(0, maxRows);
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
              {renderedEntries.map((entry, index) => {
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
      {selectedCoin ? createPortal(
        <BsHistoryModal
          coin={selectedCoin}
          hits={selectedHistory}
          comparisonHits={selectedComparisonHistory}
          ratioLabel={ratioLabel}
          comparisonRatioLabel={comparisonRatioLabel}
          historyWindowStart={historyWindowStart}
          historyWindowEnd={historyWindowEnd}
          onClose={() => setSelectedCoin(null)}
        />
      , document.body) : null}
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

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function BsHistoryModal({ coin, hits, comparisonHits, ratioLabel, comparisonRatioLabel, historyWindowStart, historyWindowEnd, onClose }: { coin: string; hits: RatioHistoryHit[]; comparisonHits: RatioHistoryHit[]; ratioLabel: string; comparisonRatioLabel: string; historyWindowStart?: string | Date | undefined; historyWindowEnd?: string | Date | undefined; onClose: () => void }) {
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
                <BsHistoryChart
                  coin={coin}
                  hits={hits}
                  comparisonHits={comparisonHits}
                  ratioLabel={ratioLabel}
                  comparisonRatioLabel={comparisonRatioLabel}
                  windowStart={historyWindowStart}
                  windowEnd={historyWindowEnd}
                />
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
