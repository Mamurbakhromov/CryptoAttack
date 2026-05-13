import type { BacktestRepository } from '../db/backtestRepository.js';
import type {
  BacktestBucketQuery,
  BacktestCoinQuery,
  BacktestConfigComparisonRow,
  BacktestMetricRow,
  BacktestRulesQuery,
  BacktestSummaryQuery
} from './types.js';

const historicalMode = 'historical_backtest' as const;
const labelWarning = 'Forward returns are historical labels for analysis only. They are never used as inputs to live score calculation.';

export class BacktestService {
  constructor(private readonly repository: BacktestRepository) {}

  async getSummary(query: BacktestSummaryQuery) {
    const [metrics, precisionByThreshold, bullBearSeparation] = await Promise.all([
      this.repository.getSummary(query),
      this.repository.getPrecisionByThreshold(query),
      this.repository.getBullBearSeparation(query)
    ]);
    const configComparison = query.compareScoreConfigVersion ? buildConfigComparison(metrics, await this.repository.getSummary({ ...query, scoreConfigVersion: query.compareScoreConfigVersion }), query) : [];

    return {
      generatedAt: new Date().toISOString(),
      enabled: true,
      mode: historicalMode,
      labelWarning,
      scoreConfigVersion: query.scoreConfigVersion,
      compareScoreConfigVersion: query.compareScoreConfigVersion ?? null,
      windowMinutes: query.windowMinutes,
      horizonsMinutes: query.horizonsMinutes,
      side: query.side,
      filters: queryFilters(query),
      metrics,
      precisionByThreshold,
      bullBearSeparation,
      configComparison
    };
  }

  async getScoreBuckets(query: BacktestBucketQuery) {
    const [scoreBuckets, confidenceBuckets] = await Promise.all([
      this.repository.getScoreBuckets(query),
      this.repository.getConfidenceBuckets(query)
    ]);

    return {
      generatedAt: new Date().toISOString(),
      enabled: true,
      mode: historicalMode,
      labelWarning,
      scoreConfigVersion: query.scoreConfigVersion,
      windowMinutes: query.windowMinutes,
      horizonsMinutes: query.horizonsMinutes,
      side: query.side,
      bucketSize: query.bucketSize,
      confidenceBucketSize: query.confidenceBucketSize,
      filters: queryFilters(query),
      scoreBuckets,
      confidenceBuckets
    };
  }

  async getRules(query: BacktestRulesQuery) {
    const rules = await this.repository.getRulePerformance(query);
    const harmfulRuleCount = rules.filter((rule) => rule.flags.includes('harmful')).length;
    const weakRuleCount = rules.filter((rule) => rule.flags.includes('weak')).length;

    return {
      generatedAt: new Date().toISOString(),
      enabled: true,
      mode: historicalMode,
      labelWarning,
      scoreConfigVersion: query.scoreConfigVersion,
      windowMinutes: query.windowMinutes,
      horizonsMinutes: query.horizonsMinutes,
      side: query.side,
      filters: {
        ...queryFilters(query),
        ruleSide: query.ruleSide ?? null,
        ruleKey: query.ruleKey ?? null,
        minContribution: query.minContribution,
        minSamples: query.minSamples,
        limit: query.limit
      },
      total: rules.length,
      harmfulRuleCount,
      weakRuleCount,
      rules
    };
  }

  async getCoin(query: BacktestCoinQuery) {
    const result = await this.repository.getCoinBacktest(query);
    return {
      generatedAt: new Date().toISOString(),
      enabled: true,
      mode: historicalMode,
      labelWarning,
      coin: query.coin,
      scoreConfigVersion: query.scoreConfigVersion,
      windowMinutes: query.windowMinutes,
      horizonsMinutes: query.horizonsMinutes,
      side: query.side,
      limit: query.limit,
      offset: query.offset,
      filters: queryFilters(query),
      total: result.total,
      summary: result.summary,
      results: result.results
    };
  }
}

function buildConfigComparison(baselineRows: BacktestMetricRow[], candidateRows: BacktestMetricRow[], query: BacktestSummaryQuery): BacktestConfigComparisonRow[] {
  const candidatesByHorizon = new Map(candidateRows.map((row) => [row.horizonMinutes, row]));
  return baselineRows.flatMap((baseline) => {
    const candidate = candidatesByHorizon.get(baseline.horizonMinutes);
    if (!candidate || !query.compareScoreConfigVersion) return [];
    return [{
      baselineVersion: baseline.scoreConfigVersion,
      candidateVersion: query.compareScoreConfigVersion,
      windowMinutes: query.windowMinutes,
      horizonMinutes: baseline.horizonMinutes,
      side: query.side,
      baseline: metricSubset(baseline),
      candidate: metricSubset(candidate),
      delta: {
        sampleCount: candidate.sampleCount - baseline.sampleCount,
        averageForwardReturnPct: deltaOrNull(candidate.averageForwardReturnPct, baseline.averageForwardReturnPct),
        medianForwardReturnPct: deltaOrNull(candidate.medianForwardReturnPct, baseline.medianForwardReturnPct),
        winRate: deltaOrNull(candidate.winRate, baseline.winRate),
        lossRate: deltaOrNull(candidate.lossRate, baseline.lossRate)
      }
    }];
  });
}

function metricSubset(row: BacktestMetricRow): BacktestConfigComparisonRow['baseline'] {
  return {
    sampleCount: row.sampleCount,
    averageForwardReturnPct: row.averageForwardReturnPct,
    medianForwardReturnPct: row.medianForwardReturnPct,
    winRate: row.winRate,
    lossRate: row.lossRate
  };
}

function deltaOrNull(left: number | null, right: number | null): number | null {
  return left === null || right === null ? null : left - right;
}

function queryFilters(query: BacktestSummaryQuery | BacktestBucketQuery | BacktestRulesQuery | BacktestCoinQuery) {
  return {
    from: query.from ?? null,
    to: query.to ?? null,
    minConfidence: query.minConfidence,
    minAbsScore: query.minAbsScore,
    exchange: query.exchange ?? null,
    market: query.market ?? null
  };
}

export function disabledBacktestEnvelope(extra: Record<string, unknown> = {}) {
  return {
    generatedAt: new Date().toISOString(),
    enabled: false,
    state: 'disabled',
    reason: 'score_storage_unavailable',
    mode: historicalMode,
    labelWarning,
    ...extra
  };
}
