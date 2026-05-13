import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { config as loadDotenv } from 'dotenv';
import type { Pool } from 'pg';

import { loadConfig, type AppConfig } from '../config.js';
import { BacktestRepository } from '../db/backtestRepository.js';
import { sanitizeDatabaseErrorMessage } from '../db/cli.js';
import { closePostgresPool, createPostgresPool, verifyPostgresConnection } from '../db/postgres.js';
import { BacktestService } from './backtestService.js';
import type { BacktestSide, BacktestSummaryQuery } from './types.js';

interface OutputWriter {
  write(chunk: string): void;
}

interface BacktestCommandOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  stdout?: OutputWriter;
  stderr?: OutputWriter;
  args?: string[];
}

interface ParsedBacktestArgs {
  scoreConfigVersion?: string;
  compareScoreConfigVersion?: string;
  windowMinutes?: number;
  horizonsMinutes?: number[];
  from?: string;
  to?: string;
  side: BacktestSide;
  minConfidence: number;
  minAbsScore: number;
  exchange?: string;
  market?: string;
  thresholds?: number[];
  separationThreshold: number;
}

const allowedHorizons = [5, 15, 60, 240, 1440];

export async function runBacktestCommand(options: BacktestCommandOptions = {}): Promise<number> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const env = options.env ?? process.env;
  let config: AppConfig | null = null;
  let pool: Pool | null = null;

  try {
    config = loadConfig(env);
    if (!config.database.storageEnabled) {
      stderr.write('Database storage disabled. Set DATABASE_STORAGE_ENABLED=true before running backtest.\n');
      return 1;
    }

    const parsed = parseBacktestArgs(options.args ?? []);
    const query = resolveQuery(parsed, config);
    pool = createPostgresPool(config.database);
    if (!pool) throw new Error('Database storage is disabled');
    await verifyPostgresConnection(pool);

    const service = new BacktestService(new BacktestRepository(pool));
    const [summary, buckets, rules] = await Promise.all([
      service.getSummary(query),
      service.getScoreBuckets({ ...query, bucketSize: 10, confidenceBucketSize: 25, minSamples: 1 }),
      service.getRules({ ...query, minContribution: 0, minSamples: 20, limit: 25 })
    ]);

    const totalSamples = summary.metrics.reduce((sum, row) => sum + row.sampleCount, 0);
    stdout.write(`Backtest complete. scoreConfigVersion=${query.scoreConfigVersion} windowMinutes=${query.windowMinutes} horizons=${query.horizonsMinutes.join(',')} side=${query.side} samples=${totalSamples}\n`);
    for (const row of summary.metrics) {
      stdout.write(`Horizon ${formatHorizon(row.horizonMinutes)}: samples=${row.sampleCount} avg=${formatNumber(row.averageForwardReturnPct)} median=${formatNumber(row.medianForwardReturnPct)} winRate=${formatRate(row.winRate)} lossRate=${formatRate(row.lossRate)} maxAdverse=${formatNumber(row.averageMaxAdverseMovePct)}\n`);
    }
    stdout.write(`Precision thresholds=${summary.precisionByThreshold.length} scoreBuckets=${buckets.scoreBuckets.length} confidenceBuckets=${buckets.confidenceBuckets.length}\n`);
    stdout.write(`Rules: total=${rules.total} harmful=${rules.harmfulRuleCount} weak=${rules.weakRuleCount}\n`);
    return 0;
  } catch (error) {
    stderr.write(`Backtest failed: ${sanitizeDatabaseErrorMessage(error, config?.database.url ?? null)}\n`);
    return 1;
  } finally {
    await closePostgresPool(pool);
  }
}

function resolveQuery(parsed: ParsedBacktestArgs, config: AppConfig): BacktestSummaryQuery {
  const configuredWindows = config.scores.windowsMinutes.length ? config.scores.windowsMinutes : [15];
  const defaultWindow = configuredWindows.includes(15) ? 15 : configuredWindows[0] ?? 15;
  const windowMinutes = parsed.windowMinutes ?? defaultWindow;
  if (!configuredWindows.includes(windowMinutes)) throw new Error(`--window-minutes must be one of ${configuredWindows.join(', ')}`);
  const horizonsMinutes = parsed.horizonsMinutes ?? allowedHorizons;
  const invalidHorizon = horizonsMinutes.find((horizon) => !allowedHorizons.includes(horizon));
  if (invalidHorizon !== undefined) throw new Error(`--horizon-minutes must be one or more of ${allowedHorizons.join(', ')}`);
  if (parsed.from && parsed.to && Date.parse(parsed.from) >= Date.parse(parsed.to)) throw new Error('--to must be later than --from');

  const query: BacktestSummaryQuery = {
    scoreConfigVersion: parsed.scoreConfigVersion ?? config.scores.version,
    windowMinutes,
    horizonsMinutes,
    side: parsed.side,
    minConfidence: parsed.minConfidence,
    minAbsScore: parsed.minAbsScore,
    thresholds: parsed.thresholds ?? [10, 20, 30, 40, 50, 60, 70, 80, 90],
    separationThreshold: parsed.separationThreshold
  };
  if (parsed.compareScoreConfigVersion) query.compareScoreConfigVersion = parsed.compareScoreConfigVersion;
  if (parsed.from) query.from = parsed.from;
  if (parsed.to) query.to = parsed.to;
  if (parsed.exchange) query.exchange = parsed.exchange;
  if (parsed.market) query.market = parsed.market;
  return query;
}

function parseBacktestArgs(args: string[]): ParsedBacktestArgs {
  const parsed: ParsedBacktestArgs = { side: 'net', minConfidence: 0, minAbsScore: 0, separationThreshold: 50 };
  const normalizedArgs = (args[0] === 'summary' || args[0] === 'run' ? args.slice(1) : args).filter((arg) => arg !== '--');

  for (let index = 0; index < normalizedArgs.length; index += 1) {
    const arg = normalizedArgs[index];
    const next = normalizedArgs[index + 1];
    if (!arg) continue;
    if (arg === '--score-config-version' && next) {
      parsed.scoreConfigVersion = next;
      index += 1;
    } else if (arg === '--compare-score-config-version' && next) {
      parsed.compareScoreConfigVersion = next;
      index += 1;
    } else if ((arg === '--window' || arg === '--window-minutes') && next) {
      parsed.windowMinutes = parsePositiveInt(next, arg);
      index += 1;
    } else if ((arg === '--horizon' || arg === '--horizon-minutes') && next) {
      parsed.horizonsMinutes = parseIntList(next, arg);
      index += 1;
    } else if (arg === '--thresholds' && next) {
      parsed.thresholds = parseIntList(next, arg);
      index += 1;
    } else if (arg === '--from' && next) {
      parsed.from = parseIso(next, arg);
      index += 1;
    } else if (arg === '--to' && next) {
      parsed.to = parseIso(next, arg);
      index += 1;
    } else if (arg === '--side' && next) {
      parsed.side = parseSide(next);
      index += 1;
    } else if (arg === '--min-confidence' && next) {
      parsed.minConfidence = parseBoundedNumber(next, arg, 0, 100);
      index += 1;
    } else if (arg === '--min-abs-score' && next) {
      parsed.minAbsScore = parseBoundedNumber(next, arg, 0, 100);
      index += 1;
    } else if (arg === '--separation-threshold' && next) {
      parsed.separationThreshold = parseBoundedNumber(next, arg, 0, 100);
      index += 1;
    } else if (arg === '--exchange' && next) {
      parsed.exchange = next.toLowerCase();
      index += 1;
    } else if (arg === '--market' && next) {
      parsed.market = next.toLowerCase();
      index += 1;
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
  }

  return parsed;
}

function parsePositiveInt(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${label} must be a positive integer`);
  return parsed;
}

function parseIntList(value: string, label: string): number[] {
  const items = value.split(',').map((item) => parsePositiveInt(item.trim(), label));
  if (!items.length) throw new Error(`${label} must include at least one value`);
  return [...new Set(items)];
}

function parseBoundedNumber(value: string, label: string, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) throw new Error(`${label} must be between ${min} and ${max}`);
  return parsed;
}

function parseIso(value: string, label: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a valid ISO timestamp`);
  return new Date(parsed).toISOString();
}

function parseSide(value: string): BacktestSide {
  if (value === 'bull' || value === 'bear' || value === 'net') return value;
  throw new Error('--side must be bull, bear, or net');
}

function formatHorizon(minutes: number): string {
  if (minutes === 60) return '1h';
  if (minutes === 240) return '4h';
  if (minutes === 1440) return '24h';
  return `${minutes}m`;
}

function formatNumber(value: number | null): string {
  return value === null ? 'n/a' : value.toFixed(4);
}

function formatRate(value: number | null): string {
  return value === null ? 'n/a' : `${(value * 100).toFixed(2)}%`;
}

function loadEnvFiles(cwd = process.cwd()): void {
  const candidates = [resolve(cwd, '.env'), resolve(cwd, '../../.env')];
  for (const path of candidates) {
    if (existsSync(path)) loadDotenv({ path, override: false });
  }
}

if (isMainModule()) {
  loadEnvFiles();
  runBacktestCommand({ args: process.argv.slice(2) }).then((exitCode) => {
    process.exitCode = exitCode;
  });
}

function isMainModule(): boolean {
  const entrypoint = process.argv[1];
  return entrypoint ? import.meta.url === pathToFileURL(entrypoint).href : false;
}
