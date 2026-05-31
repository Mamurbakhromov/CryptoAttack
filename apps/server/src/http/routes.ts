import { timingSafeEqual } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { rename, stat, truncate, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { finished } from 'node:stream/promises';
import { once } from 'node:events';

import cors from '@fastify/cors';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { fetchBinanceOpenInterest } from '../binance/openInterest.js';
import type { AppConfig } from '../config.js';
import { disabledDurableIngestionStatus, type DurableIngestionStatus } from '../db/durableIngestion.js';
import type { ClearEventDataResult, DeleteHistoryOlderThanResult } from '../db/eventRepository.js';
import { disabledDatabaseHealth, type DatabaseHealthSnapshot } from '../db/storageHealth.js';
import {
  disabledAmountsFeedHistoryResponse,
  disabledAmountsHistoryResponse,
  disabledTopOiFeedHistoryResponse,
  disabledTopOiHistoryResponse,
  disabledTopSpotFeedHistoryResponse,
  disabledTopSpotHistoryResponse,
  type AmountsHistoryQuery,
  type TopOiHistoryQuery,
  type TopSpotFeedHistoryQuery,
  type TopSpotHistoryQuery,
  type TopSpotHistoryRepository
} from '../db/topSpotHistoryRepository.js';
import type { SpotPerformanceService } from '../exchanges/spotPerformance.js';
import type { ExchangeSymbolCache } from '../exchanges/symbolCache.js';
import { exchangeKeys, exchangeMarkets } from '../exchanges/types.js';
import type { EventStore } from '../events/eventStore.js';
import { feedKeys } from '../events/types.js';
import type { StartupWarning } from '../ops/startupWarnings.js';
import type { SseHub } from './sse.js';

const EventsQuerySchema = z.object({
  feedKey: z.enum(feedKeys).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100)
});

const ExchangeSymbolsQuerySchema = z.object({
  exchange: z.enum(exchangeKeys).optional(),
  market: z.enum(exchangeMarkets).optional(),
  search: z.string().trim().max(80).optional(),
  quoteAsset: z.string().trim().max(20).optional(),
  status: z.enum(['active', 'inactive', 'unknown', 'all']).default('active'),
  limit: z.coerce.number().int().min(1).max(10_000).default(500),
  offset: z.coerce.number().int().min(0).default(0)
});

const SpotPerformanceQuerySchema = z.object({
  exchange: z.enum(exchangeKeys).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(10)
});

const BinanceOpenInterestQuerySchema = z.object({
  coin: z.string().trim().regex(/^[a-z0-9]{1,20}$/i).optional(),
  symbol: z.string().trim().regex(/^[a-z0-9]{2,30}$/i).optional(),
  period: z.enum(['5m', '15m', '30m', '1h']).default('5m'),
  limit: z.coerce.number().int().min(7).max(100).default(12),
  endTime: z.string().trim().max(40).optional()
});

const IsoDateQuerySchema = z.string().trim().refine((value) => Number.isFinite(Date.parse(value)), 'Invalid date').transform((value) => new Date(value).toISOString());

const CoinParamsSchema = z.object({
  coin: z.string().trim().regex(/^[a-z0-9]{1,30}$/i).transform((value) => value.toUpperCase())
});

const TopSpotHistoryQuerySchema = z.object({
  from: IsoDateQuerySchema,
  to: IsoDateQuerySchema,
  market: z.enum(['spot', 'perpetual']),
  side: z.enum(['buy', 'sell'])
});

const TopOiHistoryQuerySchema = z.object({
  from: IsoDateQuerySchema,
  to: IsoDateQuerySchema,
  side: z.enum(['gainer', 'loser'])
});

const TopSpotFeedHistoryQuerySchema = z.object({
  from: IsoDateQuerySchema,
  to: IsoDateQuerySchema
});

const MANUAL_HISTORY_RETENTION_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

interface RawLogResetResult {
  path: string;
  cleared: boolean;
  missing: boolean;
  bytesBefore: number | null;
  reason: string | null;
}

interface RawLogPruneResult {
  path: string;
  enabled: boolean;
  missing: boolean;
  bytesBefore: number | null;
  bytesAfter: number | null;
  linesBefore: number;
  linesAfter: number;
  deletedLines: number;
  invalidLinesKept: number;
  reason: string | null;
}

interface RouteDeps {
  config: AppConfig;
  store: EventStore;
  sseHub: SseHub;
  symbolCache: ExchangeSymbolCache;
  spotPerformance: SpotPerformanceService;
  eventMaintenance?: {
    clearEventData(): Promise<ClearEventDataResult>;
    clearAllStoredData(): Promise<ClearEventDataResult>;
    deleteHistoryOlderThan(retentionDays: number, now?: Date): Promise<DeleteHistoryOlderThanResult>;
  } | null;
  topSpotHistoryRepository?: Pick<
    TopSpotHistoryRepository,
    'getTopSpotFeedHistory' | 'getTopSpotHistory' | 'getTopOiFeedHistory' | 'getTopOiHistory' | 'getAmountsFeedHistory' | 'getAmountsHistory'
  > | null;
  getStorageStatus?: () => DurableIngestionStatus;
  getDatabaseHealth?: () => Promise<DatabaseHealthSnapshot | null> | DatabaseHealthSnapshot | null;
  startupWarnings?: StartupWarning[];
}

export async function registerHttpRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  await app.register(cors, {
    origin: deps.config.webOrigin === '*' ? true : deps.config.webOrigin,
    methods: ['GET', 'POST', 'DELETE'],
    credentials: false
  });

  app.get('/health', async () => ({
    ok: true,
    uptime: process.uptime(),
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString()
  }));

  const requireAuth = async (request: FastifyRequest, reply: FastifyReply) => {
    if (isAuthorized(request, deps.config)) return;
    await reply.code(401).send({ error: 'Unauthorized' });
  };

  const requireAdminAuth = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!isAuthorized(request, deps.config)) {
      await reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    if (isAdminAuthorized(request, deps.config)) return;
    await reply.code(403).send({ error: 'Forbidden', reason: 'admin_token_required' });
  };

  const getStorageStatus = () => deps.getStorageStatus?.() ?? disabledDurableIngestionStatus();

  app.get('/api/status', { preHandler: requireAuth }, async () => ({
    ...deps.store.getStatus(),
    ...(await buildStorageStatusResponse(deps, getStorageStatus()))
  }));

  app.get('/api/storage/status', { preHandler: requireAuth }, async () => buildStorageStatusResponse(deps, getStorageStatus()));

  app.delete('/api/storage/events', { preHandler: requireAdminAuth }, async (_request, reply) => {
    const storage = getStorageStatus();
    if (storage.queueDepth > 0 || storage.inFlight > 0) {
      return reply.code(409).send({
        error: 'Storage writer is busy',
        reason: 'storage_writer_busy',
        queueDepth: storage.queueDepth,
        inFlight: storage.inFlight
      });
    }

    if (deps.config.database.storageEnabled && !deps.eventMaintenance) {
      return reply.code(503).send({
        error: 'Database event maintenance is unavailable',
        reason: 'event_storage_unavailable'
      });
    }

    const database = deps.eventMaintenance ? await deps.eventMaintenance.clearEventData() : null;
    deps.store.clearEventData();
    deps.sseHub.broadcastSnapshot();
    const storageStatus = await buildStorageStatusResponse(deps, getStorageStatus());
    deps.sseHub.broadcastStorageStatus({
      generatedAt: storageStatus.generatedAt,
      storage: storageStatus.storage
    });

    return {
      generatedAt: new Date().toISOString(),
      clearedAt: database?.clearedAt ?? new Date().toISOString(),
      inMemory: { cleared: true },
      database,
      snapshot: deps.store.getSnapshot(),
      status: {
        ...deps.store.getStatus(),
        ...storageStatus
      },
      storageStatus
    };
  });

  app.delete('/api/storage/all-data', { preHandler: requireAdminAuth }, async (_request, reply) => {
    const storage = getStorageStatus();
    const busy = getFullResetBusyState(storage);
    if (busy) return reply.code(409).send(busy);

    if (deps.config.database.storageEnabled && !deps.eventMaintenance) {
      return reply.code(503).send({
        error: 'Database event maintenance is unavailable',
        reason: 'event_storage_unavailable'
      });
    }

    const database = deps.eventMaintenance ? await deps.eventMaintenance.clearAllStoredData() : null;
    const rawLog = await resetRawEventLog(deps.config);
    deps.store.clearEventData();
    deps.sseHub.broadcastSnapshot();
    const storageStatus = await buildStorageStatusResponse(deps, getStorageStatus());
    deps.sseHub.broadcastStorageStatus({
      generatedAt: storageStatus.generatedAt,
      storage: storageStatus.storage
    });

    return {
      generatedAt: new Date().toISOString(),
      resetAt: database?.clearedAt ?? new Date().toISOString(),
      inMemory: { cleared: true },
      database,
      rawLog,
      snapshot: deps.store.getSnapshot(),
      status: {
        ...deps.store.getStatus(),
        ...storageStatus
      },
      storageStatus
    };
  });

  app.delete('/api/storage/history/older-than-7-days', { preHandler: requireAdminAuth }, async (_request, reply) => {
    const storage = getStorageStatus();
    const busy = getFullResetBusyState(storage);
    if (busy) return reply.code(409).send(busy);

    if (deps.config.database.storageEnabled && !deps.eventMaintenance) {
      return reply.code(503).send({
        error: 'Database event maintenance is unavailable',
        reason: 'event_storage_unavailable'
      });
    }

    const now = new Date();
    const cutoff = new Date(now.getTime() - MANUAL_HISTORY_RETENTION_DAYS * DAY_MS).toISOString();
    const database = deps.eventMaintenance ? await deps.eventMaintenance.deleteHistoryOlderThan(MANUAL_HISTORY_RETENTION_DAYS, now) : null;
    const rawLog = await pruneRawEventLogOlderThan(deps.config, database?.cutoff ?? cutoff);
    const storageStatus = await buildStorageStatusResponse(deps, getStorageStatus());
    deps.sseHub.broadcastStorageStatus({
      generatedAt: storageStatus.generatedAt,
      storage: storageStatus.storage
    });

    return {
      generatedAt: new Date().toISOString(),
      prunedAt: database?.prunedAt ?? new Date().toISOString(),
      retentionDays: MANUAL_HISTORY_RETENTION_DAYS,
      cutoff: database?.cutoff ?? cutoff,
      database,
      rawLog,
      status: {
        ...deps.store.getStatus(),
        ...storageStatus
      },
      storageStatus
    };
  });

  app.get('/api/history/top-spot', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = TopSpotFeedHistoryQuerySchema.safeParse(request.query);
    if (!parsed.success) return invalidQuery(reply, parsed.error);
    const query: TopSpotFeedHistoryQuery = parsed.data;
    if (Date.parse(query.from) >= Date.parse(query.to)) {
      return reply.code(400).send({ error: 'Invalid query', details: { fieldErrors: { to: ['to must be later than from'] } } });
    }
    if (!deps.topSpotHistoryRepository) return disabledTopSpotFeedHistoryResponse(query);
    return deps.topSpotHistoryRepository.getTopSpotFeedHistory(query);
  });

  app.get('/api/history/top-spot/:coin', { preHandler: requireAuth }, async (request, reply) => {
    const params = CoinParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid coin', details: params.error.flatten() });
    const parsed = TopSpotHistoryQuerySchema.safeParse(request.query);
    if (!parsed.success) return invalidQuery(reply, parsed.error);
    const query: TopSpotHistoryQuery = { coin: params.data.coin, ...parsed.data };
    if (Date.parse(query.from) >= Date.parse(query.to)) {
      return reply.code(400).send({ error: 'Invalid query', details: { fieldErrors: { to: ['to must be later than from'] } } });
    }
    if (!deps.topSpotHistoryRepository) return disabledTopSpotHistoryResponse(query);
    return deps.topSpotHistoryRepository.getTopSpotHistory(query);
  });

  app.get('/api/history/top-oi', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = TopSpotFeedHistoryQuerySchema.safeParse(request.query);
    if (!parsed.success) return invalidQuery(reply, parsed.error);
    const query: TopSpotFeedHistoryQuery = parsed.data;
    if (Date.parse(query.from) >= Date.parse(query.to)) {
      return reply.code(400).send({ error: 'Invalid query', details: { fieldErrors: { to: ['to must be later than from'] } } });
    }
    if (!deps.topSpotHistoryRepository) return disabledTopOiFeedHistoryResponse(query);
    return deps.topSpotHistoryRepository.getTopOiFeedHistory(query);
  });

  app.get('/api/history/top-oi/:coin', { preHandler: requireAuth }, async (request, reply) => {
    const params = CoinParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid coin', details: params.error.flatten() });
    const parsed = TopOiHistoryQuerySchema.safeParse(request.query);
    if (!parsed.success) return invalidQuery(reply, parsed.error);
    const query: TopOiHistoryQuery = { coin: params.data.coin, ...parsed.data };
    if (Date.parse(query.from) >= Date.parse(query.to)) {
      return reply.code(400).send({ error: 'Invalid query', details: { fieldErrors: { to: ['to must be later than from'] } } });
    }
    if (!deps.topSpotHistoryRepository) return disabledTopOiHistoryResponse(query);
    return deps.topSpotHistoryRepository.getTopOiHistory(query);
  });

  app.get('/api/history/amounts', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = TopSpotFeedHistoryQuerySchema.safeParse(request.query);
    if (!parsed.success) return invalidQuery(reply, parsed.error);
    const query: TopSpotFeedHistoryQuery = parsed.data;
    if (Date.parse(query.from) >= Date.parse(query.to)) {
      return reply.code(400).send({ error: 'Invalid query', details: { fieldErrors: { to: ['to must be later than from'] } } });
    }
    if (!deps.topSpotHistoryRepository) return disabledAmountsFeedHistoryResponse(query);
    return deps.topSpotHistoryRepository.getAmountsFeedHistory(query);
  });

  app.get('/api/history/amounts/:coin', { preHandler: requireAuth }, async (request, reply) => {
    const params = CoinParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid coin', details: params.error.flatten() });
    const parsed = TopSpotHistoryQuerySchema.safeParse(request.query);
    if (!parsed.success) return invalidQuery(reply, parsed.error);
    const query: AmountsHistoryQuery = { coin: params.data.coin, ...parsed.data };
    if (Date.parse(query.from) >= Date.parse(query.to)) {
      return reply.code(400).send({ error: 'Invalid query', details: { fieldErrors: { to: ['to must be later than from'] } } });
    }
    if (!deps.topSpotHistoryRepository) return disabledAmountsHistoryResponse(query);
    return deps.topSpotHistoryRepository.getAmountsHistory(query);
  });

  app.get('/api/snapshot', { preHandler: requireAuth }, async () => deps.store.getSnapshot());

  app.get('/api/events', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = EventsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid query', details: parsed.error.flatten() });
    }

    return {
      generatedAt: new Date().toISOString(),
      events: deps.store.getEvents(parsed.data.feedKey, parsed.data.limit)
    };
  });

  app.get('/api/exchange-symbols', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = ExchangeSymbolsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid query', details: parsed.error.flatten() });
    }

    return deps.symbolCache.getSymbols(parsed.data);
  });

  app.post('/api/exchange-symbols/refresh', { preHandler: requireAuth }, async () => deps.symbolCache.refresh('manual'));

  app.get('/api/spot-performance', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = SpotPerformanceQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid query', details: parsed.error.flatten() });
    }

    return deps.spotPerformance.getPerformance(parsed.data);
  });

  app.get('/api/binance/open-interest', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = BinanceOpenInterestQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid query', details: parsed.error.flatten() });
    }

    const endTimeMs = parseOptionalTimeMs(parsed.data.endTime);
    if (parsed.data.endTime && endTimeMs === null) {
      return reply.code(400).send({ error: 'Invalid endTime' });
    }

    const symbol = normalizeBinanceSymbol(parsed.data.symbol, parsed.data.coin);
    try {
      return await fetchBinanceOpenInterest({
        symbol,
        period: parsed.data.period,
        limit: parsed.data.limit,
        endTimeMs,
        timeoutMs: deps.config.exchangeSymbolRefreshTimeoutMs
      });
    } catch (error) {
      return reply.code(502).send({
        error: 'Binance open-interest request failed',
        message: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.get('/api/stream', { preHandler: requireAuth }, (request, reply) => {
    deps.sseHub.handleStream(request, reply);
  });
}

async function buildStorageStatusResponse(
  deps: RouteDeps,
  storage: DurableIngestionStatus
) {
  const database = await resolveDatabaseHealth(deps);
  const health = summarizeOperationalHealth(storage, database, deps.startupWarnings ?? []);
  return {
    generatedAt: new Date().toISOString(),
    health,
    database: {
      enabled: database.enabled,
      connected: database.connected,
      lastProbeAt: database.lastProbeAt,
      lastProbeError: database.lastProbeError,
      migrationVersion: database.migration.version,
      migrationsApplied: database.migration.applied,
      migrationsPending: database.migration.pending,
      migrationChecksumMismatch: database.migration.checksumMismatch
    },
    writer: {
      queueDepth: storage.queueDepth,
      maxQueueDepth: storage.maxQueueDepth,
      failedWrites: storage.failed,
      droppedWrites: storage.dropped,
      retriedWrites: storage.retried,
      lastSuccessfulWrite: storage.lastWriteAt,
      lastFailureAt: storage.lastFailureAt,
      oldestQueuedAt: storage.oldestQueuedAt,
      averageWriteMs: storage.averageWriteMs
    },
    tableSizes: database.tableSizes,
    startupWarnings: deps.startupWarnings ?? [],
    storage
  };
}

async function resolveDatabaseHealth(deps: RouteDeps): Promise<DatabaseHealthSnapshot> {
  try {
    return await deps.getDatabaseHealth?.() ?? disabledDatabaseHealth(deps.config.database.storageEnabled);
  } catch (error) {
    return {
      ...disabledDatabaseHealth(deps.config.database.storageEnabled),
      connected: false,
      lastProbeAt: new Date().toISOString(),
      lastProbeError: error instanceof Error ? error.message : String(error)
    };
  }
}

function summarizeOperationalHealth(storage: DurableIngestionStatus, database: DatabaseHealthSnapshot, startupWarnings: StartupWarning[]) {
  const reasons: string[] = [];
  let state: 'disabled' | 'healthy' | 'degraded' | 'unhealthy' = database.enabled || storage.enabled ? 'healthy' : 'disabled';

  if (database.enabled && !database.connected) {
    state = 'unhealthy';
    reasons.push('database_unreachable');
  }
  if ((database.migration.pending ?? 0) > 0) reasons.push('migrations_pending');
  if (database.migration.checksumMismatch) reasons.push('migration_checksum_mismatch');
  if (storage.state === 'degraded') reasons.push('writer_degraded');
  if (storage.maxQueueDepth > 0 && storage.queueDepth / storage.maxQueueDepth >= 0.8) reasons.push('writer_queue_high');
  if (storage.failed > 0 && isAfter(storage.lastFailureAt, storage.lastWriteAt)) reasons.push('writer_failures_after_last_success');
  for (const warning of startupWarnings) {
    if (warning.severity === 'critical') reasons.push(warning.code);
  }

  if (state !== 'unhealthy' && reasons.length) state = 'degraded';
  return { state, reasons };
}

function getFullResetBusyState(storage: DurableIngestionStatus) {
  if (storage.queueDepth > 0 || storage.inFlight > 0) {
    return {
      error: 'Storage writer is busy',
      reason: 'storage_writer_busy',
      queueDepth: storage.queueDepth,
      inFlight: storage.inFlight
    };
  }
  return null;
}

async function resetRawEventLog(config: AppConfig): Promise<RawLogResetResult> {
  const path = resolve(process.cwd(), config.rawEventLogPath);
  if (!config.logRawEvents) {
    return { path, cleared: false, missing: false, bytesBefore: null, reason: 'raw_logging_disabled' };
  }

  try {
    const before = await stat(path);
    await truncate(path, 0);
    return { path, cleared: true, missing: false, bytesBefore: before.size, reason: null };
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return { path, cleared: false, missing: true, bytesBefore: null, reason: 'raw_log_missing' };
    }
    throw error;
  }
}

async function pruneRawEventLogOlderThan(config: AppConfig, cutoff: string): Promise<RawLogPruneResult> {
  const path = resolve(process.cwd(), config.rawEventLogPath);
  if (!config.logRawEvents) {
    return {
      path,
      enabled: false,
      missing: false,
      bytesBefore: null,
      bytesAfter: null,
      linesBefore: 0,
      linesAfter: 0,
      deletedLines: 0,
      invalidLinesKept: 0,
      reason: 'raw_logging_disabled'
    };
  }

  let before;
  try {
    before = await stat(path);
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return {
        path,
        enabled: true,
        missing: true,
        bytesBefore: null,
        bytesAfter: null,
        linesBefore: 0,
        linesAfter: 0,
        deletedLines: 0,
        invalidLinesKept: 0,
        reason: 'raw_log_missing'
      };
    }
    throw error;
  }

  const cutoffMs = Date.parse(cutoff);
  const tempPath = `${path}.prune-${process.pid}-${Date.now()}.tmp`;
  const input = createReadStream(path, { encoding: 'utf8' });
  const output = createWriteStream(tempPath, { encoding: 'utf8' });
  let linesBefore = 0;
  let linesAfter = 0;
  let deletedLines = 0;
  let invalidLinesKept = 0;

  try {
    const lines = createInterface({ input, crlfDelay: Infinity });
    for await (const line of lines) {
      linesBefore += 1;
      const decision = shouldDeleteRawLogLine(line, cutoffMs);
      if (decision.deleteLine) {
        deletedLines += 1;
        continue;
      }
      if (decision.invalid) invalidLinesKept += 1;
      await writeLine(output, line);
      linesAfter += 1;
    }
    output.end();
    await finished(output);
    const after = await stat(tempPath);
    await rename(tempPath, path);
    return {
      path,
      enabled: true,
      missing: false,
      bytesBefore: before.size,
      bytesAfter: after.size,
      linesBefore,
      linesAfter,
      deletedLines,
      invalidLinesKept,
      reason: null
    };
  } catch (error) {
    input.destroy();
    output.destroy();
    await unlink(tempPath).catch(() => undefined);
    throw error;
  }
}

async function writeLine(output: ReturnType<typeof createWriteStream>, line: string): Promise<void> {
  if (!output.write(`${line}\n`)) await once(output, 'drain');
}

function shouldDeleteRawLogLine(line: string, cutoffMs: number): { deleteLine: boolean; invalid: boolean } {
  try {
    const parsed = JSON.parse(line) as { receivedAt?: unknown };
    if (typeof parsed.receivedAt !== 'string') return { deleteLine: false, invalid: true };
    const receivedAtMs = Date.parse(parsed.receivedAt);
    if (!Number.isFinite(receivedAtMs)) return { deleteLine: false, invalid: true };
    return { deleteLine: Number.isFinite(cutoffMs) && receivedAtMs < cutoffMs, invalid: false };
  } catch {
    return { deleteLine: false, invalid: true };
  }
}

function isAfter(left: string | null, right: string | null): boolean {
  if (!left) return false;
  if (!right) return true;
  return Date.parse(left) > Date.parse(right);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error;
}

function invalidQuery(reply: FastifyReply, error: z.ZodError): FastifyReply {
  return reply.code(400).send({ error: 'Invalid query', details: error.flatten() });
}

function normalizeBinanceSymbol(symbol: string | undefined, coin: string | undefined): string {
  if (symbol?.trim()) return symbol.trim().toUpperCase();
  return `${coin?.trim().toUpperCase() || 'BTC'}USDT`;
}

function parseOptionalTimeMs(value: string | undefined): number | null {
  if (!value) return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isAuthorized(request: FastifyRequest, config: AppConfig): boolean {
  if (!config.dashboardAuthEnabled) return true;

  const queryToken = getQueryToken(request.query);
  const headerToken = getHeaderToken(request.headers.authorization) ?? getSingleHeader(request.headers['x-dashboard-token']);
  const token = queryToken ?? headerToken;
  return token === null ? false : safeTokenEqual(token, config.dashboardAuthToken);
}

function isAdminAuthorized(request: FastifyRequest, config: AppConfig): boolean {
  if (!config.dashboardAdminToken) return false;
  const adminToken = getQueryToken(request.query, 'adminToken') ?? getSingleHeader(request.headers['x-dashboard-admin-token']);
  return adminToken === null ? false : safeTokenEqual(adminToken, config.dashboardAdminToken);
}

function getQueryToken(query: unknown, field = 'token'): string | null {
  if (!query || typeof query !== 'object') return null;
  const token = (query as Record<string, unknown>)[field];
  return typeof token === 'string' && token ? token : null;
}

function getHeaderToken(value: string | undefined): string | null {
  if (!value) return null;
  const [scheme, token] = value.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token;
}

function getSingleHeader(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function safeTokenEqual(value: string, expected: string): boolean {
  const valueBuffer = Buffer.from(value);
  const expectedBuffer = Buffer.from(expected);
  if (valueBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(valueBuffer, expectedBuffer);
}
