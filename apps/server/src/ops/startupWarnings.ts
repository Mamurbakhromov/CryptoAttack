import type { AppConfig } from '../config.js';
import { isLocalDatabaseUrl } from '../db/postgres.js';

export interface StartupWarning {
  code: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
}

export function buildStartupWarnings(config: AppConfig): StartupWarning[] {
  const warnings: StartupWarning[] = [];
  if (!config.dashboardAuthEnabled) warnings.push(warning('dashboard_auth_disabled', 'warning', 'Dashboard API auth is disabled.'));
  if (!config.dashboardAuthEnabled && config.serverHost === '0.0.0.0') warnings.push(warning('dashboard_bound_publicly_without_auth', 'critical', 'Server is bound publicly while dashboard auth is disabled.'));
  if (config.mockCryptoAttack) warnings.push(warning('mock_mode_enabled', 'info', 'Mock CryptoAttack mode is enabled.'));
  if (!config.database.storageEnabled) warnings.push(warning('storage_disabled', 'info', 'Database storage is disabled.'));
  if (config.database.storageEnabled && !config.database.migrationsOnStart) warnings.push(warning('migrations_on_start_disabled', 'warning', 'Database migrations are not run automatically on startup.'));
  if (config.database.storageEnabled && !config.database.ssl && !isLocalDatabaseUrl(config.database.url)) warnings.push(warning('database_ssl_disabled_non_local', 'critical', 'Database SSL is disabled for a non-local database host.'));
  if (!config.database.storageEnabled && config.priceCollection.enabled) warnings.push(warning('price_collection_enabled_without_storage', 'warning', 'Price collection is enabled but storage is disabled.'));
  if (!config.logRawEvents) warnings.push(warning('raw_event_logging_disabled', 'warning', 'Raw event NDJSON logging is disabled.'));
  if (!config.replayRawEventsOnStart) warnings.push(warning('raw_event_replay_disabled', 'info', 'Raw event replay is disabled on startup.'));
  if (config.database.storageEnabled && !config.database.timescale.compressionEnabled) warnings.push(warning('timescale_compression_disabled', 'info', 'Timescale compression policies are disabled.'));
  return warnings;
}

function warning(code: string, severity: StartupWarning['severity'], message: string): StartupWarning {
  return { code, severity, message };
}
