import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';

export interface MigrationQueryable {
  query<T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<T>>;
}

export interface MigrationFile {
  version: string;
  filename: string;
  path: string;
  sql: string;
  checksum: string;
}

export interface MigrationStatusEntry {
  version: string;
  filename: string;
  checksum: string;
  applied: boolean;
  appliedAt: string | null;
  appliedChecksum: string | null;
  checksumMatches: boolean | null;
}

export interface MigrationStatus {
  migrationsDir: string;
  appliedCount: number;
  pendingCount: number;
  migrations: MigrationStatusEntry[];
}

interface AppliedMigrationRow extends QueryResultRow {
  version: string;
  filename: string | null;
  checksum: string | null;
  applied_at: Date | string;
}

export async function loadMigrationFiles(migrationsDir: string): Promise<MigrationFile[]> {
  const entries = await readdir(migrationsDir, { withFileTypes: true });
  const filenames = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  const seenVersions = new Set<string>();
  const migrations: MigrationFile[] = [];
  for (const filename of filenames) {
    const version = extractMigrationVersion(filename);
    if (seenVersions.has(version)) throw new Error(`Duplicate migration version: ${version}`);
    seenVersions.add(version);

    const path = join(migrationsDir, filename);
    const sql = await readFile(path, 'utf8');
    migrations.push({
      version,
      filename,
      path,
      sql,
      checksum: createHash('sha256').update(sql).digest('hex')
    });
  }

  return migrations;
}

export function extractMigrationVersion(filename: string): string {
  const match = /^(\d{6,})[_-]/u.exec(filename);
  return match?.[1] ?? filename.replace(/\.sql$/u, '');
}

export async function getMigrationStatus(client: MigrationQueryable, migrationsDir: string): Promise<MigrationStatus> {
  await ensureSchemaMigrations(client);
  const migrations = await loadMigrationFiles(migrationsDir);
  const applied = await getAppliedMigrations(client);
  const statusEntries = migrations.map((migration) => {
    const appliedMigration = applied.get(migration.version);
    const appliedChecksum = appliedMigration?.checksum ?? null;
    return {
      version: migration.version,
      filename: migration.filename,
      checksum: migration.checksum,
      applied: appliedMigration !== undefined,
      appliedAt: appliedMigration ? normalizeAppliedAt(appliedMigration.applied_at) : null,
      appliedChecksum,
      checksumMatches: appliedChecksum === null ? null : appliedChecksum === migration.checksum
    } satisfies MigrationStatusEntry;
  });

  return {
    migrationsDir,
    appliedCount: statusEntries.filter((entry) => entry.applied).length,
    pendingCount: statusEntries.filter((entry) => !entry.applied).length,
    migrations: statusEntries
  };
}

export async function runMigrations(pool: Pool, migrationsDir: string): Promise<MigrationStatus> {
  await ensureSchemaMigrations(pool);
  const migrations = await loadMigrationFiles(migrationsDir);
  const applied = await getAppliedMigrations(pool);

  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(migration.sql);
      await ensureSchemaMigrations(client);
      await client.query(
        `insert into schema_migrations (version, filename, checksum)
         values ($1, $2, $3)`,
        [migration.version, migration.filename, migration.checksum]
      );
      await client.query('commit');
    } catch (error) {
      await rollbackQuietly(client);
      throw new Error(`Failed to apply migration ${migration.filename}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      client.release();
    }
  }

  return getMigrationStatus(pool, migrationsDir);
}

export function formatMigrationStatus(status: MigrationStatus): string {
  const lines = [`Migrations: ${status.appliedCount} applied, ${status.pendingCount} pending`, `Directory: ${status.migrationsDir}`];
  for (const migration of status.migrations) {
    const marker = migration.applied ? 'applied' : 'pending';
    const checksumNote = migration.checksumMatches === false ? ' checksum-mismatch' : '';
    lines.push(`${marker}${checksumNote} ${migration.filename}`);
  }
  return lines.join('\n');
}

async function ensureSchemaMigrations(client: MigrationQueryable): Promise<void> {
  await client.query(`create table if not exists schema_migrations (
    version text primary key,
    filename text not null,
    checksum text not null,
    applied_at timestamptz not null default now()
  )`);
}

async function getAppliedMigrations(client: MigrationQueryable): Promise<Map<string, AppliedMigrationRow>> {
  const result = await client.query<AppliedMigrationRow>('select version, filename, checksum, applied_at from schema_migrations order by version');
  return new Map(result.rows.map((row) => [row.version, row]));
}

async function rollbackQuietly(client: PoolClient): Promise<void> {
  try {
    await client.query('rollback');
  } catch {
    // Preserve the original migration error.
  }
}

function normalizeAppliedAt(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}
