import { describe, expect, it } from 'vitest';

import { runDatabaseCommand, sanitizeDatabaseErrorMessage } from '../src/db/cli.js';

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
