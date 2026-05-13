import { describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config.js';
import { buildStartupWarnings } from '../src/ops/startupWarnings.js';

describe('startup warnings', () => {
  it('reports unsafe production-facing configuration without secrets', () => {
    const warnings = buildStartupWarnings(loadConfig({
      DATABASE_STORAGE_ENABLED: 'true',
      DATABASE_URL: 'postgres://user:secret@db.example.com:5432/cryptoattack',
      DATABASE_SSL: 'false',
      SERVER_HOST: '0.0.0.0',
      DASHBOARD_AUTH_ENABLED: 'false',
      MOCK_CRYPTOATTACK: 'false',
      LOG_RAW_EVENTS: 'false'
    }));

    expect(warnings.map((warning) => warning.code)).toEqual(expect.arrayContaining([
      'dashboard_auth_disabled',
      'dashboard_bound_publicly_without_auth',
      'migrations_on_start_disabled',
      'database_ssl_disabled_non_local',
      'raw_event_logging_disabled'
    ]));
    expect(JSON.stringify(warnings)).not.toContain('secret');
  });
});
