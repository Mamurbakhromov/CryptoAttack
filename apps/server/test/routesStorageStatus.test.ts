import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { loadConfig } from '../src/config.js';
import type { DurableIngestionStatus } from '../src/db/durableIngestion.js';
import type { DatabaseHealthSnapshot } from '../src/db/storageHealth.js';
import { EventStore } from '../src/events/eventStore.js';
import { registerHttpRoutes } from '../src/http/routes.js';

describe('storage status routes', () => {
  it('includes disabled storage status in /api/status by default', async () => {
    const app = Fastify({ logger: false });
    await registerHttpRoutes(app, makeDeps());

    const response = await app.inject({ method: 'GET', url: '/api/status' });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.storage).toMatchObject({ enabled: false, state: 'disabled', queueDepth: 0 });
    expect(body.health).toMatchObject({ state: 'disabled', reasons: [] });
    expect(body.database).toMatchObject({ enabled: false, connected: null, migrationVersion: null });
    await app.close();
  });

  it('exposes storage writer status through /api/storage/status', async () => {
    const app = Fastify({ logger: false });
    await registerHttpRoutes(app, makeDeps({ getStorageStatus: () => enabledStatus, getDatabaseHealth: async () => databaseHealth }));

    const response = await app.inject({ method: 'GET', url: '/api/storage/status' });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.health).toMatchObject({ state: 'degraded' });
    expect(body.database).toMatchObject({ enabled: true, connected: true, migrationVersion: '000007', migrationsPending: 0 });
    expect(body.writer).toMatchObject({ queueDepth: 2, failedWrites: 1, lastSuccessfulWrite: '2026-01-01T00:00:01.000Z' });
    expect(body.marketData.forwardReturnBacklog).toMatchObject({ pending: 3, due: 1 });
    expect(body.tableSizes.raw_events).toMatchObject({ estimatedRows: 100, totalBytes: 2048 });
    expect(body.storage).toMatchObject({ enabled: true, connected: true, queueDepth: 2, failed: 1 });
    expect(body.workers.priceCollection).toMatchObject({ enabled: false, state: 'disabled' });
    expect(body.workers.scores).toMatchObject({ enabled: false, state: 'disabled', scoreVersion: 'rule-v1' });
    await app.close();
  });
});

const enabledStatus: DurableIngestionStatus = {
  enabled: true,
  connected: true,
  state: 'running',
  queueDepth: 2,
  maxQueueDepth: 10,
  inFlight: 1,
  accepted: 5,
  writtenJobs: 3,
  writtenEvents: 4,
  writtenEntries: 6,
  dropped: 0,
  failed: 1,
  retried: 2,
  lastAcceptedAt: '2026-01-01T00:00:00.000Z',
  lastWriteAt: '2026-01-01T00:00:01.000Z',
  lastFailureAt: '2026-01-01T00:00:02.000Z',
  lastDropAt: null,
  lastError: 'temporary failure',
  oldestQueuedAt: '2026-01-01T00:00:03.000Z',
  averageWriteMs: 12
};

const databaseHealth: DatabaseHealthSnapshot = {
  enabled: true,
  connected: true,
  lastProbeAt: '2026-01-01T00:00:04.000Z',
  lastProbeError: null,
  migration: { version: '000007', applied: 7, pending: 0, checksumMismatch: false },
  latestPriceTick: { ts: '2026-01-01T00:00:03.000Z', collectedAt: '2026-01-01T00:00:03.500Z', source: 'binance', exchange: 'binance', market: 'spot', symbol: 'BTCUSDT', coin: 'BTC' },
  forwardReturnBacklog: { pending: 3, due: 1, missingPrice: 0, failed: 0, oldestDueTargetTs: '2026-01-01T00:00:00.000Z' },
  tableSizes: { raw_events: { estimatedRows: 100, totalBytes: 2048 } }
};

function makeDeps(overrides: { getStorageStatus?: () => DurableIngestionStatus; getDatabaseHealth?: () => Promise<DatabaseHealthSnapshot> } = {}) {
  return {
    config: loadConfig({}),
    store: new EventStore({ bufferSize: 10, dedupeTtlMs: 60_000, mockMode: true, authEnabled: false }),
    sseHub: { handleStream: vi.fn() },
    symbolCache: { getSymbols: vi.fn(), refresh: vi.fn() },
    spotPerformance: { getPerformance: vi.fn() },
    ...overrides
  } as never;
}
