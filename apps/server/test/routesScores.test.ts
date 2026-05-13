import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { loadConfig } from '../src/config.js';
import type { ScoreEvidenceReadModel, ScoreRepository, ScoreSummaryReadModel, ScoreTimelineReadModel } from '../src/db/scoreRepository.js';
import { EventStore } from '../src/events/eventStore.js';
import { registerHttpRoutes } from '../src/http/routes.js';
import { defaultScoreConfig } from '../src/scoring/defaultScoreConfig.js';

describe('score API routes', () => {
  it('returns filtered top score summaries', async () => {
    const repository = fakeScoreRepository({ getCurrentScores: vi.fn(async () => [makeScoreSummary()]) });
    const app = Fastify({ logger: false });
    await registerHttpRoutes(app, makeDeps(repository));

    const response = await app.inject({
      method: 'GET',
      url: '/api/scores/top?side=bull&limit=2&minConfidence=70&halal=true&exchange=binance&market=spot&updatedSince=2026-01-01T00:00:00.000Z'
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(repository.getCurrentScores).toHaveBeenCalledWith(expect.objectContaining({
      scoreConfigVersion: 'rule-v1',
      windowMinutes: 15,
      side: 'bull',
      limit: 2,
      minConfidence: 70,
      halal: true,
      exchange: 'binance',
      market: 'spot',
      updatedSince: '2026-01-01T00:00:00.000Z'
    }));
    expect(body).toMatchObject({ enabled: true, kind: 'top', side: 'bull', limit: 2, total: 1 });
    expect(body.scores[0]).toMatchObject({
      coin: 'BTC',
      bullScore: 72.5,
      bearScore: 12.25,
      netScore: 60.25,
      confidenceScore: 88,
      rank: 1,
      primaryReason: 'Upward price alert',
      riskTags: ['positive_funding_overheated'],
      recentScoreDelta: 12.25
    });
    await app.close();
  });

  it('returns disabled empty envelopes when score storage is unavailable', async () => {
    const app = Fastify({ logger: false });
    await registerHttpRoutes(app, makeDeps(null));

    const response = await app.inject({ method: 'GET', url: '/api/scores/current?limit=3' });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body).toMatchObject({ enabled: false, state: 'disabled', reason: 'score_storage_unavailable', total: 0, scores: [] });
    await app.close();
  });

  it('returns coin timelines and evidence', async () => {
    const repository = fakeScoreRepository({
      getScoreTimeline: vi.fn(async () => [makeTimelinePoint()]),
      getScoreEvidence: vi.fn(async () => [makeEvidence()])
    });
    const app = Fastify({ logger: false });
    await registerHttpRoutes(app, makeDeps(repository));

    const timeline = await app.inject({ method: 'GET', url: '/api/scores/btc/timeline?limit=5&minConfidence=50' });
    const evidence = await app.inject({ method: 'GET', url: '/api/scores/btc/evidence?side=bear&exchange=bybit' });

    expect(timeline.statusCode).toBe(200);
    expect(timeline.json().snapshots[0]).toMatchObject({ coin: 'BTC', netScore: 60.25, primaryReason: 'Upward price alert' });
    expect(repository.getScoreTimeline).toHaveBeenCalledWith(expect.objectContaining({ coin: 'BTC', limit: 5, minConfidence: 50 }));
    expect(evidence.statusCode).toBe(200);
    expect(evidence.json().evidence[0]).toMatchObject({ coin: 'BTC', side: 'bull', ruleKey: 'price_alert_up', contribution: 10 });
    expect(repository.getScoreEvidence).toHaveBeenCalledWith(expect.objectContaining({ coin: 'BTC', side: 'bear', exchange: 'bybit' }));
    await app.close();
  });

  it('summarizes market regime from current scores', async () => {
    const repository = fakeScoreRepository({
      getCurrentScores: vi.fn(async () => [
        makeScoreSummary({ coin: 'BTC', marketRegime: 'bullish', netScore: 50, confidenceScore: 80 }),
        makeScoreSummary({ coin: 'ETH', marketRegime: 'bearish', netScore: -30, confidenceScore: 70 }),
        makeScoreSummary({ coin: 'SOL', marketRegime: 'conflicted', netScore: 3, confidenceScore: 60 }),
        makeScoreSummary({ coin: 'DOGE', marketRegime: 'neutral', netScore: 1, confidenceScore: 50 })
      ])
    });
    const app = Fastify({ logger: false });
    await registerHttpRoutes(app, makeDeps(repository));

    const response = await app.inject({ method: 'GET', url: '/api/scores/market-regime?limit=10' });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body).toMatchObject({ bullishCoinCount: 1, bearishCoinCount: 1, mixedCount: 1, quietCount: 1, averageConfidence: 65 });
    expect(body.dataFreshness.latestScoreTs).toBe('2026-01-01T00:15:00.000Z');
    expect(body.leaders.bull[0].coin).toBe('BTC');
    await app.close();
  });

  it('returns the current scoring config contract', async () => {
    const repository = fakeScoreRepository({
      getCurrentScoreConfig: vi.fn(async () => ({
        scoreConfigVersion: 'rule-v1',
        description: 'Transparent rule-based Bull/Bear scoring v1',
        config: defaultScoreConfig,
        active: true,
        activatedAt: '2026-01-01T00:00:00.000Z',
        retiredAt: null
      }))
    });
    const app = Fastify({ logger: false });
    await registerHttpRoutes(app, makeDeps(repository));

    const response = await app.inject({ method: 'GET', url: '/api/scoring/config/current?includeRules=false' });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body).toMatchObject({ storageBacked: true, config: { scoreConfigVersion: 'rule-v1', active: true, rules: [] } });
    await app.close();
  });

  it('rejects invalid score query values', async () => {
    const app = Fastify({ logger: false });
    await registerHttpRoutes(app, makeDeps(fakeScoreRepository()));

    const response = await app.inject({ method: 'GET', url: '/api/scores/top?windowMinutes=999' });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'Invalid query' });
    await app.close();
  });
});

function makeDeps(scoreRepository: ScoreRepository | null = fakeScoreRepository()) {
  return {
    config: loadConfig({}),
    store: new EventStore({ bufferSize: 10, dedupeTtlMs: 60_000, mockMode: true, authEnabled: false }),
    sseHub: { handleStream: vi.fn() },
    symbolCache: { getSymbols: vi.fn(), refresh: vi.fn() },
    spotPerformance: { getPerformance: vi.fn() },
    scoreRepository
  } as never;
}

function fakeScoreRepository(overrides: Partial<ScoreRepository> = {}): ScoreRepository {
  return {
    getCurrentScores: vi.fn(async () => []),
    getScoreTimeline: vi.fn(async () => []),
    getScoreEvidence: vi.fn(async () => []),
    getCurrentScoreConfig: vi.fn(async () => null),
    ...overrides
  } as unknown as ScoreRepository;
}

function makeScoreSummary(overrides: Partial<ScoreSummaryReadModel> = {}): ScoreSummaryReadModel {
  return {
    coin: 'BTC',
    scoreConfigVersion: 'rule-v1',
    windowMinutes: 15,
    latestScoreTs: '2026-01-01T00:15:00.000Z',
    bullScore: 72.5,
    bearScore: 12.25,
    netScore: 60.25,
    confidenceScore: 88,
    rank: 1,
    updatedAt: '2026-01-01T00:15:01.000Z',
    dominantSignal: 'price_alert_up',
    marketRegime: 'bullish',
    primaryReason: 'Upward price alert',
    riskTags: ['positive_funding_overheated'],
    evidenceSummary: { total: 3, topRuleKeys: ['price_alert_up'], feedKeys: ['pricealerts'], sides: ['bull'] },
    recentScoreDelta: 12.25,
    ...overrides
  };
}

function makeTimelinePoint(): ScoreTimelineReadModel {
  const summary = makeScoreSummary();
  return {
    scoreSnapshotId: 'snapshot-1',
    ts: '2026-01-01T00:15:00.000Z',
    coin: summary.coin,
    scoreConfigVersion: summary.scoreConfigVersion,
    windowMinutes: summary.windowMinutes,
    bullScore: summary.bullScore,
    bearScore: summary.bearScore,
    netScore: summary.netScore,
    confidenceScore: summary.confidenceScore,
    dominantSignal: summary.dominantSignal,
    marketRegime: summary.marketRegime,
    primaryReason: summary.primaryReason,
    riskTags: summary.riskTags,
    evidenceSummary: summary.evidenceSummary,
    recentScoreDelta: summary.recentScoreDelta,
    eventCount: 4,
    evidenceCount: 3,
    previousNetScore: 48,
    netScoreDelta: 12.25,
    scoreHash: 'score-hash',
    evidenceHash: 'evidence-hash',
    computedAt: '2026-01-01T00:15:01.000Z'
  };
}

function makeEvidence(): ScoreEvidenceReadModel {
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
    decayMultiplier: 1,
    value: 4,
    unit: 'percent',
    reason: 'Upward price alert',
    source: 'entry',
    sourceEventIds: ['event-1'],
    sourceReceivedAt: '2026-01-01T00:14:00.000Z',
    payload: { exchange: 'Binance' }
  };
}
