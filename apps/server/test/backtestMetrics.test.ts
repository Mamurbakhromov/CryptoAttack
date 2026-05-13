import { describe, expect, it } from 'vitest';

import { bucketBacktestSamples, diagnoseRuleFlags, summarizeBacktestSamples, type BacktestMetricSample } from '../src/backtest/metrics.js';

describe('backtest metric calculations', () => {
  it('summarizes deterministic historical score labels', () => {
    const summary = summarizeBacktestSamples(seedSamples());

    expect(summary.totalCount).toBe(7);
    expect(summary.sampleCount).toBe(6);
    expect(summary.pendingCount).toBe(1);
    expect(summary.missingLabelCount).toBe(1);
    expect(summary.averageForwardReturnPct).toBeCloseTo(1.6667, 4);
    expect(summary.medianForwardReturnPct).toBe(-0.5);
    expect(summary.winRate).toBe(0.5);
    expect(summary.lossRate).toBe(0.5);
    expect(summary.statusCounts).toEqual({ ready: 6, pending: 1 });
  });

  it('buckets score and confidence performance without counting pending labels as samples', () => {
    const confidenceBuckets = bucketBacktestSamples(seedSamples(), 25, (sample) => sample.confidenceScore);
    const highConfidence = confidenceBuckets.find((bucket) => bucket.bucketStart === 75);

    expect(highConfidence).toMatchObject({ bucketStart: 75, bucketEnd: 100, totalCount: 3, sampleCount: 2 });
    expect(highConfidence?.averageForwardReturnPct).toBe(9);

    const scoreBuckets = bucketBacktestSamples(seedSamples(), 50, (sample) => sample.score);
    expect(scoreBuckets.map((bucket) => [bucket.bucketStart, bucket.sampleCount])).toEqual([[0, 4], [50, 2]]);
  });

  it('flags weak and harmful rules only after the minimum sample threshold', () => {
    expect(diagnoseRuleFlags({ sampleCount: 1, averageForwardReturnPct: -4, winRate: 0, liftVsAllSignals: -0.5, minSamples: 2 })).toEqual(['thin_sample']);
    expect(diagnoseRuleFlags({ sampleCount: 20, averageForwardReturnPct: -0.2, winRate: 0.4, liftVsAllSignals: -0.2, minSamples: 20 })).toEqual(['harmful', 'negative_lift']);
    expect(diagnoseRuleFlags({ sampleCount: 20, averageForwardReturnPct: 0.1, winRate: 0.55, liftVsAllSignals: 0.05, minSamples: 20 })).toEqual([]);
  });
});

function seedSamples(): BacktestMetricSample[] {
  return [
    { status: 'ready', score: 74, confidenceScore: 90, returnPct: 10, directionalReturnPct: 10, maxAdverseMovePct: -1 },
    { status: 'ready', score: 70, confidenceScore: 85, returnPct: -8, directionalReturnPct: 8, maxAdverseMovePct: -1 },
    { status: 'ready', score: 5, confidenceScore: 40, returnPct: -2, directionalReturnPct: -2, maxAdverseMovePct: -4 },
    { status: 'ready', score: 25, confidenceScore: 55, returnPct: -4, directionalReturnPct: -4, maxAdverseMovePct: -6 },
    { status: 'ready', score: 20, confidenceScore: 60, returnPct: 3, directionalReturnPct: -3, maxAdverseMovePct: -5 },
    { status: 'pending', score: 45, confidenceScore: 75, returnPct: null, directionalReturnPct: null, maxAdverseMovePct: null },
    { status: 'ready', score: 35, confidenceScore: 20, returnPct: -1, directionalReturnPct: 1, maxAdverseMovePct: -1 }
  ];
}
