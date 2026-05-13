import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useState } from 'react';

import { getCoinClassificationClasses, getCoinClassificationFilterLabel, isCoinClassificationFilterActive, matchesCoinClassificationFilter, type CoinClassificationFilter } from '../coinClassification';
import type { NormalizedEvent } from '../types';
import { ExchangeChips, getCoinExchangeChips, type ExchangeAvailabilityByMarket } from './ExchangeChips';
import { formatTime } from './format';
import { PerformanceTrendChips, type PerformanceTrendByCoin } from './PerformanceTrendChips';
import { RawEventPanel } from './RawEventPanel';
import { countCoinHitsLastHour, formatHitCount } from './topHits';

interface OiTopTableProps {
  title: string;
  subtitle: string;
  event: NormalizedEvent | null;
  historyEvents?: NormalizedEvent[];
  exchangeAvailability: ExchangeAvailabilityByMarket;
  classificationFilter: CoinClassificationFilter;
  performanceTrends: PerformanceTrendByCoin;
  hoveredCoin?: string | null;
  onCoinHover?: (coin: string | null) => void;
  highlighted: boolean;
}

interface OiHistoryHit {
  eventId: string;
  receivedAt: string;
  title: string;
  rank: number | null;
  coin: string;
  exchange: string | null;
  oiChangePercent: number | null;
  priceUsd: number | null;
  priceChangePercent: number | null;
  rawLine: string;
}

interface OiChartPoint {
  x: number;
  oiY: number;
  priceY: number | null;
  time: number;
  oiChangePercent: number | null;
  priceChangePercent: number | null;
}

interface OiChartData {
  points: OiChartPoint[];
  rollingPricePoints: Array<{ x: number; y: number; time: number; value: number }>;
  startLabel: string;
  endLabel: string;
  maxPercentLabel: string;
  midPercentLabel: string;
  positiveMidY: number;
  negativeMidY: number;
}

const HISTORY_WINDOW_MS = 60 * 60 * 1_000;

export function OiTopTable({ title, subtitle, event, historyEvents = [], exchangeAvailability, classificationFilter, performanceTrends, hoveredCoin = null, onCoinHover, highlighted }: OiTopTableProps) {
  const [selectedCoin, setSelectedCoin] = useState<string | null>(null);
  const rawEntries = event?.entries ?? [];
  const entries = rawEntries.filter((entry) => matchesCoinClassificationFilter(entry.coin, classificationFilter));
  const sourceEvents = historyEvents.length ? historyEvents : event ? [event] : [];
  const hitCounts = countCoinHitsLastHour(sourceEvents, event);
  const oiHistories = buildOiHistoriesLastHour(sourceEvents, event);
  const selectedHistory = selectedCoin ? oiHistories.get(selectedCoin) ?? [] : [];
  const isLoserTable = entries[0]?.direction === 'loser';

  useEffect(() => {
    if (!selectedCoin) return;
    const closeOnEscape = (keyboardEvent: globalThis.KeyboardEvent) => {
      if (keyboardEvent.key === 'Escape') setSelectedCoin(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [selectedCoin]);

  const openHistoryFromKeyboard = (keyboardEvent: ReactKeyboardEvent<HTMLTableRowElement>, coin: string | null | undefined) => {
    if (!coin || (keyboardEvent.key !== 'Enter' && keyboardEvent.key !== ' ')) return;
    keyboardEvent.preventDefault();
    setSelectedCoin(coin);
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

      {entries.length ? (
        <div className="overflow-hidden rounded-2xl border border-slate-800/80">
          <table className="w-full table-fixed text-left text-[11px] xl:text-xs 2xl:text-sm">
            <thead className="bg-slate-950/70 text-[9px] uppercase tracking-[0.12em] text-slate-500 xl:text-[10px]">
              <tr>
                <th className="w-[5%] px-1.5 py-2">#</th>
                <th className="w-[16%] px-1.5 py-2">Coin</th>
                <th className="w-[10%] px-1.5 py-2">1h Hits</th>
                <th className="w-[18%] px-1.5 py-2">Exchange</th>
                <th className="w-[17%] px-1.5 py-2">OI Change</th>
                <th className="w-[17%] px-1.5 py-2">Price</th>
                <th className="w-[17%] px-1.5 py-2">Price %</th>
              </tr>
            </thead>
            <tbody>
              {entries.slice(0, 10).map((entry, index) => {
                const classificationClasses = getCoinClassificationClasses(entry.coin);
                const isLinked = Boolean(entry.coin && entry.coin === hoveredCoin);
                const exchangeChips = getCoinExchangeChips(entry.coin, 'perpetual', exchangeAvailability, entry.exchange);
                return (
                  <tr
                    className={`classification-row border-t border-slate-800/70 ${classificationClasses} ${isLinked ? 'linked-coin-row' : ''}`}
                    key={`${event?.id}-${entry.rawLine}-${index}`}
                    role={entry.coin ? 'button' : undefined}
                    tabIndex={entry.coin ? 0 : undefined}
                    onClick={() => entry.coin ? setSelectedCoin(entry.coin) : undefined}
                    onKeyDown={(keyboardEvent) => openHistoryFromKeyboard(keyboardEvent, entry.coin)}
                    onMouseEnter={() => onCoinHover?.(entry.coin)}
                    onMouseLeave={() => onCoinHover?.(null)}
                    onFocus={() => onCoinHover?.(entry.coin)}
                    onBlur={() => onCoinHover?.(null)}
                  >
                    <td className="px-1.5 py-2 font-black text-slate-500">{entry.rank ?? index + 1}</td>
                    <td className="px-1.5 py-2">
                        <span className="coin-cell">
                        {entry.coin ? (
                          <button className="coin-button" type="button" onClick={(clickEvent) => { clickEvent.stopPropagation(); setSelectedCoin(entry.coin!); }}>
                            {entry.coin}
                          </button>
                        ) : (
                          <span className="text-slate-500">Unknown</span>
                        )}
                        <ExchangeChips chips={exchangeChips} />
                        <PerformanceTrendChips coin={entry.coin} trends={performanceTrends} />
                      </span>
                    </td>
                    <td className="px-1.5 py-2 font-bold text-cyan-200">{formatHitCount(entry.coin, hitCounts)}</td>
                    <td className="px-1.5 py-2 font-bold text-slate-300">{entry.exchange ?? '-'}</td>
                    <td className={`px-1.5 py-2 font-bold ${isLoserTable ? 'text-rose-300' : 'text-emerald-300'}`}>
                      {formatPercent(entry.percent)}
                    </td>
                    <td className="px-1.5 py-2 font-bold text-slate-200">{formatPrice(entry.priceUsd)}</td>
                    <td className={`px-1.5 py-2 font-bold ${priceChangeClass(entry.priceChangePercent)}`}>
                      {formatSignedPercent(entry.priceChangePercent)}
                    </td>
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
      {selectedCoin ? <OiHistoryModal coin={selectedCoin} hits={selectedHistory} onClose={() => setSelectedCoin(null)} /> : null}
    </section>
  );
}

function OiHistoryModal({ coin, hits, onClose }: { coin: string; hits: OiHistoryHit[]; onClose: () => void }) {
  const [view, setView] = useState<'graph' | 'details'>('graph');

  return (
    <div className="bs-history-modal-backdrop" role="presentation" onClick={onClose}>
      <div className="bs-history-modal-shell" role="dialog" aria-modal="true" aria-labelledby="oi-history-title" onClick={(event) => event.stopPropagation()}>
        <button className="modal-close-button bs-history-close-button" type="button" aria-label="Close OI history" onClick={onClose}>×</button>
        <section className="panel bs-history-modal">
          <div className="panel-header">
            <div>
              <h2 id="oi-history-title">{coin} OI History</h2>
              <p>Latest 1h OI hits with price movement for manual review.</p>
            </div>
          </div>

          <div className="bs-history-summary">
            <span>{hits.length} hit{hits.length === 1 ? '' : 's'} in 1h</span>
          </div>

          {hits.length ? (
            <div className="bs-history-view-tabs" role="tablist" aria-label="OI history view">
              <button className={view === 'graph' ? 'active' : ''} type="button" role="tab" aria-selected={view === 'graph'} onClick={() => setView('graph')}>Graph</button>
              <button className={view === 'details' ? 'active' : ''} type="button" role="tab" aria-selected={view === 'details'} onClick={() => setView('details')}>Details</button>
            </div>
          ) : null}

          {hits.length ? (
            <div className={`bs-history-content ${view}`}>
              {view === 'graph' ? <OiHistoryChart coin={coin} hits={hits} /> : <OiHistoryDetailsTable hits={hits} />}
            </div>
          ) : <div className="empty-state">No OI hits found for {coin} in the latest 1h window.</div>}
        </section>
      </div>
    </div>
  );
}

function OiHistoryChart({ coin, hits }: { coin: string; hits: OiHistoryHit[] }) {
  const chart = buildOiChart(hits);
  const priceLine = chart.points.filter((point): point is OiChartPoint & { priceY: number; priceChangePercent: number } => point.priceY !== null && point.priceChangePercent !== null);
  const latestPrice = hits[0]?.priceChangePercent ?? null;

  return (
    <div className="bs-history-chart-card oi-history-chart-card">
      <div className="bs-history-chart-head">
        <div>
          <h3>OI change and price % trend</h3>
        </div>
        <strong>{formatSignedPercent(latestPrice)}</strong>
      </div>
      <div className="bs-history-chart-legend" aria-hidden="true">
        <span><i className="oi" />OI change</span>
        <span><i className="price" />Price %</span>
        <span><i className="rolling" />Rolling price 3</span>
      </div>
      <svg className="bs-history-chart" viewBox="0 0 640 220" preserveAspectRatio="none" role="img" aria-label={`${coin} OI and price percent history chart from -${chart.maxPercentLabel} to ${chart.maxPercentLabel}`}>
        <line className="bs-history-chart-grid" x1="56" y1="24" x2="608" y2="24" />
        <line className="bs-history-chart-grid" x1="56" y1={chart.positiveMidY} x2="608" y2={chart.positiveMidY} />
        <line className="bs-history-chart-grid" x1="56" y1="96" x2="608" y2="96" />
        <line className="bs-history-chart-grid" x1="56" y1={chart.negativeMidY} x2="608" y2={chart.negativeMidY} />
        <line className="bs-history-chart-grid" x1="56" y1="168" x2="608" y2="168" />
        <line className="bs-history-chart-axis" x1="56" y1="24" x2="56" y2="168" />
        <line className="bs-history-chart-axis" x1="56" y1="168" x2="608" y2="168" />
        <line className="bs-history-chart-zero" x1="56" y1="96" x2="608" y2="96" />
        <text className="bs-history-chart-label" x="46" y="28" textAnchor="end">{chart.maxPercentLabel}%</text>
        <text className="bs-history-chart-label" x="46" y={chart.positiveMidY + 4} textAnchor="end">{chart.midPercentLabel}%</text>
        <text className="bs-history-chart-label" x="46" y="100" textAnchor="end">0</text>
        <text className="bs-history-chart-label" x="46" y={chart.negativeMidY + 4} textAnchor="end">-{chart.midPercentLabel}%</text>
        <text className="bs-history-chart-label" x="46" y="172" textAnchor="end">-{chart.maxPercentLabel}%</text>
        <text className="bs-history-chart-label bs-history-chart-time" x="56" y="198">{chart.startLabel}</text>
        <text className="bs-history-chart-label bs-history-chart-time" x="608" y="198" textAnchor="end">{chart.endLabel}</text>
        <text className="bs-history-chart-label" x="332" y="214" textAnchor="middle">Time</text>
        <text className="bs-history-chart-label" x="16" y="96" textAnchor="middle" transform="rotate(-90 16 96)">OI and price %</text>
        {priceLine.length > 1 ? <polyline className="oi-history-price-line" points={priceLine.map((point) => `${point.x},${point.priceY}`).join(' ')} /> : null}
        {chart.rollingPricePoints.length > 1 ? <polyline className="bs-history-chart-rolling-line" points={chart.rollingPricePoints.map((point) => `${point.x},${point.y}`).join(' ')} /> : null}
        {chart.points.map((point, index) => point.oiChangePercent === null ? null : (
          <rect
            aria-label={`${formatAxisTime(point.time)} OI ${formatSignedPercent(point.oiChangePercent)} price ${formatSignedPercent(point.priceChangePercent)}`}
            className={`bs-history-chart-bar ${point.oiChangePercent < 0 ? 'bear' : ''}`}
            height={Math.abs(96 - point.oiY)}
            key={`${point.time}-${index}`}
            rx="5"
            width="36"
            x={point.x - 18}
            y={Math.min(point.oiY, 96)}
          >
            <title>{`${formatAxisTime(point.time)}: OI ${formatSignedPercent(point.oiChangePercent)}, price ${formatSignedPercent(point.priceChangePercent)}`}</title>
          </rect>
        ))}
        {priceLine.map((point, index) => (
          <circle className="oi-history-price-dot" cx={point.x} cy={point.priceY} r="4" key={`${point.time}-price-${index}`}>
            <title>{`${formatAxisTime(point.time)}: price ${formatSignedPercent(point.priceChangePercent)}`}</title>
          </circle>
        ))}
      </svg>
    </div>
  );
}

function OiHistoryDetailsTable({ hits }: { hits: OiHistoryHit[] }) {
  return (
    <div className="bs-history-table-panel">
      <div className="bs-history-table-title">
        <h3>OI hits by time</h3>
        <span>Newest first</span>
      </div>
      <div className="bs-history-table-wrap oi-history-table-wrap">
        <table className="w-full text-left text-xs">
          <thead>
            <tr>
              <th>Time</th>
              <th>OI</th>
              <th>Price</th>
              <th>Price %</th>
              <th>Exchange</th>
            </tr>
          </thead>
          <tbody>
            {hits.map((hit, index) => (
              <tr className={index < 3 ? 'latest-three' : ''} key={`${hit.eventId}-${hit.rawLine}-${index}`}>
                <td>{formatExactDateTime(hit.receivedAt)}</td>
                <td className="bs-history-ratio">{formatSignedPercent(hit.oiChangePercent)}</td>
                <td>{formatPrice(hit.priceUsd)}</td>
                <td className={priceChangeClass(hit.priceChangePercent)}>{formatSignedPercent(hit.priceChangePercent)}</td>
                <td>{hit.exchange ?? '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function buildOiHistoriesLastHour(events: NormalizedEvent[], referenceEvent: NormalizedEvent | null): Map<string, OiHistoryHit[]> {
  const referenceMs = parseTime(referenceEvent?.receivedAt) ?? Date.now();
  const cutoffMs = referenceMs - 60 * 60 * 1_000;
  const histories = new Map<string, OiHistoryHit[]>();

  for (const event of events) {
    const eventMs = parseTime(event.receivedAt);
    if (eventMs === null || eventMs < cutoffMs || eventMs > referenceMs) continue;

    for (const entry of event.entries) {
      if (!entry.coin) continue;
      const hit: OiHistoryHit = {
        eventId: event.id,
        receivedAt: event.receivedAt,
        title: event.title,
        rank: entry.rank,
        coin: entry.coin,
        exchange: entry.exchange,
        oiChangePercent: finiteNumber(entry.percent),
        priceUsd: finiteNumber(entry.priceUsd),
        priceChangePercent: finiteNumber(entry.priceChangePercent),
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

function buildOiChart(hits: OiHistoryHit[]): OiChartData {
  const ordered: Array<OiHistoryHit & { time: number }> = hits
    .flatMap((hit) => {
      const time = parseTime(hit.receivedAt);
      return time === null ? [] : [{ ...hit, time }];
    })
    .sort((left, right) => left.time - right.time);
  const maxTime = ordered.at(-1)?.time ?? Date.now();
  const minTime = maxTime - HISTORY_WINDOW_MS;
  const timeRange = HISTORY_WINDOW_MS;
  const values = ordered.flatMap((hit) => [hit.oiChangePercent, hit.priceChangePercent]).filter((value): value is number => value !== null && Number.isFinite(value));
  const maxPercent = Math.max(3, ...values.map((value) => Math.abs(value)));
  const percentScaleMax = maxPercent > 3 ? Math.ceil(maxPercent) : 3;
  const points = ordered.map((hit) => {
    const x = ordered.length === 1 ? 608 : 56 + ((hit.time - minTime) / timeRange) * 552;
    return {
      x: Math.round(x * 10) / 10,
      oiY: percentAxisY(hit.oiChangePercent ?? 0, percentScaleMax),
      priceY: hit.priceChangePercent === null ? null : percentAxisY(hit.priceChangePercent, percentScaleMax),
      time: hit.time,
      oiChangePercent: hit.oiChangePercent,
      priceChangePercent: hit.priceChangePercent
    };
  });

  return {
    points,
    rollingPricePoints: buildRollingPricePoints(ordered, minTime, timeRange, percentScaleMax),
    startLabel: formatAxisTime(minTime),
    endLabel: formatAxisTime(maxTime),
    maxPercentLabel: formatPercentAxisTick(percentScaleMax),
    midPercentLabel: formatPercentAxisTick(percentScaleMax / 2),
    positiveMidY: percentAxisY(percentScaleMax / 2, percentScaleMax),
    negativeMidY: percentAxisY(-percentScaleMax / 2, percentScaleMax)
  };
}

function buildRollingPricePoints(
  ordered: Array<OiHistoryHit & { time: number }>,
  minTime: number,
  timeRange: number,
  percentScaleMax: number
): Array<{ x: number; y: number; time: number; value: number }> {
  const pricePoints = ordered.filter((hit): hit is OiHistoryHit & { time: number; priceChangePercent: number } => hit.priceChangePercent !== null && Number.isFinite(hit.priceChangePercent));
  return pricePoints.map((hit, index) => {
    const window = pricePoints.slice(Math.max(0, index - 2), index + 1);
    const average = window.reduce((sum, item) => sum + item.priceChangePercent, 0) / window.length;
    const x = pricePoints.length === 1 ? 608 : 56 + ((hit.time - minTime) / timeRange) * 552;
    return { x: Math.round(x * 10) / 10, y: percentAxisY(average, percentScaleMax), time: hit.time, value: average };
  });
}

function formatPercent(value: number | null | undefined): string {
  return Number.isFinite(value) ? `${value?.toFixed(2)}%` : '-';
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

function priceChangeClass(value: number | null | undefined): string {
  if (!Number.isFinite(value) || value === 0) return 'text-slate-300';
  return (value as number) > 0 ? 'text-emerald-300' : 'text-rose-300';
}

function finiteNumber(value: number | null | undefined): number | null {
  return Number.isFinite(value) ? value as number : null;
}

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function percentAxisY(value: number, scaleMax: number): number {
  const clamped = Math.max(-scaleMax, Math.min(scaleMax, value));
  return Math.round((96 - (clamped / scaleMax) * 72) * 10) / 10;
}

function formatPercentAxisTick(value: number): string {
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
