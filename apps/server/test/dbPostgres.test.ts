import { describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config.js';
import { createPostgresPool, isLocalDatabaseUrl } from '../src/db/postgres.js';

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
});
