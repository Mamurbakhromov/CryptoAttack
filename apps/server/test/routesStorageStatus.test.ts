import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { loadConfig } from '../src/config.js';
import type { DurableIngestionStatus } from '../src/db/durableIngestion.js';
import type { DatabaseHealthSnapshot } from '../src/db/storageHealth.js';
import { EventStore } from '../src/events/eventStore.js';
import type { FeedKey, NormalizedEvent } from '../src/events/types.js';
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
    expect(body.database).toMatchObject({ enabled: true, connected: true, migrationVersion: '000009', migrationsPending: 0 });
    expect(body.writer).toMatchObject({ queueDepth: 2, failedWrites: 1, lastSuccessfulWrite: '2026-01-01T00:00:01.000Z' });
    expect(body.tableSizes.raw_events).toMatchObject({ estimatedRows: 100, totalBytes: 2048 });
    expect(body.storage).toMatchObject({ enabled: true, connected: true, queueDepth: 2, failed: 1 });
    expect(body).not.toHaveProperty('workers');
    expect(body).not.toHaveProperty('scoring');
    expect(body).not.toHaveProperty('marketData');
    await app.close();
  });

  it('clears live and durable event data after confirmation calls the API', async () => {
    const store = new EventStore({ bufferSize: 10, dedupeTtlMs: 60_000, mockMode: true, authEnabled: false });
    store.addEvent(makeEvent('listing-one', 'listings'));
    const clearEventData = vi.fn().mockResolvedValue({ clearedAt: '2026-01-01T00:00:05.000Z', tables: ['event_entries', 'normalized_events', 'raw_events'] });
    const clearAllStoredData = vi.fn();
    const sseHub = { handleStream: vi.fn(), broadcastSnapshot: vi.fn(), broadcastStorageStatus: vi.fn() };
    const app = Fastify({ logger: false });
    await registerHttpRoutes(app, makeDeps({
      store,
      sseHub,
      eventMaintenance: { clearEventData, clearAllStoredData },
      getStorageStatus: () => ({ ...enabledStatus, queueDepth: 0, inFlight: 0 }),
      getDatabaseHealth: async () => databaseHealth
    }));

    const response = await app.inject({ method: 'DELETE', url: '/api/storage/events', headers: adminHeaders() });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(clearEventData).toHaveBeenCalledTimes(1);
    expect(body.database.tables).toEqual(['event_entries', 'normalized_events', 'raw_events']);
    expect(body.snapshot.feeds.listings.events).toEqual([]);
    expect(body.status.counters.stored).toBe(0);
    expect(sseHub.broadcastSnapshot).toHaveBeenCalledTimes(1);
    expect(sseHub.broadcastStorageStatus).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it('resets all stored data and raw log state', async () => {
    const store = new EventStore({ bufferSize: 10, dedupeTtlMs: 60_000, mockMode: true, authEnabled: false });
    store.addEvent(makeEvent('listing-two', 'listings'));
    const clearEventData = vi.fn();
    const clearAllStoredData = vi.fn().mockResolvedValue({ clearedAt: '2026-01-01T00:00:06.000Z', tables: ['event_entries', 'normalized_events', 'raw_events'] });
    const sseHub = { handleStream: vi.fn(), broadcastSnapshot: vi.fn(), broadcastStorageStatus: vi.fn() };
    const app = Fastify({ logger: false });
    await registerHttpRoutes(app, makeDeps({
      config: loadConfig({ DASHBOARD_ADMIN_TOKEN: 'admin-secret', LOG_RAW_EVENTS: 'false' }),
      store,
      sseHub,
      eventMaintenance: { clearEventData, clearAllStoredData },
      getStorageStatus: () => ({ ...enabledStatus, queueDepth: 0, inFlight: 0 }),
      getDatabaseHealth: async () => databaseHealth
    }));

    const response = await app.inject({ method: 'DELETE', url: '/api/storage/all-data', headers: adminHeaders() });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(clearAllStoredData).toHaveBeenCalledTimes(1);
    expect(clearEventData).not.toHaveBeenCalled();
    expect(body.database.tables).toEqual(['event_entries', 'normalized_events', 'raw_events']);
    expect(body.rawLog.reason).toBe('raw_logging_disabled');
    expect(body).not.toHaveProperty('runtime');
    expect(body.snapshot.feeds.listings.events).toEqual([]);
    expect(body).not.toHaveProperty('scoreSnapshot');
    expect(sseHub.broadcastStorageStatus).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it('deletes durable history older than seven days through an admin-only route', async () => {
    const clearEventData = vi.fn();
    const clearAllStoredData = vi.fn();
    const deleteHistoryOlderThan = vi.fn().mockResolvedValue({
      prunedAt: '2026-01-08T00:00:00.000Z',
      cutoff: '2026-01-01T00:00:00.000Z',
      retentionDays: 7,
      rowsDeleted: 42,
      tables: [{ table: 'raw_events', rowsDeleted: 12 }]
    });
    const sseHub = { handleStream: vi.fn(), broadcastSnapshot: vi.fn(), broadcastStorageStatus: vi.fn() };
    const app = Fastify({ logger: false });
    await registerHttpRoutes(app, makeDeps({
      config: loadConfig({ DASHBOARD_ADMIN_TOKEN: 'admin-secret', LOG_RAW_EVENTS: 'false' }),
      sseHub,
      eventMaintenance: { clearEventData, clearAllStoredData, deleteHistoryOlderThan },
      getStorageStatus: () => ({ ...enabledStatus, queueDepth: 0, inFlight: 0 }),
      getDatabaseHealth: async () => databaseHealth
    }));

    const response = await app.inject({ method: 'DELETE', url: '/api/storage/history/older-than-7-days', headers: adminHeaders() });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(deleteHistoryOlderThan).toHaveBeenCalledWith(7, expect.any(Date));
    expect(clearEventData).not.toHaveBeenCalled();
    expect(clearAllStoredData).not.toHaveBeenCalled();
    expect(body.retentionDays).toBe(7);
    expect(body.database.rowsDeleted).toBe(42);
    expect(body.rawLog.reason).toBe('raw_logging_disabled');
    expect(sseHub.broadcastSnapshot).not.toHaveBeenCalled();
    expect(sseHub.broadcastStorageStatus).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it('refuses to clear event data while durable writes are still in flight', async () => {
    const clearEventData = vi.fn();
    const clearAllStoredData = vi.fn();
    const app = Fastify({ logger: false });
    await registerHttpRoutes(app, makeDeps({
      eventMaintenance: { clearEventData, clearAllStoredData },
      getStorageStatus: () => ({ ...enabledStatus, queueDepth: 1, inFlight: 0 })
    }));

    const response = await app.inject({ method: 'DELETE', url: '/api/storage/events', headers: adminHeaders() });
    const body = response.json();

    expect(response.statusCode).toBe(409);
    expect(body.reason).toBe('storage_writer_busy');
    expect(clearEventData).not.toHaveBeenCalled();
    await app.close();
  });

  it('requires a separate admin token for destructive storage routes', async () => {
    const clearEventData = vi.fn().mockResolvedValue({ clearedAt: '2026-01-01T00:00:05.000Z', tables: [] });
    const clearAllStoredData = vi.fn();
    const app = Fastify({ logger: false });
    await registerHttpRoutes(app, makeDeps({
      config: loadConfig({
        DASHBOARD_AUTH_ENABLED: 'true',
        DASHBOARD_AUTH_TOKEN: 'dashboard-secret',
        DASHBOARD_ADMIN_TOKEN: 'admin-secret'
      }),
      eventMaintenance: { clearEventData, clearAllStoredData },
      getStorageStatus: () => ({ ...enabledStatus, queueDepth: 0, inFlight: 0 })
    }));

    const readResponse = await app.inject({
      method: 'GET',
      url: '/api/storage/status',
      headers: { authorization: 'Bearer dashboard-secret' }
    });
    const dashboardDeleteResponse = await app.inject({
      method: 'DELETE',
      url: '/api/storage/events',
      headers: { authorization: 'Bearer dashboard-secret' }
    });
    const adminDeleteResponse = await app.inject({
      method: 'DELETE',
      url: '/api/storage/events',
      headers: {
        authorization: 'Bearer dashboard-secret',
        'x-dashboard-admin-token': 'admin-secret'
      }
    });

    expect(readResponse.statusCode).toBe(200);
    expect(dashboardDeleteResponse.statusCode).toBe(403);
    expect(dashboardDeleteResponse.json()).toMatchObject({ error: 'Forbidden', reason: 'admin_token_required' });
    expect(adminDeleteResponse.statusCode).toBe(200);
    expect(clearEventData).toHaveBeenCalledTimes(1);
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
  migration: { version: '000009', applied: 9, pending: 0, checksumMismatch: false },
  tableSizes: { raw_events: { estimatedRows: 100, totalBytes: 2048 } }
};

function makeDeps(overrides: {
  config?: ReturnType<typeof loadConfig>;
  store?: EventStore;
  sseHub?: { handleStream: ReturnType<typeof vi.fn>; broadcastSnapshot: ReturnType<typeof vi.fn>; broadcastStorageStatus: ReturnType<typeof vi.fn> };
  eventMaintenance?: {
    clearEventData: ReturnType<typeof vi.fn>;
    clearAllStoredData: ReturnType<typeof vi.fn>;
    deleteHistoryOlderThan?: ReturnType<typeof vi.fn>;
  };
  getStorageStatus?: () => DurableIngestionStatus;
  getDatabaseHealth?: () => Promise<DatabaseHealthSnapshot>;
} = {}) {
  return {
    config: loadConfig({ DASHBOARD_ADMIN_TOKEN: 'admin-secret' }),
    store: new EventStore({ bufferSize: 10, dedupeTtlMs: 60_000, mockMode: true, authEnabled: false }),
    sseHub: { handleStream: vi.fn(), broadcastSnapshot: vi.fn(), broadcastStorageStatus: vi.fn() },
    symbolCache: { getSymbols: vi.fn(), refresh: vi.fn() },
    spotPerformance: { getPerformance: vi.fn() },
    ...overrides
  } as never;
}

function adminHeaders() {
  return { 'x-dashboard-admin-token': 'admin-secret' };
}

function makeEvent(id: string, feedKey: FeedKey): NormalizedEvent {
  return {
    id,
    feedKey,
    chapter: 'cex_alerts',
    category: 'listings',
    title: 'Test Event',
    plainText: 'Test event',
    htmlText: 'Test event',
    coins: ['BTC'],
    filters: [],
    timestamp: '2026-01-01T00:00:00.000Z',
    sourceTime: null,
    receivedAt: '2026-01-01T00:00:00.000Z',
    latencyMs: 10,
    severity: 'info',
    raw: {},
    endpoint: 'mock',
    entries: [],
    amountMetric: null,
    parserStatus: 'not_applicable'
  };
}
