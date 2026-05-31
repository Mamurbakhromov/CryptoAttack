import { z } from 'zod';

const booleanFromEnv = z.preprocess((value) => {
  if (value === undefined || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
  return value;
}, z.boolean());

const integerFromEnv = z.preprocess((value) => {
  if (value === undefined || value === '') return undefined;
  return Number(value);
}, z.number().int().positive());

const jsonRecordFromEnv = z.preprocess((value) => {
  if (value === undefined || value === '') return {};
  if (typeof value !== 'string') return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}, z.record(z.string(), z.record(z.string(), z.unknown())));

const EnvSchema = z.object({
  NODE_ENV: z.string().default('development'),
  CRYPTOATTACK_API_KEY: z.string().default(''),
  CRYPTOATTACK_MAIN_URL: z.string().url().default('https://wss.cryptoattack.net'),
  CRYPTOATTACK_FAST_URL: z.string().url().default('https://wss2.cryptoattack.net'),
  SERVER_HOST: z.string().default('0.0.0.0'),
  SERVER_PORT: integerFromEnv.default(3001),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  MOCK_CRYPTOATTACK: booleanFromEnv.default(false),
  LOG_RAW_EVENTS: booleanFromEnv.default(true),
  REPLAY_RAW_EVENTS_ON_START: booleanFromEnv.optional(),
  RAW_EVENT_LOG_PATH: z.string().default('./data/raw-events.ndjson'),
  EVENT_BUFFER_SIZE: integerFromEnv.default(500),
  DEDUPE_TTL_MS: integerFromEnv.default(86_400_000),
  CRYPTOATTACK_RESUBSCRIBE_INTERVAL_MS: integerFromEnv.default(120_000),
  ENABLE_DELISTINGS: booleanFromEnv.default(true),
  ENABLE_ANNOUNCEMENT_DELISTING_FALLBACK: booleanFromEnv.default(false),
  DASHBOARD_AUTH_ENABLED: booleanFromEnv.default(false),
  DASHBOARD_AUTH_TOKEN: z.string().default(''),
  DASHBOARD_ADMIN_TOKEN: z.string().default(''),
  MOCK_EVENT_INTERVAL_MS: integerFromEnv.default(1_000),
  EXCHANGE_SYMBOL_CACHE_ENABLED: booleanFromEnv.default(true),
  EXCHANGE_SYMBOL_CACHE_PATH: z.string().default('./data/exchange-symbols.json'),
  EXCHANGE_SYMBOL_REFRESH_UTC_TIME: z.string().regex(/^\d{1,2}:\d{2}$/).default('00:05'),
  EXCHANGE_SYMBOL_REFRESH_TIMEOUT_MS: integerFromEnv.default(12_000),
  EXCHANGE_SYMBOL_REFRESH_ON_START: booleanFromEnv.default(true),
  CRYPTOATTACK_SUBSCRIBE_EXTRAS: jsonRecordFromEnv.default({}),
  DATABASE_URL: z.string().default(''),
  DATABASE_SSL: booleanFromEnv.default(false),
  DATABASE_POOL_MAX: integerFromEnv.default(10),
  DATABASE_STORAGE_ENABLED: booleanFromEnv.default(false),
  DATABASE_REQUIRED_ON_START: booleanFromEnv.default(false),
  DATABASE_MIGRATIONS_ON_START: booleanFromEnv.default(false),
  DATABASE_STATEMENT_TIMEOUT_MS: integerFromEnv.default(5_000),
  DATABASE_WRITE_QUEUE_MAX: integerFromEnv.default(10_000),
  DATABASE_WRITE_MAX_RETRIES: integerFromEnv.default(3),
  DATABASE_WRITE_RETRY_BASE_MS: integerFromEnv.default(250),
  DATABASE_WRITE_RETRY_MAX_MS: integerFromEnv.default(5_000),
  DATABASE_WRITE_DRAIN_TIMEOUT_MS: integerFromEnv.default(10_000),
  RAW_EVENTS_RETENTION_DAYS: integerFromEnv.default(30),
  TIMESCALE_COMPRESSION_ENABLED: booleanFromEnv.default(false)
});

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = EnvSchema.parse(env);
  const databaseUrl = parsed.DATABASE_URL.trim();

  if (parsed.DASHBOARD_AUTH_ENABLED && !parsed.DASHBOARD_AUTH_TOKEN) {
    throw new Error('DASHBOARD_AUTH_TOKEN is required when DASHBOARD_AUTH_ENABLED=true');
  }

  if (parsed.NODE_ENV === 'production' && parsed.DASHBOARD_AUTH_ENABLED && !parsed.DASHBOARD_ADMIN_TOKEN) {
    throw new Error('DASHBOARD_ADMIN_TOKEN is required in production when DASHBOARD_AUTH_ENABLED=true');
  }

  if (parsed.DATABASE_STORAGE_ENABLED) {
    assertValidDatabaseUrl(databaseUrl);
  }

  if (parsed.DATABASE_REQUIRED_ON_START && !parsed.DATABASE_STORAGE_ENABLED) {
    throw new Error('DATABASE_STORAGE_ENABLED=true is required when DATABASE_REQUIRED_ON_START=true');
  }

  assertRetentionWindow('RAW_EVENTS_RETENTION_DAYS', parsed.RAW_EVENTS_RETENTION_DAYS, compressionAfterDays(parsed.RAW_EVENTS_RETENTION_DAYS, 2));

  return {
    cryptoAttackApiKey: parsed.CRYPTOATTACK_API_KEY,
    cryptoAttackMainUrl: parsed.CRYPTOATTACK_MAIN_URL,
    cryptoAttackFastUrl: parsed.CRYPTOATTACK_FAST_URL,
    serverHost: parsed.SERVER_HOST,
    serverPort: parsed.SERVER_PORT,
    webOrigin: parsed.WEB_ORIGIN,
    mockCryptoAttack: parsed.MOCK_CRYPTOATTACK,
    logRawEvents: parsed.LOG_RAW_EVENTS,
    replayRawEventsOnStart: parsed.REPLAY_RAW_EVENTS_ON_START ?? parsed.MOCK_CRYPTOATTACK,
    rawEventLogPath: parsed.RAW_EVENT_LOG_PATH,
    eventBufferSize: parsed.EVENT_BUFFER_SIZE,
    dedupeTtlMs: parsed.DEDUPE_TTL_MS,
    cryptoAttackResubscribeIntervalMs: parsed.CRYPTOATTACK_RESUBSCRIBE_INTERVAL_MS,
    enableDelistings: parsed.ENABLE_DELISTINGS,
    enableAnnouncementDelistingFallback: parsed.ENABLE_ANNOUNCEMENT_DELISTING_FALLBACK,
    dashboardAuthEnabled: parsed.DASHBOARD_AUTH_ENABLED,
    dashboardAuthToken: parsed.DASHBOARD_AUTH_TOKEN,
    dashboardAdminToken: parsed.DASHBOARD_ADMIN_TOKEN,
    mockEventIntervalMs: parsed.MOCK_EVENT_INTERVAL_MS,
    exchangeSymbolCacheEnabled: parsed.EXCHANGE_SYMBOL_CACHE_ENABLED,
    exchangeSymbolCachePath: parsed.EXCHANGE_SYMBOL_CACHE_PATH,
    exchangeSymbolRefreshUtcTime: parsed.EXCHANGE_SYMBOL_REFRESH_UTC_TIME,
    exchangeSymbolRefreshTimeoutMs: parsed.EXCHANGE_SYMBOL_REFRESH_TIMEOUT_MS,
    exchangeSymbolRefreshOnStart: parsed.EXCHANGE_SYMBOL_REFRESH_ON_START,
    subscribeExtras: parsed.CRYPTOATTACK_SUBSCRIBE_EXTRAS,
    database: {
      storageEnabled: parsed.DATABASE_STORAGE_ENABLED,
      url: parsed.DATABASE_STORAGE_ENABLED ? databaseUrl : null,
      ssl: parsed.DATABASE_SSL,
      poolMax: parsed.DATABASE_POOL_MAX,
      requiredOnStart: parsed.DATABASE_REQUIRED_ON_START,
      migrationsOnStart: parsed.DATABASE_MIGRATIONS_ON_START,
      statementTimeoutMs: parsed.DATABASE_STATEMENT_TIMEOUT_MS,
      writeQueueMax: parsed.DATABASE_WRITE_QUEUE_MAX,
      writeMaxRetries: parsed.DATABASE_WRITE_MAX_RETRIES,
      writeRetryBaseMs: parsed.DATABASE_WRITE_RETRY_BASE_MS,
      writeRetryMaxMs: parsed.DATABASE_WRITE_RETRY_MAX_MS,
      writeDrainTimeoutMs: parsed.DATABASE_WRITE_DRAIN_TIMEOUT_MS,
      timescale: {
        compressionEnabled: parsed.TIMESCALE_COMPRESSION_ENABLED,
        tables: {
          raw_events: {
            timeColumn: 'received_at',
            retentionDays: parsed.RAW_EVENTS_RETENTION_DAYS,
            compressionAfterDays: compressionAfterDays(parsed.RAW_EVENTS_RETENTION_DAYS, 2)
          }
        }
      }
    }
  };
}

function compressionAfterDays(retentionDays: number, preferredDays: number): number {
  return Math.max(1, Math.min(preferredDays, retentionDays - 1));
}

function assertRetentionWindow(name: string, retentionDays: number, compressionDays: number): void {
  if (retentionDays <= compressionDays) {
    throw new Error(`${name} must be greater than the derived compression policy window`);
  }
}

function assertValidDatabaseUrl(value: string): void {
  if (!value) {
    throw new Error('DATABASE_URL is required when DATABASE_STORAGE_ENABLED=true');
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(value);
  } catch {
    throw new Error('DATABASE_URL must be a valid postgres:// or postgresql:// URL when DATABASE_STORAGE_ENABLED=true');
  }

  if (parsedUrl.protocol !== 'postgres:' && parsedUrl.protocol !== 'postgresql:') {
    throw new Error('DATABASE_URL must use postgres:// or postgresql:// when DATABASE_STORAGE_ENABLED=true');
  }
}
