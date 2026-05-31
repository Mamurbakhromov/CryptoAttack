import { appendFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import fastifyStatic from '@fastify/static';
import { config as loadDotenv } from 'dotenv';
import Fastify from 'fastify';

import { BacktestService } from './backtest/backtestService.js';
import { loadConfig, type AppConfig } from './config.js';
import { CryptoAttackClient } from './cryptoattack/client.js';
import { BacktestRepository } from './db/backtestRepository.js';
import { disabledDurableIngestionStatus, DurableIngestionQueue, durableIngestionOptionsFromConfig } from './db/durableIngestion.js';
import { EventIngestionRepository, EventMaintenanceRepository } from './db/eventRepository.js';
import { MarketDataRepository } from './db/marketDataRepository.js';
import { runMigrations } from './db/migrations.js';
import { resolveDefaultMigrationsDir } from './db/paths.js';
import { closePostgresPool, createPostgresPool, verifyPostgresConnection } from './db/postgres.js';
import { ScoreRepository } from './db/scoreRepository.js';
import { StorageHealthService } from './db/storageHealth.js';
import { applyTimescalePolicies } from './db/timescalePolicies.js';
import { TopSpotHistoryRepository } from './db/topSpotHistoryRepository.js';
import { SpotPerformanceService } from './exchanges/spotPerformance.js';
import { ExchangeSymbolCache } from './exchanges/symbolCache.js';
import { EventStore } from './events/eventStore.js';
import { normalizeCryptoAttackEvent } from './events/normalizer.js';
import { replayLatestRawEventsFromLog } from './events/replayRawLog.js';
import type { NormalizedEvent } from './events/types.js';
import { registerHttpRoutes } from './http/routes.js';
import { SseHub } from './http/sse.js';
import { ForwardReturnWorker } from './market/forwardReturnWorker.js';
import { PriceCollectionService } from './market/priceCollectionService.js';
import { disabledWorkerStatus } from './market/workerStatus.js';
import { buildStartupWarnings } from './ops/startupWarnings.js';
import { disabledScoreWorkerStatus, ScoreWorker, scoreWorkerOptionsFromConfig } from './scoring/scoreWorker.js';
import { startMockCryptoAttack, type RawEventAppender } from './mock/mockCryptoAttack.js';
import { createLogger, type AppLogger } from './utils/logger.js';

loadEnvFiles();

const logger = createLogger();
const config = loadConfig();
const startupWarnings = buildStartupWarnings(config);
for (const warning of startupWarnings) logger.warn(warning, 'Startup configuration warning');
let postgresPool = createPostgresPool(config.database);
const migrationsDir = resolveDefaultMigrationsDir();

if (postgresPool) {
  try {
    await verifyPostgresConnection(postgresPool, config.database.statementTimeoutMs);
    if (config.database.migrationsOnStart) {
      await runMigrations(postgresPool, migrationsDir);
    }
    try {
      const policyResult = await applyTimescalePolicies(postgresPool, config.database.timescale);
      logger.info(policyResult, 'Timescale retention and compression policies applied');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      startupWarnings.push({ code: 'timescale_policy_apply_failed', severity: 'warning', message: 'Timescale retention or compression policy application failed.' });
      logger.warn({ error: message }, 'Timescale policy application failed');
    }
    logger.info(
      {
        storageEnabled: true,
        migrationsOnStart: config.database.migrationsOnStart
      },
      'Database storage initialized'
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    startupWarnings.push({
      code: 'database_unavailable',
      severity: 'critical',
      message: 'Database storage was enabled but the database was unavailable at startup. Storage-backed features are disabled until restart.'
    });
    logger.error({ error: message }, 'Database storage unavailable; continuing with storage disabled');
    await closePostgresPool(postgresPool).catch((closeError) => {
      logger.warn({ error: closeError instanceof Error ? closeError.message : String(closeError) }, 'Failed to close unavailable database pool');
    });
    if (config.database.requiredOnStart) {
      throw new Error('Database storage is required on startup but Postgres was unavailable');
    }
    postgresPool = null;
  }
} else {
  logger.info({ storageEnabled: false }, 'Database storage disabled');
}

const store = new EventStore({
  bufferSize: config.eventBufferSize,
  dedupeTtlMs: config.dedupeTtlMs,
  mockMode: config.mockCryptoAttack,
  authEnabled: config.dashboardAuthEnabled
});
const appendRawEvent = createRawEventAppender(config, logger);
const scoreRepository = postgresPool ? new ScoreRepository(postgresPool) : null;
const eventMaintenance = postgresPool ? new EventMaintenanceRepository(postgresPool) : null;
const backtestRepository = postgresPool ? new BacktestRepository(postgresPool) : null;
const backtestService = backtestRepository ? new BacktestService(backtestRepository) : null;
const marketDataRepository = postgresPool ? new MarketDataRepository(postgresPool) : null;
const topSpotHistoryRepository = postgresPool ? new TopSpotHistoryRepository(postgresPool) : null;
const storageHealthService = postgresPool ? new StorageHealthService(postgresPool, migrationsDir) : null;
const symbolCache = new ExchangeSymbolCache({
  enabled: config.exchangeSymbolCacheEnabled,
  cachePath: config.exchangeSymbolCachePath,
  refreshUtcTime: config.exchangeSymbolRefreshUtcTime,
  refreshTimeoutMs: config.exchangeSymbolRefreshTimeoutMs,
  refreshOnStart: config.exchangeSymbolRefreshOnStart,
  logger
});
const spotPerformance = new SpotPerformanceService({
  timeoutMs: config.exchangeSymbolRefreshTimeoutMs,
  logger
});
const priceCollectionService = marketDataRepository
  ? new PriceCollectionService(marketDataRepository, symbolCache, {
      enabled: config.priceCollection.enabled,
      intervalMs: config.priceCollection.intervalMs,
      activeCoinTtlMs: config.priceCollection.activeCoinTtlMs,
      timeoutMs: config.exchangeSymbolRefreshTimeoutMs,
      logger
    })
  : null;
const forwardReturnWorker = marketDataRepository
  ? new ForwardReturnWorker(marketDataRepository, {
      enabled: config.priceCollection.enabled,
      intervalMs: config.priceCollection.intervalMs,
      horizonsMinutes: config.priceCollection.forwardReturnHorizonsMinutes,
      logger
    })
  : null;
let scoreWorker: ScoreWorker | null = null;
let durableIngestion: DurableIngestionQueue | null = null;
const getWorkerStatus = () => ({
  priceCollection: priceCollectionService?.getStatus() ?? disabledWorkerStatus(config.priceCollection.intervalMs),
  forwardReturns: forwardReturnWorker?.getStatus() ?? disabledWorkerStatus(config.priceCollection.intervalMs),
  scores: scoreWorker?.getStatus() ?? disabledScoreWorkerStatus(config)
});
const getStorageStatusPayload = () => ({
  generatedAt: new Date().toISOString(),
  storage: durableIngestion?.getStatus() ?? disabledDurableIngestionStatus(),
  workers: getWorkerStatus()
});
const sseHub = new SseHub(
  store,
  {
    corsOrigin: config.webOrigin,
    getScoreSnapshot: () => {
      const status = scoreWorker?.getStatus() ?? disabledScoreWorkerStatus(config);
      return {
        generatedAt: new Date().toISOString(),
        scoreVersion: status.scoreVersion,
        asOf: status.latestScoreTs,
        windowsMinutes: status.windowsMinutes,
        scores: [],
        health: status
      };
    },
    getStorageStatus: getStorageStatusPayload
  },
  spotPerformance
);
scoreWorker = scoreRepository
  ? new ScoreWorker(scoreRepository, {
      ...scoreWorkerOptionsFromConfig(config, logger),
      onUpdate: (event) => {
        sseHub.broadcastScoreUpdate(event);
        sseHub.broadcastScoreSnapshot({
          generatedAt: event.generatedAt,
          scoreVersion: event.scoreVersion,
          asOf: event.asOf,
          windowsMinutes: config.scores.windowsMinutes,
          scores: event.scores,
          health: scoreWorker?.getStatus() ?? disabledScoreWorkerStatus(config)
        });
      }
    })
  : null;
durableIngestion = postgresPool
  ? new DurableIngestionQueue(new EventIngestionRepository(postgresPool), logger, {
      ...durableIngestionOptionsFromConfig(config),
      onWritten: (job) => scoreWorker?.enqueueEvents(job.normalizedEvents, 'ingestion'),
      onStatus: () => sseHub.broadcastStorageStatus(getStorageStatusPayload())
    })
  : null;
const app = Fastify({ logger: false });

await symbolCache.loadFromDisk();
symbolCache.start();
spotPerformance.start();
priceCollectionService?.start();
forwardReturnWorker?.start();
scoreWorker?.start();

if (config.replayRawEventsOnStart) {
  const replayResult = await replayLatestRawEventsFromLog({
    rawEventLogPath: config.rawEventLogPath,
    store,
    enableDelistings: config.enableDelistings,
    enableAnnouncementDelistingFallback: config.enableAnnouncementDelistingFallback
  });
  if (replayResult.replayed > 0) {
    logger.info(replayResult, 'Seeded dashboard from persisted raw event log');
  }
} else {
  logger.info({ path: config.rawEventLogPath }, 'Raw event replay disabled on startup');
}

await registerHttpRoutes(app, {
  config,
  store,
  sseHub,
  symbolCache,
  spotPerformance,
  eventMaintenance,
  scoreRepository,
  backtestService,
  topSpotHistoryRepository,
  resetRuntimeState: () => ({
    clearedPendingScoreCoins: scoreWorker?.resetRuntimeState().clearedPendingCoins ?? 0,
    clearedActivePriceCoins: priceCollectionService?.resetRuntimeState().clearedActiveCoins ?? 0
  }),
  getStorageStatus: () => durableIngestion?.getStatus() ?? disabledDurableIngestionStatus(),
  getWorkerStatus,
  getDatabaseHealth: () => storageHealthService?.getHealth() ?? null,
  startupWarnings
});
await registerStaticFrontend(app, logger);

const controller = config.mockCryptoAttack
  ? startMockCryptoAttack({ config, store, logger, appendRawEvent, handleRawEvent })
  : new CryptoAttackClient({
      config,
      logger,
      onStatus: (status) => store.setConnectionStatus(status),
      onRawEvent: handleRawEvent
    });

if (controller instanceof CryptoAttackClient) {
  controller.start();
}

await app.listen({ host: config.serverHost, port: config.serverPort });
logger.info(
  {
    host: config.serverHost,
    port: config.serverPort,
    mockMode: config.mockCryptoAttack,
    authEnabled: config.dashboardAuthEnabled,
    storageEnabled: postgresPool !== null
  },
  'CryptoAttack Realtime Dashboard backend started'
);

process.once('SIGINT', () => {
  void shutdown('SIGINT');
});
process.once('SIGTERM', () => {
  void shutdown('SIGTERM');
});

function loadEnvFiles(): void {
  const candidates = [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')];
  for (const path of candidates) {
    if (existsSync(path)) loadDotenv({ path, override: false });
  }
}

async function registerStaticFrontend(server: typeof app, activeLogger: AppLogger): Promise<void> {
  const webDistPath = resolve(process.cwd(), '../web/dist');
  if (!existsSync(webDistPath)) return;

  await server.register(fastifyStatic, {
    root: webDistPath,
    prefix: '/'
  });

  server.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api') || request.url === '/health') {
      return reply.code(404).send({ error: 'Not found' });
    }
    return reply.sendFile('index.html');
  });

  activeLogger.info({ webDistPath }, 'Serving built frontend');
}

function createRawEventAppender(activeConfig: AppConfig, activeLogger: AppLogger): RawEventAppender {
  if (!activeConfig.logRawEvents) return () => undefined;

  const absolutePath = resolve(process.cwd(), activeConfig.rawEventLogPath);
  const ready = mkdir(dirname(absolutePath), { recursive: true })
    .then(() => true)
    .catch((error) => {
      activeLogger.warn({ error, path: absolutePath }, 'Raw CryptoAttack event logging disabled because log directory could not be created');
      return false;
    });
  let writeChain = Promise.resolve();

  return (raw: unknown, storedEvents: NormalizedEvent[]) => {
    if (!storedEvents.length) return;

    const line = safeStringify({
      receivedAt: new Date().toISOString(),
      normalizedEventIds: storedEvents.map((event) => event.id),
      feedKeys: storedEvents.map((event) => event.feedKey),
      raw
    });

    writeChain = writeChain
      .then(() => ready)
      .then((canWrite) => (canWrite ? appendFile(absolutePath, `${line}\n`, 'utf8') : undefined))
      .catch((error) => {
        activeLogger.warn({ error, path: absolutePath }, 'Failed to append raw CryptoAttack event');
      });
  };
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch (error) {
    return JSON.stringify({
      receivedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
      raw: '[unserializable]'
    });
  }
}

function handleRawEvent(raw: unknown, endpointName: string): void {
  const events = normalizeCryptoAttackEvent(raw, {
    endpointName,
    enableDelistings: config.enableDelistings,
    enableAnnouncementDelistingFallback: config.enableAnnouncementDelistingFallback
  });
  const storedEvents = store.addEvents(events);
  appendRawEvent(raw, storedEvents);
  durableIngestion?.enqueue({
    raw,
    endpoint: endpointName,
    receivedAt: events[0]?.receivedAt ?? new Date().toISOString(),
    normalizedEvents: events
  });
  priceCollectionService?.markActiveCoins(storedEvents);
}

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Shutting down');
  controller.stop();
  spotPerformance.stop();
  symbolCache.stop();
  priceCollectionService?.stop();
  forwardReturnWorker?.stop();
  scoreWorker?.stop();
  await durableIngestion?.stop(config.database.writeDrainTimeoutMs);
  sseHub.close();
  await closePostgresPool(postgresPool);
  await app.close();
  process.exit(0);
}
