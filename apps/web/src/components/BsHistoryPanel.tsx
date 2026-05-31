import { type MouseEvent as ReactMouseEvent, useState } from 'react';

import type { FeedKey } from '../types';
import { formatMoney } from './format';

const HISTORY_WINDOW_MS = 60 * 60 * 1_000;
const FIVE_MINUTE_SLOT_MS = 5 * 60 * 1_000;
const CHART_MIN_X = 56;
const CHART_MAX_X = 608;
const CHART_WIDTH = CHART_MAX_X - CHART_MIN_X;

export interface RatioHistoryHit {
  eventId: string;
  receivedAt: string;
  title?: string;
  feedKey: FeedKey;
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

export interface RatioAverage {
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
  slotTicks: number[];
  barWidth: number;
  startLabel: string;
  endLabel: string;
  maxRatioLabel: string;
  midRatioLabel: string;
  positiveMidY: number;
  negativeMidY: number;
}

export function BsHistoryDetailsTable({ hits, ratioLabel }: { hits: RatioHistoryHit[]; ratioLabel: string }) {
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

export function BsHistoryChart({
  coin,
  hits,
  comparisonHits,
  ratioLabel,
  comparisonRatioLabel,
  windowStart,
  windowEnd
}: {
  coin: string;
  hits: RatioHistoryHit[];
  comparisonHits: RatioHistoryHit[];
  ratioLabel: string;
  comparisonRatioLabel: string;
  windowStart?: string | Date | undefined;
  windowEnd?: string | Date | undefined;
}) {
  const chart = buildRatioChart(hits, comparisonHits, ratioLabel, comparisonRatioLabel, windowStart, windowEnd);
  const [activePoint, setActivePoint] = useState<RatioChartPoint | null>(null);
  const barWidth = chart.barWidth;
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
      <svg className="bs-history-chart" viewBox="0 0 640 220" preserveAspectRatio="xMidYMid meet" role="img" aria-label={`${coin} ${ratioLabel} and ${comparisonRatioLabel} ratio history bar chart from -${chart.maxRatioLabel} to ${chart.maxRatioLabel}`}>
        <line className="bs-history-chart-grid" x1="56" y1="24" x2="608" y2="24" />
        <line className="bs-history-chart-grid" x1="56" y1={chart.positiveMidY} x2="608" y2={chart.positiveMidY} />
        <line className="bs-history-chart-grid" x1="56" y1="96" x2="608" y2="96" />
        <line className="bs-history-chart-grid" x1="56" y1={chart.negativeMidY} x2="608" y2={chart.negativeMidY} />
        <line className="bs-history-chart-grid" x1="56" y1="168" x2="608" y2="168" />
        <line className="bs-history-chart-axis" x1="56" y1="24" x2="56" y2="168" />
        <line className="bs-history-chart-axis" x1="56" y1="168" x2="608" y2="168" />
        <line className="bs-history-chart-zero" x1="56" y1="96" x2="608" y2="96" />
        {chart.slotTicks.map((x) => (
          <line className="bs-history-chart-slot-grid" x1={x} y1="24" x2={x} y2="168" key={`slot-${x}`} />
        ))}
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
              <text className="bs-history-chart-tooltip-ratio" x="12" y="36">{activePoint.label} {pointRatioLabel(activePoint)}</text>
            </g>
          </g>
        ) : null}
      </svg>
    </div>
  );
}

export function buildRatioAverages(histories: Map<string, RatioHistoryHit[]>): Map<string, RatioAverage> {
  const averages = new Map<string, RatioAverage>();
  for (const [coin, hits] of histories) {
    const latest = hits.slice(0, 3).map((hit) => hit.displayRatio).filter(Number.isFinite);
    if (!latest.length) continue;
    averages.set(coin, { average: latest.reduce((sum, value) => sum + value, 0) / latest.length, count: latest.length });
  }
  return averages;
}

export function formatAverageRatio(value: RatioAverage | null): string {
  return value ? `${value.average.toFixed(2)}x` : '-';
}

function buildRatioChart(
  hits: RatioHistoryHit[],
  comparisonHits: RatioHistoryHit[],
  ratioLabel: string,
  comparisonRatioLabel: string,
  windowStart?: string | Date,
  windowEnd?: string | Date
): RatioChartData {
  const primarySign = ratioLabel === 'S/B' ? -1 : 1;
  const comparisonSign = primarySign * -1;
  const primaryPoints = hits.map((hit) => ({ time: parseTime(hit.receivedAt), ratio: hit.displayRatio, signedRatio: primarySign * hit.displayRatio, label: ratioLabel, side: primarySign > 0 ? 'bull' as const : 'bear' as const }));
  const ordered = [
    ...primaryPoints,
    ...comparisonHits.map((hit) => ({ time: parseTime(hit.receivedAt), ratio: hit.displayRatio, signedRatio: comparisonSign * hit.displayRatio, label: comparisonRatioLabel, side: comparisonSign > 0 ? 'bull' as const : 'bear' as const }))
  ]
    .filter((point): point is { time: number; ratio: number; signedRatio: number; label: string; side: 'bull' | 'bear' } => point.time !== null && Number.isFinite(point.ratio))
    .sort((left, right) => left.time - right.time);
  const explicitStart = parseWindowBoundary(windowStart);
  const explicitEnd = parseWindowBoundary(windowEnd);
  const maxTime = explicitEnd ?? ordered.at(-1)?.time ?? Date.now();
  const minTime = explicitStart ?? maxTime - HISTORY_WINDOW_MS;
  const timeRange = Math.max(1, maxTime - minTime);
  const slotCount = explicitStart !== null && explicitEnd !== null ? Math.max(1, Math.round(timeRange / FIVE_MINUTE_SLOT_MS)) : null;
  const slotWidth = slotCount ? CHART_WIDTH / slotCount : null;
  const maxRatio = Math.max(3, ...ordered.map((point) => point.ratio));
  const ratioScaleMax = maxRatio > 3 ? Math.ceil(maxRatio) : 3;
  const points = ordered.map((point) => {
    const x = chartXForTime(point.time, minTime, timeRange, ordered.length, slotCount, slotWidth, explicitStart === null && explicitEnd === null);
    const ratio = Math.max(0, Math.min(ratioScaleMax, point.ratio));
    const y = 96 - ((point.signedRatio < 0 ? -ratio : ratio) / ratioScaleMax) * 72;
    return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, time: point.time, ratio: point.ratio, signedRatio: point.signedRatio, label: point.label, side: point.side };
  });
  const rollingPoints = buildRollingPoints(primaryPoints, minTime, timeRange, ratioScaleMax, explicitStart === null && explicitEnd === null, slotCount, slotWidth);

  return {
    points,
    rollingPoints,
    slotTicks: buildSlotTicks(slotCount, slotWidth),
    barWidth: slotWidth ? Math.round(Math.max(14, Math.min(24, slotWidth * 0.52))) : getChartBarWidth(points),
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
  ratioScaleMax: number,
  useSinglePointRightEdge: boolean,
  slotCount: number | null,
  slotWidth: number | null
): RatioChartRollingPoint[] {
  const orderedPoints = points
    .filter((point): point is { time: number; ratio: number; signedRatio: number } => point.time !== null && Number.isFinite(point.ratio))
    .sort((left, right) => left.time - right.time);

  return orderedPoints
    .map((point, index) => {
      const window = orderedPoints.slice(Math.max(0, index - 2), index + 1);
      const average = window.reduce((sum, item) => sum + item.signedRatio, 0) / window.length;
      const x = chartXForTime(point.time, minTime, timeRange, orderedPoints.length, slotCount, slotWidth, useSinglePointRightEdge);
      const clampedAverage = Math.max(-ratioScaleMax, Math.min(ratioScaleMax, average));
      const y = 96 - (clampedAverage / ratioScaleMax) * 72;
      return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, time: point.time, ratio: Math.abs(average) };
    });
}

function chartXForTime(
  time: number,
  minTime: number,
  timeRange: number,
  pointCount: number,
  slotCount: number | null,
  slotWidth: number | null,
  useSinglePointRightEdge: boolean
): number {
  if (useSinglePointRightEdge && pointCount === 1) return CHART_MAX_X;
  if (slotCount && slotWidth) {
    const slotIndex = Math.max(0, Math.min(slotCount, Math.round((time - minTime) / FIVE_MINUTE_SLOT_MS)));
    return CHART_MIN_X + slotIndex * slotWidth;
  }
  return CHART_MIN_X + ((time - minTime) / timeRange) * CHART_WIDTH;
}

function buildSlotTicks(slotCount: number | null, slotWidth: number | null): number[] {
  if (!slotCount || !slotWidth) return [];
  return Array.from({ length: Math.max(0, slotCount - 1) }, (_, index) => Math.round((CHART_MIN_X + (index + 1) * slotWidth) * 10) / 10);
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

function pointRatioLabel(point: RatioChartPoint): string {
  return `${point.signedRatio.toFixed(2)}x`;
}

function formatOptionalMoney(value: number | null | undefined): string {
  return Number.isFinite(value) ? formatMoney(value) : '-';
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

function parseWindowBoundary(value: string | Date | undefined): number | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}
