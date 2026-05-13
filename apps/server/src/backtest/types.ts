export type BacktestSide = 'bull' | 'bear' | 'net';
export type BacktestRuleSide = 'bull' | 'bear' | 'risk' | 'confidence';

export interface BacktestQuery {
  scoreConfigVersion: string;
  windowMinutes: number;
  horizonsMinutes: number[];
  side: BacktestSide;
  from?: string;
  to?: string;
  minConfidence: number;
  minAbsScore: number;
  exchange?: string;
  market?: string;
}

export interface BacktestSummaryQuery extends BacktestQuery {
  thresholds: number[];
  separationThreshold: number;
  compareScoreConfigVersion?: string;
}

export interface BacktestBucketQuery extends BacktestQuery {
  bucketSize: number;
  confidenceBucketSize: number;
  minSamples: number;
}

export interface BacktestRulesQuery extends BacktestQuery {
  ruleSide?: BacktestRuleSide;
  ruleKey?: string;
  minContribution: number;
  minSamples: number;
  limit: number;
}

export interface BacktestCoinQuery extends BacktestQuery {
  coin: string;
  limit: number;
  offset: number;
  includeRules: boolean;
  sort: 'scoreTs_desc' | 'return_desc' | 'return_asc' | 'abs_score_desc';
}

export interface BacktestMetricRow {
  scoreConfigVersion: string;
  windowMinutes: number;
  horizonMinutes: number;
  side: BacktestSide;
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

export interface BacktestThresholdRow {
  scoreConfigVersion: string;
  windowMinutes: number;
  horizonMinutes: number;
  side: BacktestSide;
  threshold: number;
  sampleCount: number;
  precision: number | null;
  winRate: number | null;
  lossRate: number | null;
  averageForwardReturnPct: number | null;
  medianForwardReturnPct: number | null;
}

export interface BacktestBucketRow {
  scoreConfigVersion: string;
  windowMinutes: number;
  horizonMinutes: number;
  side: BacktestSide;
  bucketType: 'score' | 'confidence';
  bucketStart: number;
  bucketEnd: number;
  sampleCount: number;
  averageScore: number | null;
  averageConfidenceScore: number | null;
  averageForwardReturnPct: number | null;
  medianForwardReturnPct: number | null;
  winRate: number | null;
  lossRate: number | null;
  averageMaxAdverseMovePct: number | null;
}

export interface BacktestSeparationRow {
  scoreConfigVersion: string;
  windowMinutes: number;
  horizonMinutes: number;
  threshold: number;
  bullSampleCount: number;
  bearSampleCount: number;
  bullAverageReturnPct: number | null;
  bearAverageReturnPct: number | null;
  spreadPct: number | null;
  bullWinRate: number | null;
  bearWinRate: number | null;
  conflictCount: number;
}

export interface BacktestRuleRow {
  scoreConfigVersion: string;
  windowMinutes: number;
  horizonMinutes: number;
  ruleKey: string;
  side: BacktestRuleSide;
  sampleCount: number;
  evidenceCount: number;
  averageContribution: number | null;
  averageConfidenceImpact: number | null;
  averageForwardReturnPct: number | null;
  medianForwardReturnPct: number | null;
  winRate: number | null;
  lossRate: number | null;
  averageMaxAdverseMovePct: number | null;
  liftVsAllSignals: number | null;
  flags: string[];
}

export interface BacktestConfigComparisonRow {
  baselineVersion: string;
  candidateVersion: string;
  windowMinutes: number;
  horizonMinutes: number;
  side: BacktestSide;
  baseline: Pick<BacktestMetricRow, 'sampleCount' | 'averageForwardReturnPct' | 'medianForwardReturnPct' | 'winRate' | 'lossRate'>;
  candidate: Pick<BacktestMetricRow, 'sampleCount' | 'averageForwardReturnPct' | 'medianForwardReturnPct' | 'winRate' | 'lossRate'>;
  delta: {
    sampleCount: number;
    averageForwardReturnPct: number | null;
    medianForwardReturnPct: number | null;
    winRate: number | null;
    lossRate: number | null;
  };
}

export interface BacktestCoinResultRow {
  scoreSnapshotId: string;
  scoreTs: string;
  scoreConfigVersion: string;
  windowMinutes: number;
  horizonMinutes: number;
  coin: string;
  bullScore: number;
  bearScore: number;
  netScore: number;
  confidenceScore: number;
  marketRegime: string | null;
  dominantSignal: string | null;
  score: number;
  returnPct: number | null;
  directionalReturnPct: number | null;
  maxReturnPct: number | null;
  minReturnPct: number | null;
  maxAdverseMovePct: number | null;
  status: string;
  hit: boolean | null;
  labelCount: number;
  topRules: string[];
}

export interface BacktestCoinReadModel {
  total: number;
  results: BacktestCoinResultRow[];
  summary: BacktestMetricRow | null;
}
