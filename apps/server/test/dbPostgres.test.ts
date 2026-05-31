import { describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config.js';
import { closePostgresPool, createPostgresPool, isLocalDatabaseUrl, verifyPostgresConnection } from '../src/db/postgres.js';

describe('postgres database module', () => {
  it('does not create a pool when storage is disabled', () => {
    const config = loadConfig({ DATABASE_STORAGE_ENABLED: 'false' });

    expect(createPostgresPool(config.database)).toBeNull();
  });

  it('classifies only local database URLs as reset-safe', () => {
    expect(isLocalDatabaseUrl('postgres://user:pass@localhost:5432/db')).toBe(true);
    expect(isLocalDatabaseUrl('postgres://user:pass@127.0.0.1:5432/db')).toBe(true);
    expect(isLocalDatabaseUrl('postgres://user:pass@postgres:5432/db')).toBe(true);
    expect(isLocalDatabaseUrl('postgres://user:pass@db.example.com:5432/db')).toBe(false);
    expect(isLocalDatabaseUrl('not-a-url')).toBe(false);
  });

  it('uses the statement timeout as the connection timeout', async () => {
    const config = loadConfig({
      DATABASE_STORAGE_ENABLED: 'true',
      DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
      DATABASE_STATEMENT_TIMEOUT_MS: '1234'
    });
    const pool = createPostgresPool(config.database);

    expect(pool?.options.connectionTimeoutMillis).toBe(1234);
    await closePostgresPool(pool);
  });

  it('times out database verification instead of hanging startup forever', async () => {
    await expect(
      verifyPostgresConnection(
        {
          query: () => new Promise(() => undefined)
        },
        5
      )
    ).rejects.toThrow('Timed out verifying Postgres connection after 5ms');
  });
});
