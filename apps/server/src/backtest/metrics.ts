export interface BacktestMetricSample {
  status: string;
  score: number;
  confidenceScore: number;
  returnPct: number | null;
  directionalReturnPct: number | null;
  maxAdverseMovePct?: number | null;
}

export interface BacktestAggregateMetrics {
  totalCount: number;
  sampleCount: number;
  pendingCount: number;
  missingLabelCount: number;
  averageForwardReturnPct: number | null;
  medianForwardReturnPct: number | null;
  winRate: number | null;
  lossRate: number | null;
  averageMaxAdverseMovePct: number | null;
  medianMaxAdverseMovePct: number | null;
  averageScore: number | null;
  averageConfidenceScore: number | null;
  statusCounts: Record<string, number>;
}

export interface BacktestBucketMetrics extends BacktestAggregateMetrics {
  bucketStart: number;
  bucketEnd: number;
}

export function summarizeBacktestSamples(samples: BacktestMetricSample[]): BacktestAggregateMetrics {
  const statusCounts: Record<string, number> = {};
  for (const sample of samples) statusCounts[sample.status] = (statusCounts[sample.status] ?? 0) + 1;

  const ready = samples.filter((sample) => sample.status === 'ready' && sample.directionalReturnPct !== null);
  const directionalReturns = ready.map((sample) => sample.directionalReturnPct).filter(isNumber);
  const adverseMoves = ready.map((sample) => sample.maxAdverseMovePct ?? null).filter(isNumber);
  const wins = directionalReturns.filter((value) => value > 0).length;
  const losses = directionalReturns.filter((value) => value < 0).length;

  return {
    totalCount: samples.length,
    sampleCount: ready.length,
    pendingCount: samples.filter((sample) => sample.status === 'pending').length,
    missingLabelCount: samples.filter((sample) => sample.status !== 'ready').length,
    averageForwardReturnPct: average(directionalReturns),
    medianForwardReturnPct: median(directionalReturns),
    winRate: ratioOrNull(wins, ready.length),
    lossRate: ratioOrNull(losses, ready.length),
    averageMaxAdverseMovePct: average(adverseMoves),
    medianMaxAdverseMovePct: median(adverseMoves),
    averageScore: average(ready.map((sample) => sample.score)),
    averageConfidenceScore: average(ready.map((sample) => sample.confidenceScore)),
    statusCounts
  };
}

export function bucketBacktestSamples(samples: BacktestMetricSample[], bucketSize: number, valueForBucket: (sample: BacktestMetricSample) => number): BacktestBucketMetrics[] {
  const buckets = new Map<number, BacktestMetricSample[]>();
  for (const sample of samples) {
    const bucketStart = bucketStartFor(valueForBucket(sample), bucketSize);
    const existing = buckets.get(bucketStart) ?? [];
    existing.push(sample);
    buckets.set(bucketStart, existing);
  }

  return [...buckets.entries()]
    .sort(([left], [right]) => left - right)
    .map(([bucketStart, bucketSamples]) => ({
      bucketStart,
      bucketEnd: Math.min(100, bucketStart + bucketSize),
      ...summarizeBacktestSamples(bucketSamples)
    }));
}

export function diagnoseRuleFlags(input: { sampleCount: number; averageForwardReturnPct: number | null; winRate: number | null; liftVsAllSignals: number | null; minSamples: number }): string[] {
  if (input.sampleCount < input.minSamples) return ['thin_sample'];
  const flags: string[] = [];
  const harmful = input.averageForwardReturnPct !== null && input.averageForwardReturnPct < 0 && input.winRate !== null && input.winRate < 0.45;
  const weak = input.averageForwardReturnPct !== null && input.averageForwardReturnPct <= 0 && (input.liftVsAllSignals === null || input.liftVsAllSignals <= 0);
  if (harmful) flags.push('harmful');
  if (weak && !harmful) flags.push('weak');
  if (input.liftVsAllSignals !== null && input.liftVsAllSignals < -0.1) flags.push('negative_lift');
  return flags;
}

function bucketStartFor(value: number, bucketSize: number): number {
  if (value >= 100) return Math.max(0, 100 - bucketSize);
  if (value <= 0) return 0;
  return Math.floor(value / bucketSize) * bucketSize;
}

function average(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  const right = sorted[midpoint];
  if (right === undefined) return null;
  if (sorted.length % 2) return right;
  const left = sorted[midpoint - 1];
  return left === undefined ? right : (left + right) / 2;
}

function ratioOrNull(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

function isNumber(value: number | null): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
