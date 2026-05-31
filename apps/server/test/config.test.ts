import { describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config.js';

describe('loadConfig database settings', () => {
  it('keeps database storage disabled by default', () => {
    const config = loadConfig({});

    expect(config.database).toEqual({
      storageEnabled: false,
      url: null,
      ssl: false,
      poolMax: 10,
      migrationsOnStart: false,
      statementTimeoutMs: 5_000,
      writeQueueMax: 10_000,
      writeMaxRetries: 3,
      writeRetryBaseMs: 250,
      writeRetryMaxMs: 5_000,
      writeDrainTimeoutMs: 10_000,
      timescale: {
        compressionEnabled: false,
        tables: {
          raw_events: { timeColumn: 'received_at', retentionDays: 30, compressionAfterDays: 2 },
          price_ticks: { timeColumn: 'ts', retentionDays: 180, compressionAfterDays: 7 },
          score_snapshots: { timeColumn: 'ts', retentionDays: 365, compressionAfterDays: 14 }
        }
      }
    });
    expect(config.priceCollection).toEqual({
      enabled: false,
      intervalMs: 60_000,
      activeCoinTtlMs: 86_400_000,
      forwardReturnHorizonsMinutes: [5, 15, 60, 240, 1_440]
    });
    expect(config.scores).toEqual({
      enabled: false,
      version: 'flow-v2',
      recalculationIntervalMs: 30_000,
      recomputeDebounceMs: 1_000,
      windowsMinutes: [5, 15, 60, 240, 1_440],
      batchCoins: 100,
      maxQueueDepth: 10_000
    });
  });

  it('ignores an invalid DATABASE_URL when storage is disabled', () => {
    const config = loadConfig({ DATABASE_URL: 'not-a-url', DATABASE_STORAGE_ENABLED: 'false' });

    expect(config.database.storageEnabled).toBe(false);
    expect(config.database.url).toBeNull();
  });

  it('requires DATABASE_URL when storage is enabled', () => {
    expect(() => loadConfig({ DATABASE_STORAGE_ENABLED: 'true' })).toThrow('DATABASE_URL is required when DATABASE_STORAGE_ENABLED=true');
  });

  it('rejects invalid or non-Postgres DATABASE_URL values without echoing secrets', () => {
    expect(() => loadConfig({ DATABASE_STORAGE_ENABLED: 'true', DATABASE_URL: 'not-a-url' })).toThrow(
      'DATABASE_URL must be a valid postgres:// or postgresql:// URL when DATABASE_STORAGE_ENABLED=true'
    );

    expect(() => loadConfig({ DATABASE_STORAGE_ENABLED: 'true', DATABASE_URL: 'mysql://user:secret@localhost/db' })).toThrow(
      'DATABASE_URL must use postgres:// or postgresql:// when DATABASE_STORAGE_ENABLED=true'
    );
  });

  it('parses enabled database settings', () => {
    const config = loadConfig({
      DATABASE_STORAGE_ENABLED: 'true',
      DATABASE_URL: 'postgres://user:secret@localhost:5432/cryptoattack',
      DATABASE_SSL: 'true',
      DATABASE_POOL_MAX: '7',
      DATABASE_MIGRATIONS_ON_START: 'true',
      DATABASE_STATEMENT_TIMEOUT_MS: '9000',
      DATABASE_WRITE_QUEUE_MAX: '25',
      DATABASE_WRITE_MAX_RETRIES: '4',
      DATABASE_WRITE_RETRY_BASE_MS: '10',
      DATABASE_WRITE_RETRY_MAX_MS: '100',
      DATABASE_WRITE_DRAIN_TIMEOUT_MS: '1000',
      RAW_EVENTS_RETENTION_DAYS: '45',
      PRICE_TICKS_RETENTION_DAYS: '120',
      SCORE_SNAPSHOTS_RETENTION_DAYS: '240',
      TIMESCALE_COMPRESSION_ENABLED: 'true',
      PRICE_COLLECTION_ENABLED: 'true',
      PRICE_COLLECTION_INTERVAL_MS: '15000',
      PRICE_COLLECTION_ACTIVE_COIN_TTL_MS: '60000',
      FORWARD_RETURN_HORIZONS_MINUTES: '60,5,15,5',
      SCORES_ENABLED: 'true',
      SCORES_VERSION: 'golden-v1',
      SCORES_RECALC_INTERVAL_MS: '20000',
      SCORES_RECOMPUTE_DEBOUNCE_MS: '500',
      SCORES_WINDOWS_MINUTES: '15,5,60,15',
      SCORES_BATCH_COINS: '25',
      SCORES_MAX_QUEUE_DEPTH: '100'
    });

    expect(config.database).toEqual({
      storageEnabled: true,
      url: 'postgres://user:secret@localhost:5432/cryptoattack',
      ssl: true,
      poolMax: 7,
      migrationsOnStart: true,
      statementTimeoutMs: 9_000,
      writeQueueMax: 25,
      writeMaxRetries: 4,
      writeRetryBaseMs: 10,
      writeRetryMaxMs: 100,
      writeDrainTimeoutMs: 1_000,
      timescale: {
        compressionEnabled: true,
        tables: {
          raw_events: { timeColumn: 'received_at', retentionDays: 45, compressionAfterDays: 2 },
          price_ticks: { timeColumn: 'ts', retentionDays: 120, compressionAfterDays: 7 },
          score_snapshots: { timeColumn: 'ts', retentionDays: 240, compressionAfterDays: 14 }
        }
      }
    });
    expect(config.priceCollection).toEqual({
      enabled: true,
      intervalMs: 15_000,
      activeCoinTtlMs: 60_000,
      forwardReturnHorizonsMinutes: [5, 15, 60]
    });
    expect(config.scores).toEqual({
      enabled: true,
      version: 'golden-v1',
      recalculationIntervalMs: 20_000,
      recomputeDebounceMs: 500,
      windowsMinutes: [5, 15, 60],
      batchCoins: 25,
      maxQueueDepth: 100
    });
  });

  it('requires database storage when scores are enabled', () => {
    expect(() => loadConfig({ SCORES_ENABLED: 'true' })).toThrow('DATABASE_STORAGE_ENABLED=true is required when SCORES_ENABLED=true');
  });

  it('rejects unsafe retention windows', () => {
    expect(() => loadConfig({ RAW_EVENTS_RETENTION_DAYS: '1' })).toThrow('RAW_EVENTS_RETENTION_DAYS must be greater than the derived compression policy window');
  });
});
