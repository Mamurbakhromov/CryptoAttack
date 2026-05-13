import { Pool, type PoolConfig } from 'pg';

import type { AppConfig } from '../config.js';

export type DatabaseConfig = AppConfig['database'];
export type PostgresPool = Pool;

export function createPostgresPool(config: DatabaseConfig): PostgresPool | null {
  if (!config.storageEnabled) return null;
  if (!config.url) throw new Error('DATABASE_URL is required when DATABASE_STORAGE_ENABLED=true');

  const poolConfig: PoolConfig = {
    connectionString: config.url,
    max: config.poolMax,
    application_name: 'cryptoattack-dashboard',
    statement_timeout: config.statementTimeoutMs,
    query_timeout: config.statementTimeoutMs,
    ...(config.ssl ? { ssl: { rejectUnauthorized: false } } : {})
  };

  return new Pool(poolConfig);
}

export async function verifyPostgresConnection(pool: PostgresPool): Promise<void> {
  await pool.query('select 1');
}

export async function closePostgresPool(pool: PostgresPool | null): Promise<void> {
  if (!pool) return;
  await pool.end();
}

export function isLocalDatabaseUrl(databaseUrl: string | null): boolean {
  if (!databaseUrl) return false;
  try {
    const parsed = new URL(databaseUrl);
    return ['localhost', '127.0.0.1', '::1', 'postgres'].includes(parsed.hostname);
  } catch {
    return false;
  }
}
