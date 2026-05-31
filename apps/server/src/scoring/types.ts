export type ScoreSide = 'bull' | 'bear' | 'risk' | 'confidence';

export interface ScoreWindowConfig {
  minutes: number;
  halfLifeMinutes: number;
  maxAgeMinutes: number;
}

export interface ScoreRuleConfig {
  ruleKey: string;
  feedKeys: string[];
  side: ScoreSide;
  baseWeight: number;
  scale: 'fixed' | 'logUsd' | 'percentAbs' | 'ranked';
  valueField?: keyof Pick<ScoreSourceRow, 'amountUsd' | 'deltaUsd' | 'percent' | 'priceChangePercent' | 'oiChange15mPercent' | 'oiChange30mPercent' | 'totalAlerts'>;
  minValue?: number;
  maxContribution: number;
  reasonTemplate: string;
}

export interface ScoreConfig {
  version: string;
  engine?: 'rule-v1' | 'flow-v2';
  description: string;
  windows: ScoreWindowConfig[];
  sideSaturation: number;
  materialChange: {
    minNetDelta: number;
    minSideDelta: number;
    minConfidenceDelta: number;
  };
  confidence: {
    base: number;
    evidenceCountCap: number;
    feedDiversityCap: number;
    signalDiversityCap: number;
    exchangeBreadthCap: number;
    parserPenalty: number;
    conflictPenalty: number;
    stalePenalty: number;
    singleFeedPenalty: number;
    burstPenalty: number;
  };
  burst: {
    threshold: number;
    maxBonus: number;
  };
  rules: ScoreRuleConfig[];
}

export interface ScoreSourceRow {
  source: 'entry' | 'event';
  eventId: string;
  eventReceivedAt: string;
  entryId: string | null;
  feedKey: string;
  coin: string;
  parserStatus: 'parsed' | 'parser_needs_sample' | 'not_applicable';
  receivedAt: string;
  rank: number | null;
  amountUsd: number | null;
  deltaUsd: number | null;
  buyUsd: number | null;
  sellUsd: number | null;
  buySellRatio: number | null;
  volume24hUsd: number | null;
  percent: number | null;
  priceChangePercent: number | null;
  oiChange15mPercent: number | null;
  oiChange30mPercent: number | null;
  totalAlerts: number | null;
  direction: string | null;
  exchange: string | null;
  market?: string | null;
  rawLine: string | null;
}

export interface ScoreEvidenceOutput {
  evidenceKey: string;
  coin: string;
  side: ScoreSide;
  ruleKey: string;
  contribution: number;
  confidenceImpact: number;
  weight: number;
  decayMultiplier: number;
  value: number | null;
  unit: string | null;
  source: 'entry' | 'event' | 'aggregate';
  feedKey: string;
  eventId: string | null;
  eventReceivedAt: string | null;
  entryId: string | null;
  sourceEventIds: string[];
  sourceReceivedAt: string;
  reason: string;
  payload: Record<string, unknown>;
}

export interface ScoreResult {
  scoreConfigVersion: string;
  ts: string;
  windowMinutes: number;
  coin: string;
  bullScore: number;
  bearScore: number;
  netScore: number;
  confidenceScore: number;
  eventCount: number;
  evidenceCount: number;
  dominantSignal: string | null;
  marketRegime: 'bullish' | 'bearish' | 'conflicted' | 'neutral' | 'thin_data';
  previousNetScore?: number | null;
  netScoreDelta?: number | null;
  scoreHash: string;
  evidenceHash: string;
  payload: Record<string, unknown>;
  evidence: ScoreEvidenceOutput[];
}
