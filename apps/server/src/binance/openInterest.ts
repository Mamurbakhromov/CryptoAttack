export type BinanceOpenInterestPeriod = '5m' | '15m' | '30m' | '1h';

export interface BinanceOpenInterestPoint {
  symbol: string;
  timestamp: string;
  timestampMs: number;
  sumOpenInterest: number | null;
  sumOpenInterestValue: number | null;
}

export interface BinanceOpenInterestResponse {
  generatedAt: string;
  source: 'binance-futures-public';
  symbol: string;
  coin: string;
  period: BinanceOpenInterestPeriod;
  requestedEndTime: string | null;
  currentOpenInterest: number | null;
  currentOpenInterestTime: string | null;
  latest: BinanceOpenInterestPoint | null;
  change15mPercent: number | null;
  change30mPercent: number | null;
  points: BinanceOpenInterestPoint[];
  warnings: string[];
}

interface FetchBinanceOpenInterestInput {
  symbol: string;
  period: BinanceOpenInterestPeriod;
  limit: number;
  endTimeMs: number | null;
  timeoutMs: number;
  fetcher?: Fetcher;
}

type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;

export async function fetchBinanceOpenInterest(input: FetchBinanceOpenInterestInput): Promise<BinanceOpenInterestResponse> {
  const fetcher = input.fetcher ?? fetch;
  const historyUrl = new URL('https://fapi.binance.com/futures/data/openInterestHist');
  historyUrl.searchParams.set('symbol', input.symbol);
  historyUrl.searchParams.set('period', input.period);
  historyUrl.searchParams.set('limit', String(input.limit));
  if (input.endTimeMs !== null) historyUrl.searchParams.set('endTime', String(input.endTimeMs));

  const historyData = await fetchJson(historyUrl, input.timeoutMs, fetcher);
  const points = parseBinanceOpenInterestHistory(historyData);
  const warnings: string[] = [];

  let currentOpenInterest: number | null = null;
  let currentOpenInterestTime: string | null = null;
  try {
    const currentUrl = new URL('https://fapi.binance.com/fapi/v1/openInterest');
    currentUrl.searchParams.set('symbol', input.symbol);
    const currentData = await fetchJson(currentUrl, input.timeoutMs, fetcher);
    const current = parseBinanceCurrentOpenInterest(currentData);
    currentOpenInterest = current.openInterest;
    currentOpenInterestTime = current.time;
  } catch (error) {
    warnings.push(`Current open-interest request failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  return buildBinanceOpenInterestResponse({
    symbol: input.symbol,
    period: input.period,
    requestedEndTimeMs: input.endTimeMs,
    currentOpenInterest,
    currentOpenInterestTime,
    points,
    warnings
  });
}

export function buildBinanceOpenInterestResponse(input: {
  symbol: string;
  period: BinanceOpenInterestPeriod;
  requestedEndTimeMs: number | null;
  currentOpenInterest: number | null;
  currentOpenInterestTime: string | null;
  points: BinanceOpenInterestPoint[];
  warnings?: string[];
}): BinanceOpenInterestResponse {
  const points = [...input.points].sort((a, b) => a.timestampMs - b.timestampMs);
  return {
    generatedAt: new Date().toISOString(),
    source: 'binance-futures-public',
    symbol: input.symbol,
    coin: deriveCoinFromSymbol(input.symbol),
    period: input.period,
    requestedEndTime: input.requestedEndTimeMs === null ? null : new Date(input.requestedEndTimeMs).toISOString(),
    currentOpenInterest: input.currentOpenInterest,
    currentOpenInterestTime: input.currentOpenInterestTime,
    latest: points.at(-1) ?? null,
    change15mPercent: calculateOpenInterestChangePercent(points, 15),
    change30mPercent: calculateOpenInterestChangePercent(points, 30),
    points,
    warnings: input.warnings ?? []
  };
}

export function parseBinanceOpenInterestHistory(data: unknown): BinanceOpenInterestPoint[] {
  if (!Array.isArray(data)) return [];

  return data
    .map((row) => {
      if (!isPlainObject(row)) return null;
      const symbol = typeof row.symbol === 'string' ? row.symbol.toUpperCase() : '';
      const timestampMs = parseNumber(row.timestamp);
      if (!symbol || timestampMs === null) return null;
      return {
        symbol,
        timestamp: new Date(timestampMs).toISOString(),
        timestampMs,
        sumOpenInterest: parseNumber(row.sumOpenInterest),
        sumOpenInterestValue: parseNumber(row.sumOpenInterestValue)
      } satisfies BinanceOpenInterestPoint;
    })
    .filter((point): point is BinanceOpenInterestPoint => point !== null)
    .sort((a, b) => a.timestampMs - b.timestampMs);
}

export function calculateOpenInterestChangePercent(points: BinanceOpenInterestPoint[], minutes: 15 | 30): number | null {
  const latest = [...points].reverse().find((point) => isPositiveNumber(point.sumOpenInterest));
  if (!latest || latest.sumOpenInterest === null) return null;

  const targetTimestamp = latest.timestampMs - minutes * 60_000;
  const prior = [...points].reverse().find((point) => point.timestampMs <= targetTimestamp && isPositiveNumber(point.sumOpenInterest));
  if (!prior || prior.sumOpenInterest === null) return null;

  return ((latest.sumOpenInterest - prior.sumOpenInterest) / prior.sumOpenInterest) * 100;
}

function parseBinanceCurrentOpenInterest(data: unknown): { openInterest: number | null; time: string | null } {
  if (!isPlainObject(data)) return { openInterest: null, time: null };
  const openInterest = parseNumber(data.openInterest);
  const timeMs = parseNumber(data.time);
  return {
    openInterest,
    time: timeMs === null ? null : new Date(timeMs).toISOString()
  };
}

async function fetchJson(url: URL, timeoutMs: number, fetcher: Fetcher): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(url, {
      headers: { accept: 'application/json' },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function deriveCoinFromSymbol(symbol: string): string {
  return symbol.toUpperCase().replace(/USDT$/, '').replace(/BUSD$/, '').replace(/USDC$/, '');
}

function parseNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isPositiveNumber(value: number | null): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
