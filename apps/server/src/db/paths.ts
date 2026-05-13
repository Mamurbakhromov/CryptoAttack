import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export function resolveDefaultMigrationsDir(cwd = process.cwd()): string {
  const packageDir = resolve(cwd, 'migrations');
  if (existsSync(packageDir)) return packageDir;
  return resolve(cwd, 'apps/server/migrations');
}
