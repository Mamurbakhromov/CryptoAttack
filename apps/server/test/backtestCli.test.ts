import { describe, expect, it } from 'vitest';

import { runBacktestCommand } from '../src/backtest/cli.js';

describe('backtest CLI', () => {
  it('refuses to run when database storage is disabled', async () => {
    const stdout = createWriter();
    const stderr = createWriter();

    const exitCode = await runBacktestCommand({
      env: { DATABASE_STORAGE_ENABLED: 'false' },
      stdout,
      stderr
    });

    expect(exitCode).toBe(1);
    expect(stdout.value).toBe('');
    expect(stderr.value).toContain('Set DATABASE_STORAGE_ENABLED=true before running backtest');
  });

  it('validates horizons before opening a database connection', async () => {
    const stdout = createWriter();
    const stderr = createWriter();

    const exitCode = await runBacktestCommand({
      env: { DATABASE_STORAGE_ENABLED: 'true', DATABASE_URL: 'postgres://user:secret@localhost:5432/cryptoattack' },
      args: ['--horizon-minutes', '999'],
      stdout,
      stderr
    });

    expect(exitCode).toBe(1);
    expect(stdout.value).toBe('');
    expect(stderr.value).toContain('--horizon-minutes must be one or more of 5, 15, 60, 240, 1440');
    expect(stderr.value).not.toContain('secret');
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
