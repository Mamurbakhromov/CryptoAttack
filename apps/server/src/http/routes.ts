import { timingSafeEqual } from 'node:crypto';
import { stat, truncate } from 'node:fs/promises';
import { resolve } from 'node:path';

import cors from '@fastify/cors';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { fetchBinanceOpenInterest } from '../binance/openInterest.js';
import { disabledBacktestEnvelope, type BacktestService } from '../backtest/backtestService.js';
import type { BacktestBucketQuery, BacktestCoinQuery, BacktestQuery, BacktestRulesQuery, BacktestSummaryQuery } from '../backtest/types.js';
import type { AppConfig } from '../config.js';
import { disabledDurableIngestionStatus, type DurableIngestionStatus } from '../db/durableIngestion.js';
import type { ClearEventDataResult } from '../db/eventRepository.js';
import type { CurrentScoresQuery, ScoreQuerySide, ScoreReadFilters, ScoreRepository, ScoreSummaryReadModel } from '../db/scoreRepository.js';
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
import { disabledWorkerStatus, type WorkerStatus } from '../market/workerStatus.js';
import type { StartupWarning } from '../ops/startupWarnings.js';
import { scoreConfigForVersion } from '../scoring/defaultScoreConfig.js';
import type { ScoreWorkerStatus } from '../scoring/scoreWorker.js';
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

const OptionalBooleanQuerySchema = z.preprocess((value) => {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return value;
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes'].includes(normalized)) return true;
  if (['false', '0', 'no'].includes(normalized)) return false;
  return value;
}, z.boolean().optional());

const OptionalIsoDateQuerySchema = z.string().trim().refine((value) => Number.isFinite(Date.parse(value)), 'Invalid date').transform((value) => new Date(value).toISOString()).optional();
const IsoDateQuerySchema = z.string().trim().refine((value) => Number.isFinite(Date.parse(value)), 'Invalid date').transform((value) => new Date(value).toISOString());

const ScoreListQuerySchema = z.object({
  side: z.enum(['bull', 'bear', 'net']).default('net'),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  minConfidence: z.coerce.number().min(0).max(100).default(0),
  halal: OptionalBooleanQuerySchema,
  exchange: z.enum(exchangeKeys).optional(),
  market: z.enum(exchangeMarkets).optional(),
  updatedSince: OptionalIsoDateQuerySchema,
  windowMinutes: z.coerce.number().int().positive().optional(),
  scoreConfigVersion: z.string().trim().min(1).max(80).optional()
});

const ScoreCoinParamsSchema = z.object({
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

const ScoreConfigQuerySchema = z.object({
  includeRules: OptionalBooleanQuerySchema.default(true)
});

const IntegerListQuerySchema = z.preprocess((value) => {
  if (value === undefined || value === '') return undefined;
  const items = Array.isArray(value) ? value : [value];
  return items.flatMap((item) => typeof item === 'string' ? item.split(',') : [item]).map((item) => Number(String(item).trim()));
}, z.array(z.number().int().positive()).min(1).optional());

const BacktestCommonQuerySchema = z.object({
  side: z.enum(['bull', 'bear', 'net']).default('net'),
  scoreConfigVersion: z.string().trim().min(1).max(80).optional(),
  windowMinutes: z.coerce.number().int().positive().optional(),
  horizonMinutes: IntegerListQuerySchema,
  from: OptionalIsoDateQuerySchema,
  to: OptionalIsoDateQuerySchema,
  minConfidence: z.coerce.number().min(0).max(100).default(0),
  minAbsScore: z.coerce.number().min(0).max(100).default(0),
  exchange: z.enum(exchangeKeys).optional(),
  market: z.enum(exchangeMarkets).optional()
});

const BacktestSummaryQuerySchema = BacktestCommonQuerySchema.extend({
  thresholds: IntegerListQuerySchema,
  separationThreshold: z.coerce.number().min(0).max(100).default(50),
  compareScoreConfigVersion: z.string().trim().min(1).max(80).optional()
});

const BacktestBucketsQuerySchema = BacktestCommonQuerySchema.extend({
  bucketSize: z.coerce.number().int().refine((value) => [5, 10, 20].includes(value), 'Expected one of 5, 10, 20').default(10),
  confidenceBucketSize: z.coerce.number().int().refine((value) => [25, 50].includes(value), 'Expected one of 25, 50').default(25),
  minSamples: z.coerce.number().int().min(1).default(1)
});

const BacktestRulesQuerySchema = BacktestCommonQuerySchema.extend({
  ruleSide: z.enum(['bull', 'bear', 'risk', 'confidence']).optional(),
  ruleKey: z.string().trim().min(1).max(120).optional(),
  minContribution: z.coerce.number().min(0).default(0),
  minSamples: z.coerce.number().int().min(1).default(20),
  limit: z.coerce.number().int().min(1).max(500).default(100)
});

const BacktestCoinQuerySchema = BacktestCommonQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
  includeRules: OptionalBooleanQuerySchema.default(true),
  sort: z.enum(['scoreTs_desc', 'return_desc', 'return_asc', 'abs_score_desc']).default('scoreTs_desc')
});

interface RuntimeResetResult {
  clearedPendingScoreCoins: number;
  clearedActivePriceCoins: number;
}

interface RawLogResetResult {
  path: string;
  cleared: boolean;
  missing: boolean;
  bytesBefore: number | null;
  reason: string | null;
}

interface RouteDeps {
  config: AppConfig;
  store: EventStore;
  sseHub: SseHub;
  symbolCache: ExchangeSymbolCache;
  spotPerformance: SpotPerformanceService;
  eventMaintenance?: { clearEventData(): Promise<ClearEventDataResult>; clearAllStoredData(): Promise<ClearEventDataResult> } | null;
  scoreRepository?: ScoreRepository | null;
  backtestService?: BacktestService | null;
  topSpotHistoryRepository?: Pick<
    TopSpotHistoryRepository,
    'getTopSpotFeedHistory' | 'getTopSpotHistory' | 'getTopOiFeedHistory' | 'getTopOiHistory' | 'getAmountsFeedHistory' | 'getAmountsHistory'
  > | null;
  resetRuntimeState?: () => RuntimeResetResult;
  getStorageStatus?: () => DurableIngestionStatus;
  getWorkerStatus?: () => { priceCollection: WorkerStatus; forwardReturns: WorkerStatus; scores: ScoreWorkerStatus };
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
  const getWorkerStatus = () => deps.getWorkerStatus?.() ?? {
    priceCollection: disabledWorkerStatus(deps.config.priceCollection.intervalMs),
    forwardReturns: disabledWorkerStatus(deps.config.priceCollection.intervalMs),
    scores: {
      enabled: false,
      state: 'disabled' as const,
      running: false,
      intervalMs: deps.config.scores.recalculationIntervalMs,
      scoreVersion: deps.config.scores.version,
      windowsMinutes: deps.config.scores.windowsMinutes,
      queueDepth: 0,
      pendingCoinCount: 0,
      lastTriggeredAt: null,
      lastTriggerReason: null,
      lastRunStartedAt: null,
      lastRunCompletedAt: null,
      lastSuccessAt: null,
      lastFailureAt: null,
      lastError: null,
      processed: 0,
      written: 0,
      skipped: 0,
      failed: 0,
      writtenEvidence: 0,
      latestScoreTs: null,
      averageRunMs: null
    }
  };

  app.get('/api/status', { preHandler: requireAuth }, async () => ({
    ...deps.store.getStatus(),
    ...(await buildStorageStatusResponse(deps, getStorageStatus(), getWorkerStatus()))
  }));

  app.get('/api/storage/status', { preHandler: requireAuth }, async () => buildStorageStatusResponse(deps, getStorageStatus(), getWorkerStatus()));

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
    const storageStatus = await buildStorageStatusResponse(deps, getStorageStatus(), getWorkerStatus());
    deps.sseHub.broadcastStorageStatus({
      generatedAt: storageStatus.generatedAt,
      storage: storageStatus.storage,
      workers: storageStatus.workers
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
    const workers = getWorkerStatus();
    const busy = getFullResetBusyState(storage, workers);
    if (busy) return reply.code(409).send(busy);

    if (deps.config.database.storageEnabled && !deps.eventMaintenance) {
      return reply.code(503).send({
        error: 'Database event maintenance is unavailable',
        reason: 'event_storage_unavailable'
      });
    }

    const runtime = deps.resetRuntimeState?.() ?? { clearedPendingScoreCoins: 0, clearedActivePriceCoins: 0 };
    const database = deps.eventMaintenance ? await deps.eventMaintenance.clearAllStoredData() : null;
    const rawLog = await resetRawEventLog(deps.config);
    deps.store.clearEventData();
    deps.sseHub.broadcastSnapshot();
    const storageStatus = await buildStorageStatusResponse(deps, getStorageStatus(), getWorkerStatus());
    deps.sseHub.broadcastStorageStatus({
      generatedAt: storageStatus.generatedAt,
      storage: storageStatus.storage,
      workers: storageStatus.workers
    });
    const scoreSnapshot = {
      generatedAt: storageStatus.generatedAt,
      scoreVersion: storageStatus.workers.scores.scoreVersion,
      asOf: null,
      windowsMinutes: storageStatus.workers.scores.windowsMinutes,
      scores: [],
      health: storageStatus.workers.scores
    };
    deps.sseHub.broadcastScoreSnapshot(scoreSnapshot);

    return {
      generatedAt: new Date().toISOString(),
      resetAt: database?.clearedAt ?? new Date().toISOString(),
      inMemory: { cleared: true },
      database,
      rawLog,
      runtime,
      snapshot: deps.store.getSnapshot(),
      status: {
        ...deps.store.getStatus(),
        ...storageStatus
      },
      storageStatus,
      scoreSnapshot
    };
  });

  app.get('/api/workers/status', { preHandler: requireAuth }, async () => ({
    generatedAt: new Date().toISOString(),
    workers: getWorkerStatus()
  }));

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
    const params = ScoreCoinParamsSchema.safeParse(request.params);
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
    const params = ScoreCoinParamsSchema.safeParse(request.params);
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
    const params = ScoreCoinParamsSchema.safeParse(request.params);
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

  app.get('/api/backtest/summary', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = BacktestSummaryQuerySchema.safeParse(request.query);
    if (!parsed.success) return invalidQuery(reply, parsed.error);
    const query = resolveBacktestQuery(parsed.data, deps.config, reply, { kind: 'summary' });
    if (!query) return;
    if (!deps.backtestService) return disabledBacktestEnvelope({ ...backtestQueryMetadata(query), metrics: [], precisionByThreshold: [], bullBearSeparation: [], configComparison: [] });
    return deps.backtestService.getSummary(query);
  });

  app.get('/api/backtest/score-buckets', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = BacktestBucketsQuerySchema.safeParse(request.query);
    if (!parsed.success) return invalidQuery(reply, parsed.error);
    const query = resolveBacktestQuery(parsed.data, deps.config, reply, { kind: 'buckets' });
    if (!query) return;
    if (!deps.backtestService) return disabledBacktestEnvelope({ ...backtestQueryMetadata(query), scoreBuckets: [], confidenceBuckets: [] });
    return deps.backtestService.getScoreBuckets(query);
  });

  app.get('/api/backtest/rules', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = BacktestRulesQuerySchema.safeParse(request.query);
    if (!parsed.success) return invalidQuery(reply, parsed.error);
    const query = resolveBacktestQuery(parsed.data, deps.config, reply, { kind: 'rules' });
    if (!query) return;
    if (!deps.backtestService) return disabledBacktestEnvelope({ ...backtestQueryMetadata(query), total: 0, harmfulRuleCount: 0, weakRuleCount: 0, rules: [] });
    return deps.backtestService.getRules(query);
  });

  app.get('/api/backtest/coin/:coin', { preHandler: requireAuth }, async (request, reply) => {
    const params = ScoreCoinParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid coin', details: params.error.flatten() });
    const parsed = BacktestCoinQuerySchema.safeParse(request.query);
    if (!parsed.success) return invalidQuery(reply, parsed.error);
    const query = resolveBacktestQuery({ ...parsed.data, coin: params.data.coin }, deps.config, reply, { kind: 'coin' });
    if (!query) return;
    if (!deps.backtestService) return disabledBacktestEnvelope({ ...backtestQueryMetadata(query), coin: params.data.coin, total: 0, summary: null, results: [] });
    return deps.backtestService.getCoin(query);
  });

  app.get('/api/scores/top', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = ScoreListQuerySchema.safeParse(request.query);
    if (!parsed.success) return invalidQuery(reply, parsed.error);
    const query = resolveScoreReadFilters(parsed.data, deps.config, reply);
    if (!query) return;
    if (!deps.scoreRepository) return emptyScoresResponse('top', query);

    const scores = await deps.scoreRepository.getCurrentScores(query);
    return scoresResponse('top', query, scores);
  });

  app.get('/api/scores/current', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = ScoreListQuerySchema.safeParse(request.query);
    if (!parsed.success) return invalidQuery(reply, parsed.error);
    const query = resolveScoreReadFilters(parsed.data, deps.config, reply);
    if (!query) return;
    if (!deps.scoreRepository) return emptyScoresResponse('current', query);

    const scores = await deps.scoreRepository.getCurrentScores(query);
    return scoresResponse('current', query, scores);
  });

  app.get('/api/scores/market-regime', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = ScoreListQuerySchema.safeParse(request.query);
    if (!parsed.success) return invalidQuery(reply, parsed.error);
    const query = resolveScoreReadFilters({ ...parsed.data, limit: parsed.data.limit || 500 }, deps.config, reply);
    if (!query) return;
    if (!deps.scoreRepository) return marketRegimeResponse(query, []);

    const scores = await deps.scoreRepository.getCurrentScores(query);
    return marketRegimeResponse(query, scores);
  });

  app.get('/api/scoring/config/current', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = ScoreConfigQuerySchema.safeParse(request.query);
    if (!parsed.success) return invalidQuery(reply, parsed.error);

    const configured = scoreConfigForVersion(deps.config.scores.version);
    const stored = await deps.scoreRepository?.getCurrentScoreConfig();
    const activeConfig = stored?.config ?? configured;
    return {
      generatedAt: new Date().toISOString(),
      storageBacked: Boolean(stored),
      config: {
        scoreConfigVersion: stored?.scoreConfigVersion ?? activeConfig.version,
        description: stored?.description ?? activeConfig.description,
        active: stored?.active ?? deps.config.scores.enabled,
        activatedAt: stored?.activatedAt ?? null,
        retiredAt: stored?.retiredAt ?? null,
        windows: activeConfig.windows,
        sideSaturation: activeConfig.sideSaturation,
        materialChange: activeConfig.materialChange,
        confidence: activeConfig.confidence,
        burst: activeConfig.burst,
        rules: parsed.data.includeRules ? activeConfig.rules : []
      }
    };
  });

  app.get('/api/scores/:coin/timeline', { preHandler: requireAuth }, async (request, reply) => {
    const params = ScoreCoinParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid coin', details: params.error.flatten() });
    const parsed = ScoreListQuerySchema.safeParse(request.query);
    if (!parsed.success) return invalidQuery(reply, parsed.error);
    const query = resolveScoreReadFilters(parsed.data, deps.config, reply);
    if (!query) return;
    if (!deps.scoreRepository) return { generatedAt: new Date().toISOString(), enabled: false, coin: params.data.coin, ...scoreQueryMetadata(query), snapshots: [] };

    const snapshots = await deps.scoreRepository.getScoreTimeline({ ...query, coin: params.data.coin });
    return {
      generatedAt: new Date().toISOString(),
      enabled: true,
      coin: params.data.coin,
      ...scoreQueryMetadata(query),
      snapshots
    };
  });

  app.get('/api/scores/:coin/evidence', { preHandler: requireAuth }, async (request, reply) => {
    const params = ScoreCoinParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid coin', details: params.error.flatten() });
    const parsed = ScoreListQuerySchema.safeParse(request.query);
    if (!parsed.success) return invalidQuery(reply, parsed.error);
    const query = resolveScoreReadFilters(parsed.data, deps.config, reply);
    if (!query) return;
    if (!deps.scoreRepository) return { generatedAt: new Date().toISOString(), enabled: false, coin: params.data.coin, ...scoreQueryMetadata(query), evidence: [] };

    const evidence = await deps.scoreRepository.getScoreEvidence({ ...query, coin: params.data.coin });
    return {
      generatedAt: new Date().toISOString(),
      enabled: true,
      coin: params.data.coin,
      ...scoreQueryMetadata(query),
      evidence
    };
  });

  app.get('/api/scores/:coin', { preHandler: requireAuth }, async (request, reply) => {
    const params = ScoreCoinParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid coin', details: params.error.flatten() });
    const parsed = ScoreListQuerySchema.safeParse(request.query);
    if (!parsed.success) return invalidQuery(reply, parsed.error);
    const query = resolveScoreReadFilters({ ...parsed.data, limit: 1 }, deps.config, reply);
    if (!query) return;
    const coinQuery: CurrentScoresQuery = { ...query, coin: params.data.coin, limit: 1 };
    if (!deps.scoreRepository) return { generatedAt: new Date().toISOString(), enabled: false, coin: params.data.coin, ...scoreQueryMetadata(query), score: null };

    const scores = await deps.scoreRepository.getCurrentScores(coinQuery);
    return {
      generatedAt: new Date().toISOString(),
      enabled: true,
      coin: params.data.coin,
      ...scoreQueryMetadata(query),
      score: scores[0] ?? null
    };
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
  storage: DurableIngestionStatus,
  workers: { priceCollection: WorkerStatus; forwardReturns: WorkerStatus; scores: ScoreWorkerStatus }
) {
  const database = await resolveDatabaseHealth(deps);
  const health = summarizeOperationalHealth(storage, workers, database, deps.startupWarnings ?? []);
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
    scoring: {
      enabled: workers.scores.enabled,
      state: workers.scores.state,
      queueDepth: workers.scores.queueDepth,
      pendingCoinCount: workers.scores.pendingCoinCount,
      failed: workers.scores.failed,
      lastScoreRecompute: workers.scores.lastSuccessAt,
      latestScoreTs: workers.scores.latestScoreTs,
      lastFailureAt: workers.scores.lastFailureAt,
      lastError: workers.scores.lastError
    },
    marketData: {
      priceCollection: workers.priceCollection,
      latestPriceTick: database.latestPriceTick,
      forwardReturns: workers.forwardReturns,
      forwardReturnBacklog: database.forwardReturnBacklog
    },
    tableSizes: database.tableSizes,
    startupWarnings: deps.startupWarnings ?? [],
    storage,
    workers
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

function summarizeOperationalHealth(storage: DurableIngestionStatus, workers: { priceCollection: WorkerStatus; forwardReturns: WorkerStatus; scores: ScoreWorkerStatus }, database: DatabaseHealthSnapshot, startupWarnings: StartupWarning[]) {
  const reasons: string[] = [];
  let state: 'disabled' | 'healthy' | 'degraded' | 'unhealthy' = database.enabled || storage.enabled || workers.scores.enabled ? 'healthy' : 'disabled';

  if (database.enabled && !database.connected) {
    state = 'unhealthy';
    reasons.push('database_unreachable');
  }
  if ((database.migration.pending ?? 0) > 0) reasons.push('migrations_pending');
  if (database.migration.checksumMismatch) reasons.push('migration_checksum_mismatch');
  if (storage.state === 'degraded') reasons.push('writer_degraded');
  if (storage.maxQueueDepth > 0 && storage.queueDepth / storage.maxQueueDepth >= 0.8) reasons.push('writer_queue_high');
  if (storage.failed > 0 && isAfter(storage.lastFailureAt, storage.lastWriteAt)) reasons.push('writer_failures_after_last_success');
  if (workers.scores.state === 'degraded') reasons.push('score_worker_degraded');
  if (workers.scores.enabled && isStale(workers.scores.lastSuccessAt, workers.scores.intervalMs * 2)) reasons.push('score_recompute_stale');
  if (workers.priceCollection.enabled && !database.latestPriceTick.ts) reasons.push('latest_price_tick_missing');
  if (workers.forwardReturns.enabled && database.forwardReturnBacklog.due > 0) reasons.push('forward_return_backlog_due');
  for (const warning of startupWarnings) {
    if (warning.severity === 'critical') reasons.push(warning.code);
  }

  if (state !== 'unhealthy' && reasons.length) state = 'degraded';
  return { state, reasons };
}

function getFullResetBusyState(storage: DurableIngestionStatus, workers: { priceCollection: WorkerStatus; forwardReturns: WorkerStatus; scores: ScoreWorkerStatus }) {
  if (storage.queueDepth > 0 || storage.inFlight > 0) {
    return {
      error: 'Storage writer is busy',
      reason: 'storage_writer_busy',
      queueDepth: storage.queueDepth,
      inFlight: storage.inFlight
    };
  }
  if (workers.scores.running) {
    return {
      error: 'Score worker is running',
      reason: 'score_worker_running'
    };
  }
  if (workers.priceCollection.running) {
    return {
      error: 'Price collection worker is running',
      reason: 'price_collection_running'
    };
  }
  if (workers.forwardReturns.running) {
    return {
      error: 'Forward return worker is running',
      reason: 'forward_return_worker_running'
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

function isAfter(left: string | null, right: string | null): boolean {
  if (!left) return false;
  if (!right) return true;
  return Date.parse(left) > Date.parse(right);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error;
}

function isStale(value: string | null, staleAfterMs: number): boolean {
  if (!value) return true;
  return Date.now() - Date.parse(value) > staleAfterMs;
}

function invalidQuery(reply: FastifyReply, error: z.ZodError): FastifyReply {
  return reply.code(400).send({ error: 'Invalid query', details: error.flatten() });
}

function resolveScoreReadFilters(query: z.infer<typeof ScoreListQuerySchema>, config: AppConfig, reply: FastifyReply): ScoreReadFilters | null {
  const configuredWindows = config.scores.windowsMinutes.length ? config.scores.windowsMinutes : [15];
  const defaultWindow = configuredWindows.includes(15) ? 15 : configuredWindows[0] ?? 15;
  const windowMinutes = query.windowMinutes ?? defaultWindow;
  if (!configuredWindows.includes(windowMinutes)) {
    void reply.code(400).send({ error: 'Invalid query', details: { fieldErrors: { windowMinutes: [`Expected one of ${configuredWindows.join(', ')}`] } } });
    return null;
  }

  const filters: ScoreReadFilters = {
    scoreConfigVersion: query.scoreConfigVersion ?? config.scores.version,
    windowMinutes,
    side: query.side,
    limit: query.limit,
    minConfidence: query.minConfidence
  };
  if (query.halal !== undefined) filters.halal = query.halal;
  if (query.exchange) filters.exchange = query.exchange;
  if (query.market) filters.market = query.market;
  if (query.updatedSince) filters.updatedSince = query.updatedSince;
  return filters;
}

function resolveBacktestQuery(query: z.infer<typeof BacktestSummaryQuerySchema>, config: AppConfig, reply: FastifyReply, options: { kind: 'summary' }): BacktestSummaryQuery | null;
function resolveBacktestQuery(query: z.infer<typeof BacktestBucketsQuerySchema>, config: AppConfig, reply: FastifyReply, options: { kind: 'buckets' }): BacktestBucketQuery | null;
function resolveBacktestQuery(query: z.infer<typeof BacktestRulesQuerySchema>, config: AppConfig, reply: FastifyReply, options: { kind: 'rules' }): BacktestRulesQuery | null;
function resolveBacktestQuery(query: z.infer<typeof BacktestCoinQuerySchema> & { coin: string }, config: AppConfig, reply: FastifyReply, options: { kind: 'coin' }): BacktestCoinQuery | null;
function resolveBacktestQuery(
  query: z.infer<typeof BacktestSummaryQuerySchema> | z.infer<typeof BacktestBucketsQuerySchema> | z.infer<typeof BacktestRulesQuerySchema> | (z.infer<typeof BacktestCoinQuerySchema> & { coin: string }),
  config: AppConfig,
  reply: FastifyReply,
  options: { kind: 'summary' | 'buckets' | 'rules' | 'coin' }
): BacktestSummaryQuery | BacktestBucketQuery | BacktestRulesQuery | BacktestCoinQuery | null {
  const base = resolveBacktestBaseQuery(query, config, reply);
  if (!base) return null;

  if (options.kind === 'summary') {
    const summaryQuery = query as z.infer<typeof BacktestSummaryQuerySchema>;
    const result: BacktestSummaryQuery = {
      ...base,
      thresholds: summaryQuery.thresholds ?? [10, 20, 30, 40, 50, 60, 70, 80, 90],
      separationThreshold: summaryQuery.separationThreshold
    };
    if (summaryQuery.compareScoreConfigVersion) result.compareScoreConfigVersion = summaryQuery.compareScoreConfigVersion;
    return result;
  }

  if (options.kind === 'buckets') {
    const bucketQuery = query as z.infer<typeof BacktestBucketsQuerySchema>;
    return {
      ...base,
      bucketSize: bucketQuery.bucketSize,
      confidenceBucketSize: bucketQuery.confidenceBucketSize,
      minSamples: bucketQuery.minSamples
    };
  }

  if (options.kind === 'rules') {
    const rulesQuery = query as z.infer<typeof BacktestRulesQuerySchema>;
    const result: BacktestRulesQuery = {
      ...base,
      minContribution: rulesQuery.minContribution,
      minSamples: rulesQuery.minSamples,
      limit: rulesQuery.limit
    };
    if (rulesQuery.ruleSide) result.ruleSide = rulesQuery.ruleSide;
    if (rulesQuery.ruleKey) result.ruleKey = rulesQuery.ruleKey;
    return result;
  }

  const coinQuery = query as z.infer<typeof BacktestCoinQuerySchema> & { coin: string };
  return {
    ...base,
    coin: coinQuery.coin,
    limit: coinQuery.limit,
    offset: coinQuery.offset,
    includeRules: coinQuery.includeRules,
    sort: coinQuery.sort
  };
}

function resolveBacktestBaseQuery(query: z.infer<typeof BacktestCommonQuerySchema>, config: AppConfig, reply: FastifyReply): BacktestQuery | null {
  const configuredWindows = config.scores.windowsMinutes.length ? config.scores.windowsMinutes : [15];
  const defaultWindow = configuredWindows.includes(15) ? 15 : configuredWindows[0] ?? 15;
  const windowMinutes = query.windowMinutes ?? defaultWindow;
  if (!configuredWindows.includes(windowMinutes)) {
    void reply.code(400).send({ error: 'Invalid query', details: { fieldErrors: { windowMinutes: [`Expected one of ${configuredWindows.join(', ')}`] } } });
    return null;
  }

  const allowedHorizons = config.priceCollection.forwardReturnHorizonsMinutes.length ? config.priceCollection.forwardReturnHorizonsMinutes : [5, 15, 60, 240, 1440];
  const horizonsMinutes = query.horizonMinutes ?? allowedHorizons;
  const invalidHorizon = horizonsMinutes.find((horizon) => !allowedHorizons.includes(horizon));
  if (invalidHorizon !== undefined) {
    void reply.code(400).send({ error: 'Invalid query', details: { fieldErrors: { horizonMinutes: [`Expected one or more of ${allowedHorizons.join(', ')}`] } } });
    return null;
  }

  if (query.from && query.to && Date.parse(query.from) >= Date.parse(query.to)) {
    void reply.code(400).send({ error: 'Invalid query', details: { fieldErrors: { to: ['to must be later than from'] } } });
    return null;
  }

  const result: BacktestQuery = {
    scoreConfigVersion: query.scoreConfigVersion ?? config.scores.version,
    windowMinutes,
    horizonsMinutes,
    side: query.side,
    minConfidence: query.minConfidence,
    minAbsScore: query.minAbsScore
  };
  if (query.from) result.from = query.from;
  if (query.to) result.to = query.to;
  if (query.exchange) result.exchange = query.exchange;
  if (query.market) result.market = query.market;
  return result;
}

function backtestQueryMetadata(query: BacktestSummaryQuery | BacktestBucketQuery | BacktestRulesQuery | BacktestCoinQuery) {
  return {
    scoreConfigVersion: query.scoreConfigVersion,
    windowMinutes: query.windowMinutes,
    horizonsMinutes: query.horizonsMinutes,
    side: query.side,
    filters: {
      from: query.from ?? null,
      to: query.to ?? null,
      minConfidence: query.minConfidence,
      minAbsScore: query.minAbsScore,
      exchange: query.exchange ?? null,
      market: query.market ?? null
    }
  };
}

function scoreQueryMetadata(query: ScoreReadFilters): Omit<ScoreReadFilters, 'exchange' | 'market' | 'halal' | 'updatedSince' | 'minConfidence'> & {
  filters: {
    minConfidence: number;
    halal: boolean | null;
    exchange: string | null;
    market: string | null;
    updatedSince: string | null;
  };
} {
  return {
    scoreConfigVersion: query.scoreConfigVersion,
    windowMinutes: query.windowMinutes,
    side: query.side ?? 'net',
    limit: query.limit,
    filters: {
      minConfidence: query.minConfidence ?? 0,
      halal: query.halal ?? null,
      exchange: query.exchange ?? null,
      market: query.market ?? null,
      updatedSince: query.updatedSince ?? null
    }
  };
}

function scoresResponse(kind: 'top' | 'current', query: ScoreReadFilters, scores: ScoreSummaryReadModel[]) {
  return {
    generatedAt: new Date().toISOString(),
    enabled: true,
    kind,
    ...scoreQueryMetadata(query),
    total: scores.length,
    scores
  };
}

function emptyScoresResponse(kind: 'top' | 'current', query: ScoreReadFilters) {
  return {
    generatedAt: new Date().toISOString(),
    enabled: false,
    state: 'disabled',
    reason: 'score_storage_unavailable',
    kind,
    ...scoreQueryMetadata(query),
    total: 0,
    scores: []
  };
}

function marketRegimeResponse(query: ScoreReadFilters, scores: ScoreSummaryReadModel[]) {
  const generatedAt = new Date().toISOString();
  const bullishCount = scores.filter((score) => score.marketRegime === 'bullish').length;
  const bearishCount = scores.filter((score) => score.marketRegime === 'bearish').length;
  const mixedCount = scores.filter((score) => score.marketRegime === 'conflicted').length;
  const quietCount = scores.length - bullishCount - bearishCount - mixedCount;
  const averageConfidence = average(scores.map((score) => score.confidenceScore));
  const averageNetScore = average(scores.map((score) => score.netScore));
  const latestScoreTs = maxIso(scores.map((score) => score.latestScoreTs));
  const oldestScoreTs = minIso(scores.map((score) => score.latestScoreTs));

  return {
    generatedAt,
    enabled: scores.length > 0,
    ...scoreQueryMetadata(query),
    sampledCoins: scores.length,
    regime: overallRegime(scores.length, bullishCount, bearishCount, mixedCount, averageConfidence, averageNetScore),
    bullishCoinCount: bullishCount,
    bearishCoinCount: bearishCount,
    mixedCount,
    quietCount,
    averageConfidence,
    averageBullScore: average(scores.map((score) => score.bullScore)),
    averageBearScore: average(scores.map((score) => score.bearScore)),
    averageNetScore,
    topSector: null,
    topCategory: null,
    dataFreshness: {
      latestScoreTs,
      oldestScoreTs,
      latestAgeSeconds: latestScoreTs ? Math.max(0, Math.round((Date.parse(generatedAt) - Date.parse(latestScoreTs)) / 1000)) : null
    },
    leaders: {
      bull: [...scores].sort((a, b) => b.bullScore - a.bullScore).slice(0, 5),
      bear: [...scores].sort((a, b) => b.bearScore - a.bearScore).slice(0, 5),
      net: [...scores].sort((a, b) => Math.abs(b.netScore) - Math.abs(a.netScore)).slice(0, 5)
    }
  };
}

function overallRegime(scoreCount: number, bullishCount: number, bearishCount: number, mixedCount: number, averageConfidence: number, averageNetScore: number): 'bullish' | 'bearish' | 'conflicted' | 'neutral' | 'thin_data' {
  if (scoreCount === 0 || averageConfidence < 25) return 'thin_data';
  if (mixedCount > scoreCount * 0.2 || (bullishCount > scoreCount * 0.25 && bearishCount > scoreCount * 0.25)) return 'conflicted';
  if (averageNetScore >= 15 || bullishCount > bearishCount * 1.5) return 'bullish';
  if (averageNetScore <= -15 || bearishCount > bullishCount * 1.5) return 'bearish';
  return 'neutral';
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return round2(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function maxIso(values: string[]): string | null {
  const timestamps = values.map((value) => Date.parse(value)).filter(Number.isFinite);
  return timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : null;
}

function minIso(values: string[]): string | null {
  const timestamps = values.map((value) => Date.parse(value)).filter(Number.isFinite);
  return timestamps.length ? new Date(Math.min(...timestamps)).toISOString() : null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
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
