import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import type { BacktestService } from '../src/backtest/backtestService.js';
import { loadConfig } from '../src/config.js';
import { EventStore } from '../src/events/eventStore.js';
import { registerHttpRoutes } from '../src/http/routes.js';

describe('backtest API routes', () => {
  it('returns summary analytics and parses horizons, thresholds, and version comparison', async () => {
    const service = fakeBacktestService({ getSummary: vi.fn(async () => ({ enabled: true, metrics: [], precisionByThreshold: [], bullBearSeparation: [], configComparison: [] })) });
    const app = Fastify({ logger: false });
    await registerHttpRoutes(app, makeDeps(service));

    const response = await app.inject({
      method: 'GET',
      url: '/api/backtest/summary?side=bull&horizonMinutes=5,15&thresholds=50,75&compareScoreConfigVersion=rule-v2&minConfidence=60&minAbsScore=25'
    });

    expect(response.statusCode).toBe(200);
    expect(service.getSummary).toHaveBeenCalledWith(expect.objectContaining({
      scoreConfigVersion: 'flow-v2',
      compareScoreConfigVersion: 'rule-v2',
      windowMinutes: 15,
      horizonsMinutes: [5, 15],
      side: 'bull',
      thresholds: [50, 75],
      minConfidence: 60,
      minAbsScore: 25
    }));
    await app.close();
  });

  it('returns disabled historical envelopes when score storage is unavailable', async () => {
    const app = Fastify({ logger: false });
    await registerHttpRoutes(app, makeDeps(null));

    const response = await app.inject({ method: 'GET', url: '/api/backtest/rules?horizonMinutes=60' });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body).toMatchObject({ enabled: false, state: 'disabled', reason: 'score_storage_unavailable', mode: 'historical_backtest', total: 0, rules: [] });
    await app.close();
  });

  it('returns score buckets and coin detail through the service', async () => {
    const service = fakeBacktestService({
      getScoreBuckets: vi.fn(async () => ({ enabled: true, scoreBuckets: [], confidenceBuckets: [] })),
      getCoin: vi.fn(async () => ({ enabled: true, coin: 'BTC', total: 0, results: [], summary: null }))
    });
    const app = Fastify({ logger: false });
    await registerHttpRoutes(app, makeDeps(service));

    const buckets = await app.inject({ method: 'GET', url: '/api/backtest/score-buckets?bucketSize=20&confidenceBucketSize=25&minSamples=2' });
    const coin = await app.inject({ method: 'GET', url: '/api/backtest/coin/btc?horizonMinutes=60&limit=5&sort=abs_score_desc' });

    expect(buckets.statusCode).toBe(200);
    expect(service.getScoreBuckets).toHaveBeenCalledWith(expect.objectContaining({ bucketSize: 20, confidenceBucketSize: 25, minSamples: 2 }));
    expect(coin.statusCode).toBe(200);
    expect(service.getCoin).toHaveBeenCalledWith(expect.objectContaining({ coin: 'BTC', horizonsMinutes: [60], limit: 5, sort: 'abs_score_desc' }));
    await app.close();
  });

  it('rejects invalid backtest horizons', async () => {
    const app = Fastify({ logger: false });
    await registerHttpRoutes(app, makeDeps(fakeBacktestService()));

    const response = await app.inject({ method: 'GET', url: '/api/backtest/summary?horizonMinutes=999' });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'Invalid query' });
    await app.close();
  });

  it('uses configured forward-return horizons for defaults and validation', async () => {
    const service = fakeBacktestService();
    const app = Fastify({ logger: false });
    await registerHttpRoutes(app, makeDeps(service, loadConfig({ FORWARD_RETURN_HORIZONS_MINUTES: '30,90' })));

    const defaultResponse = await app.inject({ method: 'GET', url: '/api/backtest/summary' });
    const invalidResponse = await app.inject({ method: 'GET', url: '/api/backtest/summary?horizonMinutes=5' });

    expect(defaultResponse.statusCode).toBe(200);
    expect(service.getSummary).toHaveBeenCalledWith(expect.objectContaining({ horizonsMinutes: [30, 90] }));
    expect(invalidResponse.statusCode).toBe(400);
    expect(invalidResponse.json()).toMatchObject({ error: 'Invalid query' });
    await app.close();
  });

  it('rejects malformed comma-separated backtest lists', async () => {
    const service = fakeBacktestService();
    const app = Fastify({ logger: false });
    await registerHttpRoutes(app, makeDeps(service));

    const response = await app.inject({ method: 'GET', url: '/api/backtest/summary?horizonMinutes=5,abc' });

    expect(response.statusCode).toBe(400);
    expect(service.getSummary).not.toHaveBeenCalled();
    await app.close();
  });

  it('uses existing dashboard auth for backtest endpoints', async () => {
    const app = Fastify({ logger: false });
    await registerHttpRoutes(app, makeDeps(fakeBacktestService(), loadConfig({ DASHBOARD_AUTH_ENABLED: 'true', DASHBOARD_AUTH_TOKEN: 'secret-token' })));

    const unauthorized = await app.inject({ method: 'GET', url: '/api/backtest/summary' });
    const authorized = await app.inject({ method: 'GET', url: '/api/backtest/summary', headers: { authorization: 'Bearer secret-token' } });

    expect(unauthorized.statusCode).toBe(401);
    expect(authorized.statusCode).toBe(200);
    await app.close();
  });
});

function makeDeps(backtestService: BacktestService | null = fakeBacktestService(), config = loadConfig({})) {
  return {
    config,
    store: new EventStore({ bufferSize: 10, dedupeTtlMs: 60_000, mockMode: true, authEnabled: config.dashboardAuthEnabled }),
    sseHub: { handleStream: vi.fn() },
    symbolCache: { getSymbols: vi.fn(), refresh: vi.fn() },
    spotPerformance: { getPerformance: vi.fn() },
    backtestService
  } as never;
}

function fakeBacktestService(overrides: Record<string, unknown> = {}): BacktestService {
  return {
    getSummary: vi.fn(async () => ({ enabled: true, metrics: [], precisionByThreshold: [], bullBearSeparation: [], configComparison: [] })),
    getScoreBuckets: vi.fn(async () => ({ enabled: true, scoreBuckets: [], confidenceBuckets: [] })),
    getRules: vi.fn(async () => ({ enabled: true, total: 0, harmfulRuleCount: 0, weakRuleCount: 0, rules: [] })),
    getCoin: vi.fn(async () => ({ enabled: true, total: 0, summary: null, results: [] })),
    ...overrides
  } as unknown as BacktestService;
}
