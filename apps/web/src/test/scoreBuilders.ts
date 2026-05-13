import type { ScoreDetailResponse, ScoreEvidenceItem, ScoreEvidenceResponse, ScoreMarketRegimeResponse, ScoreSnapshotSseEvent, ScoreSummary, ScoreTimelinePoint, ScoreTimelineResponse, ScoreUpdateSseEvent, ScoresListResponse, ScoreWorkerStatus, StorageStatusResponse } from '../types';

export function makeScoreSummary(overrides: Partial<ScoreSummary> = {}): ScoreSummary {
  return {
    coin: 'BTC',
    scoreConfigVersion: 'rule-v1',
    windowMinutes: 15,
    latestScoreTs: '2026-01-01T00:15:00.000Z',
    bullScore: 82.5,
    bearScore: 12,
    netScore: 70.5,
    confidenceScore: 91,
    rank: 1,
    updatedAt: '2026-01-01T00:15:02.000Z',
    dominantSignal: 'price_alert_up',
    marketRegime: 'bullish',
    primaryReason: 'Upward price alert',
    riskTags: ['positive_funding_overheated'],
    evidenceSummary: { total: 3, topRuleKeys: ['price_alert_up'], feedKeys: ['pricealerts'], sides: ['bull', 'risk'] },
    recentScoreDelta: 15.5,
    ...overrides
  };
}

export function makeScoresListResponse(overrides: Partial<ScoresListResponse> = {}): ScoresListResponse {
  return {
    generatedAt: '2026-01-01T00:15:02.000Z',
    enabled: true,
    kind: 'top',
    scoreConfigVersion: 'rule-v1',
    windowMinutes: 15,
    side: 'bull',
    limit: 10,
    filters: { minConfidence: 0, halal: null, exchange: null, market: null, updatedSince: null },
    total: 1,
    scores: [makeScoreSummary()],
    ...overrides
  };
}

export function makeScoreDetailResponse(overrides: Partial<ScoreDetailResponse> = {}): ScoreDetailResponse {
  return {
    generatedAt: '2026-01-01T00:15:02.000Z',
    enabled: true,
    coin: 'BTC',
    scoreConfigVersion: 'rule-v1',
    windowMinutes: 15,
    side: 'net',
    limit: 1,
    filters: { minConfidence: 0, halal: null, exchange: null, market: null, updatedSince: null },
    score: makeScoreSummary(),
    ...overrides
  };
}

export function makeScoreTimelinePoint(overrides: Partial<ScoreTimelinePoint> = {}): ScoreTimelinePoint {
  return {
    scoreSnapshotId: 'snapshot-1',
    ts: '2026-01-01T00:15:00.000Z',
    coin: 'BTC',
    scoreConfigVersion: 'rule-v1',
    windowMinutes: 15,
    bullScore: 82.5,
    bearScore: 12,
    netScore: 70.5,
    confidenceScore: 91,
    eventCount: 4,
    evidenceCount: 3,
    dominantSignal: 'price_alert_up',
    marketRegime: 'bullish',
    primaryReason: 'Upward price alert',
    riskTags: ['positive_funding_overheated'],
    evidenceSummary: { total: 3, topRuleKeys: ['price_alert_up'], feedKeys: ['pricealerts'], sides: ['bull', 'risk'] },
    previousNetScore: 55,
    netScoreDelta: 15.5,
    recentScoreDelta: 15.5,
    scoreHash: 'score-hash',
    evidenceHash: 'evidence-hash',
    computedAt: '2026-01-01T00:15:01.000Z',
    ...overrides
  };
}

export function makeScoreTimelineResponse(overrides: Partial<ScoreTimelineResponse> = {}): ScoreTimelineResponse {
  return {
    generatedAt: '2026-01-01T00:15:02.000Z',
    enabled: true,
    coin: 'BTC',
    scoreConfigVersion: 'rule-v1',
    windowMinutes: 15,
    side: 'net',
    limit: 60,
    filters: { minConfidence: 0, halal: null, exchange: null, market: null, updatedSince: null },
    snapshots: [
      makeScoreTimelinePoint(),
      makeScoreTimelinePoint({ scoreSnapshotId: 'snapshot-2', ts: '2026-01-01T00:00:00.000Z', netScore: 55, recentScoreDelta: 13 }),
      makeScoreTimelinePoint({ scoreSnapshotId: 'snapshot-3', ts: '2025-12-31T23:45:00.000Z', netScore: 42, recentScoreDelta: null })
    ],
    ...overrides
  };
}

export function makeScoreEvidenceItem(overrides: Partial<ScoreEvidenceItem> = {}): ScoreEvidenceItem {
  return {
    evidenceKey: 'evidence-1',
    scoreSnapshotId: 'snapshot-1',
    scoreTs: '2026-01-01T00:15:00.000Z',
    windowMinutes: 15,
    coin: 'BTC',
    eventId: 'event-1',
    eventReceivedAt: '2026-01-01T00:14:00.000Z',
    entryId: 'entry-1',
    feedKey: 'pricealerts',
    signalKey: 'price_alert_up',
    ruleKey: 'price_alert_up',
    side: 'bull',
    contribution: 10,
    confidenceImpact: 2,
    weight: 10,
    decayMultiplier: 0.92,
    value: 4,
    unit: 'percent',
    reason: 'Upward price alert',
    source: 'entry',
    sourceEventIds: ['event-1'],
    sourceReceivedAt: '2026-01-01T00:14:00.000Z',
    payload: { exchange: 'Binance', market: 'spot' },
    ...overrides
  };
}

export function makeScoreEvidenceResponse(overrides: Partial<ScoreEvidenceResponse> = {}): ScoreEvidenceResponse {
  return {
    generatedAt: '2026-01-01T00:15:02.000Z',
    enabled: true,
    coin: 'BTC',
    scoreConfigVersion: 'rule-v1',
    windowMinutes: 15,
    side: 'net',
    limit: 80,
    filters: { minConfidence: 0, halal: null, exchange: null, market: null, updatedSince: null },
    evidence: [
      makeScoreEvidenceItem(),
      makeScoreEvidenceItem({ evidenceKey: 'evidence-2', side: 'bear', ruleKey: 'price_alert_down', signalKey: 'price_alert_down', reason: 'Downward price alert', contribution: 5 }),
      makeScoreEvidenceItem({ evidenceKey: 'evidence-3', side: 'risk', ruleKey: 'positive_funding_overheated', signalKey: 'positive_funding_overheated', feedKey: 'top_funding', reason: 'Overheated positive funding risk', contribution: 3 })
    ],
    ...overrides
  };
}

export function makeScoreMarketRegimeResponse(overrides: Partial<ScoreMarketRegimeResponse> = {}): ScoreMarketRegimeResponse {
  return {
    generatedAt: '2026-01-01T00:15:02.000Z',
    enabled: true,
    scoreConfigVersion: 'rule-v1',
    windowMinutes: 15,
    side: 'net',
    limit: 500,
    filters: { minConfidence: 0, halal: null, exchange: null, market: null, updatedSince: null },
    sampledCoins: 4,
    regime: 'bullish',
    bullishCoinCount: 1,
    bearishCoinCount: 1,
    mixedCount: 1,
    quietCount: 1,
    averageConfidence: 69,
    averageBullScore: 40,
    averageBearScore: 25,
    averageNetScore: 15,
    topSector: null,
    topCategory: null,
    dataFreshness: { latestScoreTs: '2026-01-01T00:15:00.000Z', oldestScoreTs: '2026-01-01T00:00:00.000Z', latestAgeSeconds: 12 },
    leaders: { bull: [makeScoreSummary()], bear: [makeScoreSummary({ coin: 'ETH', marketRegime: 'bearish', bullScore: 10, bearScore: 73, netScore: -63 })], net: [makeScoreSummary()] },
    ...overrides
  };
}

export function makeScoreWorkerStatus(overrides: Partial<ScoreWorkerStatus> = {}): ScoreWorkerStatus {
  return {
    enabled: true,
    state: 'running',
    running: false,
    intervalMs: 30_000,
    scoreVersion: 'rule-v1',
    windowsMinutes: [15],
    queueDepth: 2,
    pendingCoinCount: 3,
    lastTriggeredAt: '2026-01-01T00:14:59.000Z',
    lastTriggerReason: 'ingestion',
    lastRunStartedAt: '2026-01-01T00:15:00.000Z',
    lastRunCompletedAt: '2026-01-01T00:15:01.000Z',
    lastSuccessAt: '2026-01-01T00:15:01.000Z',
    lastFailureAt: null,
    lastError: null,
    processed: 10,
    written: 12,
    skipped: 1,
    failed: 0,
    writtenEvidence: 20,
    latestScoreTs: '2026-01-01T00:15:00.000Z',
    averageRunMs: 250,
    ...overrides
  };
}

export function makeScoreUpdateSseEvent(overrides: Partial<ScoreUpdateSseEvent> = {}): ScoreUpdateSseEvent {
  return {
    generatedAt: '2026-01-01T00:15:03.000Z',
    reason: 'ingestion',
    scoreVersion: 'rule-v1',
    asOf: '2026-01-01T00:15:03.000Z',
    processed: 1,
    written: 1,
    skipped: 0,
    failed: 0,
    evidenceWritten: 1,
    scores: [
      {
        coin: 'BTC',
        windowMinutes: 15,
        ts: '2026-01-01T00:15:03.000Z',
        bullScore: 88,
        bearScore: 9,
        netScore: 79,
        confidenceScore: 93,
        dominantSignal: 'price_alert_up',
        marketRegime: 'bullish',
        previousNetScore: 70.5,
        netScoreDelta: 8.5,
        eventCount: 5,
        evidenceCount: 4,
        scoreHash: 'score-hash-2',
        evidenceHash: 'evidence-hash-2'
      }
    ],
    ...overrides
  };
}

export function makeScoreSnapshotSseEvent(overrides: Partial<ScoreSnapshotSseEvent> = {}): ScoreSnapshotSseEvent {
  return {
    generatedAt: '2026-01-01T00:15:03.000Z',
    scoreVersion: 'rule-v1',
    asOf: '2026-01-01T00:15:03.000Z',
    windowsMinutes: [15],
    scores: makeScoreUpdateSseEvent().scores,
    health: makeScoreWorkerStatus(),
    ...overrides
  };
}

export function makeStorageStatusResponse(overrides: Partial<StorageStatusResponse> = {}): StorageStatusResponse {
  return {
    generatedAt: '2026-01-01T00:15:03.000Z',
    storage: {
      enabled: true,
      connected: true,
      state: 'running',
      queueDepth: 0,
      maxQueueDepth: 100,
      inFlight: 0,
      accepted: 1,
      writtenJobs: 1,
      writtenEvents: 1,
      writtenEntries: 1,
      dropped: 0,
      failed: 0,
      retried: 0,
      lastAcceptedAt: null,
      lastWriteAt: '2026-01-01T00:15:02.000Z',
      lastFailureAt: null,
      lastDropAt: null,
      lastError: null,
      oldestQueuedAt: null,
      averageWriteMs: 5
    },
    workers: {
      priceCollection: makeWorkerStatus(),
      forwardReturns: makeWorkerStatus(),
      scores: makeScoreWorkerStatus()
    },
    ...overrides
  };
}

function makeWorkerStatus() {
  return {
    enabled: false,
    state: 'disabled' as const,
    running: false,
    activeCoinCount: 0,
    intervalMs: 60_000,
    lastRunStartedAt: null,
    lastRunCompletedAt: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastError: null,
    processed: 0,
    written: 0,
    skipped: 0,
    failed: 0,
    averageRunMs: null
  };
}
