import { describe, expect, it } from 'vitest';

import { createLogger, redactionPaths } from '../src/utils/logger.js';

describe('logger redaction', () => {
  it('redacts API keys, database URLs, auth headers, tokens, and passwords', () => {
    const chunks: string[] = [];
    const logger = createLogger({ write: (chunk: string) => chunks.push(chunk) });

    logger.info({
      CRYPTOATTACK_API_KEY: 'CryptoAttack-secret',
      DATABASE_URL: 'postgres://user:db-secret@localhost:5432/cryptoattack',
      headers: { authorization: 'Bearer dashboard-secret' },
      nested: { token: 'nested-token', password: 'nested-password' }
    }, 'redaction test');

    const output = chunks.join('');
    expect(output).toContain('[redacted]');
    expect(output).not.toContain('CryptoAttack-secret');
    expect(output).not.toContain('db-secret');
    expect(output).not.toContain('dashboard-secret');
    expect(output).not.toContain('nested-token');
    expect(output).not.toContain('nested-password');
    expect(redactionPaths).toContain('headers.authorization');
  });
});
