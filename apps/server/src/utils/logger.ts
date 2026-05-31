import pino from 'pino';

export const redactionPaths = [
  'cryptoAttackApiKey',
  'CRYPTOATTACK_API_KEY',
  'DATABASE_URL',
  'DASHBOARD_AUTH_TOKEN',
  'DASHBOARD_ADMIN_TOKEN',
  'dashboardAuthToken',
  'dashboardAdminToken',
  'authorization',
  'Authorization',
  'headers.authorization',
  'req.headers.authorization',
  'request.headers.authorization',
  'database.url',
  'database.connectionString',
  'databaseUrl',
  'connectionString',
  'password',
  'token',
  '*.databaseUrl',
  '*.apiKey',
  '*.auth.apiKey',
  '*.password',
  '*.token'
];

export function createLogger(destination?: pino.DestinationStream) {
  return pino({
    level: process.env.LOG_LEVEL ?? 'info',
    redact: {
      paths: redactionPaths,
      censor: '[redacted]'
    }
  }, destination);
}

export type AppLogger = ReturnType<typeof createLogger>;
