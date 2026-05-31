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
      requiredOnStart: false,
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
          raw_events: { timeColumn: 'received_at', retentionDays: 30, compressionAfterDays: 2 }
        }
      }
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
      DATABASE_REQUIRED_ON_START: 'true',
      DATABASE_MIGRATIONS_ON_START: 'true',
      DATABASE_STATEMENT_TIMEOUT_MS: '9000',
      DATABASE_WRITE_QUEUE_MAX: '25',
      DATABASE_WRITE_MAX_RETRIES: '4',
      DATABASE_WRITE_RETRY_BASE_MS: '10',
      DATABASE_WRITE_RETRY_MAX_MS: '100',
      DATABASE_WRITE_DRAIN_TIMEOUT_MS: '1000',
      RAW_EVENTS_RETENTION_DAYS: '45',
      TIMESCALE_COMPRESSION_ENABLED: 'true'
    });

    expect(config.database).toEqual({
      storageEnabled: true,
      url: 'postgres://user:secret@localhost:5432/cryptoattack',
      ssl: true,
      poolMax: 7,
      requiredOnStart: true,
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
          raw_events: { timeColumn: 'received_at', retentionDays: 45, compressionAfterDays: 2 }
        }
      }
    });
  });

  it('requires database storage when production startup requires database availability', () => {
    expect(() => loadConfig({ DATABASE_REQUIRED_ON_START: 'true' })).toThrow('DATABASE_STORAGE_ENABLED=true is required when DATABASE_REQUIRED_ON_START=true');
  });

  it('requires a separate admin token for production dashboard auth', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', DASHBOARD_AUTH_ENABLED: 'true', DASHBOARD_AUTH_TOKEN: 'dashboard-secret' })).toThrow(
      'DASHBOARD_ADMIN_TOKEN is required in production when DASHBOARD_AUTH_ENABLED=true'
    );
  });

  it('rejects unsafe retention windows', () => {
    expect(() => loadConfig({ RAW_EVENTS_RETENTION_DAYS: '1' })).toThrow('RAW_EVENTS_RETENTION_DAYS must be greater than the derived compression policy window');
  });
});
