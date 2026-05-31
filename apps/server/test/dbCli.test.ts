import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';

import { runDatabaseCommand, sanitizeDatabaseErrorMessage } from '../src/db/cli.js';
import { loadMigrationFiles, type MigrationFile } from '../src/db/migrations.js';

describe('database CLI', () => {
  it('reports disabled storage status without requiring DATABASE_URL', async () => {
    const stdout = createWriter();
    const stderr = createWriter();

    const exitCode = await runDatabaseCommand('status', {
      env: { DATABASE_STORAGE_ENABLED: 'false' },
      stdout,
      stderr
    });

    expect(exitCode).toBe(0);
    expect(stdout.value).toContain('Database storage disabled');
    expect(stderr.value).toBe('');
  });

  it('refuses migration commands when storage is disabled', async () => {
    const stdout = createWriter();
    const stderr = createWriter();

    const exitCode = await runDatabaseCommand('migrate', {
      env: { DATABASE_STORAGE_ENABLED: 'false' },
      stdout,
      stderr
    });

    expect(exitCode).toBe(1);
    expect(stdout.value).toBe('');
    expect(stderr.value).toContain('Set DATABASE_STORAGE_ENABLED=true before running db:migrate');
  });

  it('returns a sanitized error for invalid enabled storage config', async () => {
    const stdout = createWriter();
    const stderr = createWriter();

    const exitCode = await runDatabaseCommand('status', {
      env: { DATABASE_STORAGE_ENABLED: 'true', DATABASE_URL: 'not-a-url' },
      stdout,
      stderr
    });

    expect(exitCode).toBe(1);
    expect(stdout.value).toBe('');
    expect(stderr.value).toContain('DATABASE_URL must be a valid postgres:// or postgresql:// URL');
    expect(stderr.value).not.toContain('not-a-url');
  });

  it('redacts Postgres URLs from database error messages', () => {
    const sanitized = sanitizeDatabaseErrorMessage(
      new Error('failed to connect to postgres://user:super-secret@localhost:5432/cryptoattack'),
      'postgres://user:super-secret@localhost:5432/cryptoattack'
    );

    expect(sanitized).toBe('failed to connect to [redacted database url]');
    expect(sanitized).not.toContain('super-secret');
  });

  it('fails migration verification when migrations are pending', async () => {
    const dir = await makeMigrationDir();
    const migrations = await loadMigrationFiles(dir);
    const stdout = createWriter();
    const stderr = createWriter();

    const exitCode = await runDatabaseCommand('verify', {
      env: enabledDatabaseEnv(),
      stdout,
      stderr,
      migrationsDir: dir,
      createPool: () => new FakeMigrationPool([appliedRow(migrations[0])]),
      verifyConnection: async () => undefined
    });

    await rm(dir, { recursive: true, force: true });

    expect(exitCode).toBe(1);
    expect(stdout.value).toContain('Migrations: 1 applied, 1 pending');
    expect(stderr.value).toContain('Database migrations are not clean');
  });

  it('fails migration verification when an applied checksum differs', async () => {
    const dir = await makeMigrationDir();
    const migrations = await loadMigrationFiles(dir);
    const stdout = createWriter();
    const stderr = createWriter();

    const exitCode = await runDatabaseCommand('verify', {
      env: enabledDatabaseEnv(),
      stdout,
      stderr,
      migrationsDir: dir,
      createPool: () => new FakeMigrationPool([
        { ...appliedRow(migrations[0]), checksum: 'old-checksum' },
        appliedRow(migrations[1])
      ]),
      verifyConnection: async () => undefined
    });

    await rm(dir, { recursive: true, force: true });

    expect(exitCode).toBe(1);
    expect(stdout.value).toContain('applied checksum-mismatch 000001_first.sql');
    expect(stderr.value).toContain('Database migrations are not clean');
  });

  it('passes migration verification when all migrations are applied cleanly', async () => {
    const dir = await makeMigrationDir();
    const migrations = await loadMigrationFiles(dir);
    const stdout = createWriter();
    const stderr = createWriter();

    const exitCode = await runDatabaseCommand('verify', {
      env: enabledDatabaseEnv(),
      stdout,
      stderr,
      migrationsDir: dir,
      createPool: () => new FakeMigrationPool(migrations.map(appliedRow)),
      verifyConnection: async () => undefined
    });

    await rm(dir, { recursive: true, force: true });

    expect(exitCode).toBe(0);
    expect(stdout.value).toContain('Migrations verified.');
    expect(stdout.value).toContain('Migrations: 2 applied, 0 pending');
    expect(stderr.value).toBe('');
  });

  it('drops historical scoring storage tables during local reset', async () => {
    const stdout = createWriter();
    const stderr = createWriter();
    const pool = new FakeMigrationPool([]);

    const exitCode = await runDatabaseCommand('reset', {
      env: {
        ...enabledDatabaseEnv(),
        NODE_ENV: 'development'
      },
      stdout,
      stderr,
      createPool: () => pool,
      verifyConnection: async () => undefined
    });

    const dropQuery = pool.queries.find((query) => query.startsWith('drop table if exists'));
    expect(exitCode).toBe(0);
    expect(dropQuery).toContain('price_ticks');
    expect(dropQuery).toContain('score_snapshots');
    expect(dropQuery).toContain('score_evidence');
    expect(dropQuery).toContain('forward_returns');
    expect(stdout.value).toContain('Local database schema reset');
    expect(stderr.value).toBe('');
  });
});

function createWriter(): { write: (chunk: string) => void; readonly value: string } {
  let output = '';
  return {
    write(chunk: string): void {
      output += chunk;
    },
    get value(): string {
      return output;
    }
  };
}

async function makeMigrationDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'cryptoattack-db-cli-'));
  await writeFile(join(dir, '000001_first.sql'), 'select 1;', 'utf8');
  await writeFile(join(dir, '000002_second.sql'), 'select 2;', 'utf8');
  return dir;
}

function enabledDatabaseEnv(): NodeJS.ProcessEnv {
  return {
    DATABASE_STORAGE_ENABLED: 'true',
    DATABASE_URL: 'postgres://user:secret@localhost:5432/cryptoattack'
  };
}

function appliedRow(migration: MigrationFile | undefined): QueryResultRow {
  if (!migration) throw new Error('missing migration fixture');
  return {
    version: migration.version,
    filename: migration.filename,
    checksum: migration.checksum,
    applied_at: new Date('2026-01-01T00:00:00.000Z')
  };
}

class FakeMigrationPool {
  readonly queries: string[] = [];

  constructor(private readonly appliedRows: QueryResultRow[]) {}

  async query<T extends QueryResultRow = QueryResultRow>(sql: string): Promise<QueryResult<T>> {
    this.queries.push(sql);
    if (sql === 'select 1') return { rows: [{ '?column?': 1 }] as unknown as T[] } as QueryResult<T>;
    if (sql.startsWith('create table if not exists schema_migrations')) return { rows: [] as T[] } as QueryResult<T>;
    if (sql.startsWith('select version')) return { rows: this.appliedRows as T[] } as QueryResult<T>;
    return { rows: [] as T[] } as QueryResult<T>;
  }

  async end(): Promise<void> {
    return undefined;
  }
}
