import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { config as loadDotenv } from 'dotenv';
import type { Pool } from 'pg';

import { loadConfig, type AppConfig } from '../config.js';
import { backfillRawEventsFromNdjson } from './backfillRawEvents.js';
import { EventIngestionRepository } from './eventRepository.js';
import { closePostgresPool, createPostgresPool, isLocalDatabaseUrl, verifyPostgresConnection } from './postgres.js';
import { formatMigrationStatus, getMigrationStatus, runMigrations } from './migrations.js';
import { resolveDefaultMigrationsDir } from './paths.js';

type DatabaseCommand = 'migrate' | 'status' | 'reset' | 'backfill';

interface OutputWriter {
  write(chunk: string): void;
}

interface DatabaseCommandOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  stdout?: OutputWriter;
  stderr?: OutputWriter;
  migrationsDir?: string;
  args?: string[];
}

const resetTables = [
  'ingestion_errors',
  'forward_returns',
  'score_evidence',
  'coin_score_current',
  'score_snapshots',
  'score_config_versions',
  'price_ticks',
  'event_entry_keys',
  'event_entries',
  'normalized_event_keys',
  'normalized_events',
  'raw_event_keys',
  'raw_events',
  'schema_migrations'
];

export async function runDatabaseCommand(commandInput: string | undefined, options: DatabaseCommandOptions = {}): Promise<number> {
  const command = parseCommand(commandInput);
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  let config: AppConfig | null = null;
  let pool: Pool | null = null;

  if (!command) {
    stderr.write('Usage: db <migrate|status|reset>\n');
    return 1;
  }

  try {
    config = loadConfig(env);
    if (!config.database.storageEnabled) {
      if (command === 'status') {
        stdout.write('Database storage disabled. Set DATABASE_STORAGE_ENABLED=true to use Postgres storage.\n');
        return 0;
      }
      stderr.write(`Database storage disabled. Set DATABASE_STORAGE_ENABLED=true before running db:${command}.\n`);
      return 1;
    }

    pool = createPostgresPool(config.database);
    if (!pool) throw new Error('Database storage is disabled');
    await verifyPostgresConnection(pool);

    const migrationsDir = options.migrationsDir ?? resolveDefaultMigrationsDir(cwd);
    if (command === 'migrate') {
      const status = await runMigrations(pool, migrationsDir);
      stdout.write(`Migrations complete.\n${formatMigrationStatus(status)}\n`);
      return 0;
    }

    if (command === 'status') {
      const status = await getMigrationStatus(pool, migrationsDir);
      stdout.write(`${formatMigrationStatus(status)}\n`);
      return 0;
    }

    if (command === 'backfill') {
      const backfillOptions = parseBackfillArgs(options.args ?? [], config);
      const repository = new EventIngestionRepository(pool);
      const result = await backfillRawEventsFromNdjson({
        path: backfillOptions.path,
        repository,
        enableDelistings: config.enableDelistings,
        enableAnnouncementDelistingFallback: config.enableAnnouncementDelistingFallback,
        ...(backfillOptions.limit === undefined ? {} : { limit: backfillOptions.limit })
      });
      stdout.write(
        `Backfill complete. scanned=${result.scanned} processed=${result.processed} skipped=${result.skipped} failed=${result.failed} normalizedEvents=${result.normalizedEvents} entries=${result.entries}\n`
      );
      return result.failed > 0 ? 1 : 0;
    }

    assertSafeLocalReset(config, env);
    await resetLocalDatabase(pool);
    stdout.write('Local database schema reset. Run db:migrate to recreate tables.\n');
    return 0;
  } catch (error) {
    stderr.write(`Database command failed: ${sanitizeDatabaseErrorMessage(error, config?.database.url ?? null)}\n`);
    return 1;
  } finally {
    await closePostgresPool(pool);
  }
}

export function sanitizeDatabaseErrorMessage(error: unknown, databaseUrl: string | null): string {
  let message = error instanceof Error ? error.message : String(error);
  if (databaseUrl) message = message.split(databaseUrl).join('[redacted database url]');
  return message.replace(/postgres(?:ql)?:\/\/\S+/giu, '[redacted database url]');
}

function parseCommand(value: string | undefined): DatabaseCommand | null {
  if (value === 'migrate' || value === 'status' || value === 'reset' || value === 'backfill') return value;
  return null;
}

function parseBackfillArgs(args: string[], config: AppConfig): { path: string; limit: number | undefined } {
  let path = config.rawEventLogPath;
  let limit: number | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === '--path' && next) {
      path = next;
      index += 1;
    } else if (arg === '--limit' && next) {
      const parsed = Number(next);
      if (!Number.isInteger(parsed) || parsed <= 0) throw new Error('--limit must be a positive integer');
      limit = parsed;
      index += 1;
    }
  }
  return limit === undefined ? { path, limit: undefined } : { path, limit };
}

function assertSafeLocalReset(config: AppConfig, env: NodeJS.ProcessEnv): void {
  if (env.NODE_ENV === 'production') {
    throw new Error('db:reset is refused when NODE_ENV=production');
  }
  if (!isLocalDatabaseUrl(config.database.url)) {
    throw new Error('db:reset is only allowed for localhost, 127.0.0.1, ::1, or postgres DATABASE_URL hosts');
  }
}

async function resetLocalDatabase(pool: Pool): Promise<void> {
  await pool.query('begin');
  try {
    await pool.query(`drop table if exists ${resetTables.join(', ')} cascade`);
    await pool.query('commit');
  } catch (error) {
    await pool.query('rollback').catch(() => undefined);
    throw error;
  }
}

function loadEnvFiles(): void {
  const candidates = [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')];
  for (const path of candidates) {
    if (existsSync(path)) loadDotenv({ path, override: false });
  }
}

if (isMainModule()) {
  loadEnvFiles();
  const command = process.argv[2];
  runDatabaseCommand(command, { args: process.argv.slice(3) }).then((exitCode) => {
    process.exitCode = exitCode;
  });
}

function isMainModule(): boolean {
  const entrypoint = process.argv[1];
  return entrypoint ? import.meta.url === pathToFileURL(entrypoint).href : false;
}
