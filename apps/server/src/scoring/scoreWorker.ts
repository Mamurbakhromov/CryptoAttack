import type { AppConfig } from '../config.js';
import type { ScoreRepository } from '../db/scoreRepository.js';
import type { NormalizedEvent } from '../events/types.js';
import type { AppLogger } from '../utils/logger.js';
import { defaultScoreConfig, scoreConfigForVersion } from './defaultScoreConfig.js';
import { calculateScores } from './scoreEngine.js';
import type { ScoreConfig } from './types.js';

export interface ScoreWorkerStatus {
  enabled: boolean;
  state: 'disabled' | 'running' | 'degraded' | 'stopped';
  running: boolean;
  intervalMs: number;
  scoreVersion: string;
  windowsMinutes: number[];
  queueDepth: number;
  pendingCoinCount: number;
  lastTriggeredAt: string | null;
  lastTriggerReason: string | null;
  lastRunStartedAt: string | null;
  lastRunCompletedAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
  processed: number;
  written: number;
  skipped: number;
  failed: number;
  writtenEvidence: number;
  latestScoreTs: string | null;
  averageRunMs: number | null;
}

export interface ScoreUpdateSseItem {
  coin: string;
  windowMinutes: number;
  ts: string;
  bullScore: number;
  bearScore: number;
  netScore: number;
  confidenceScore: number;
  dominantSignal: string | null;
  marketRegime: 'bullish' | 'bearish' | 'conflicted' | 'neutral' | 'thin_data';
  previousNetScore: number | null;
  netScoreDelta: number | null;
  eventCount: number;
  evidenceCount: number;
  scoreHash: string;
  evidenceHash: string;
}

export interface ScoreUpdateSseEvent {
  generatedAt: string;
  reason: string;
  scoreVersion: string;
  asOf: string;
  processed: number;
  written: number;
  skipped: number;
  failed: number;
  evidenceWritten: number;
  scores: ScoreUpdateSseItem[];
}

interface ScoreWorkerOptions {
  enabled: boolean;
  intervalMs: number;
  debounceMs: number;
  maxQueueDepth: number;
  batchCoins: number;
  windowsMinutes: number[];
  config: ScoreConfig;
  logger: AppLogger;
  onUpdate?: (event: ScoreUpdateSseEvent) => void;
  now?: () => Date;
}

export class ScoreWorker {
  private readonly pendingCoins = new Set<string>();
  private readonly runDurationsMs: number[] = [];
  private timer: NodeJS.Timeout | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private running = false;
  private state: ScoreWorkerStatus['state'];
  private lastTriggeredAt: string | null = null;
  private lastTriggerReason: string | null = null;
  private lastRunStartedAt: string | null = null;
  private lastRunCompletedAt: string | null = null;
  private lastSuccessAt: string | null = null;
  private lastFailureAt: string | null = null;
  private lastError: string | null = null;
  private processed = 0;
  private written = 0;
  private skipped = 0;
  private failed = 0;
  private writtenEvidence = 0;
  private latestScoreTs: string | null = null;

  constructor(
    private readonly repository: ScoreRepository,
    private readonly options: ScoreWorkerOptions
  ) {
    this.state = options.enabled ? 'stopped' : 'disabled';
  }

  start(): void {
    if (!this.options.enabled || this.timer) return;
    this.state = 'running';
    void this.repository.ensureScoreConfig(this.options.config).catch((error) => {
      this.state = 'degraded';
      this.lastError = error instanceof Error ? error.message : String(error);
      this.options.logger.warn({ error: this.lastError }, 'Score config initialization failed');
    });
    this.timer = setInterval(() => {
      void this.recomputeNow({ reason: 'scheduled' });
    }, this.options.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.timer = null;
    this.debounceTimer = null;
    this.state = this.options.enabled ? 'stopped' : 'disabled';
  }

  enqueueEvents(events: NormalizedEvent[], reason = 'ingestion'): boolean {
    if (!this.options.enabled) return false;
    let accepted = false;
    for (const coin of extractRelevantCoins(events)) {
      if (this.pendingCoins.size >= this.options.maxQueueDepth && !this.pendingCoins.has(coin)) continue;
      this.pendingCoins.add(coin);
      accepted = true;
    }
    if (accepted) {
      this.lastTriggeredAt = this.nowIso();
      this.lastTriggerReason = reason;
      this.scheduleDebouncedRun();
    }
    return accepted;
  }

  async recomputeNow(input: { reason?: string; coins?: string[]; from?: string; to?: string } = {}): Promise<{ processed: number; written: number; skipped: number; failed: number; evidence: number }> {
    if (!this.options.enabled || this.running) return { processed: 0, written: 0, skipped: 0, failed: 0, evidence: 0 };
    this.running = true;
    const startedAt = this.now();
    this.lastRunStartedAt = startedAt.toISOString();
    try {
      await this.repository.ensureScoreConfig(this.options.config);
      const asOf = input.to ?? startedAt.toISOString();
      const maxAgeMinutes = Math.max(...this.options.config.windows.map((window) => window.maxAgeMinutes));
      const from = input.from ?? new Date(Date.parse(asOf) - maxAgeMinutes * 60_000).toISOString();
      const queuedCoins = input.coins?.map((coin) => coin.toUpperCase()) ?? this.takePendingCoins();
      const coins = queuedCoins.length ? queuedCoins : await this.repository.getCandidateCoins(from, this.options.batchCoins);
      const limitedCoins = [...new Set(coins)].slice(0, this.options.batchCoins);
      if (!limitedCoins.length) {
        this.lastRunCompletedAt = this.nowIso();
        this.lastSuccessAt = this.lastRunCompletedAt;
        this.running = false;
        return { processed: 0, written: 0, skipped: 0, failed: 0, evidence: 0 };
      }

      const sourceRows = await this.repository.getScoreSourceRows({
        coins: limitedCoins,
        from,
        to: asOf,
        feedKeys: [...new Set(this.options.config.rules.flatMap((rule) => rule.feedKeys))]
      });
      const results = calculateScores({
        config: this.options.config,
        asOf,
        coins: limitedCoins,
        sourceRows,
        windowsMinutes: this.options.windowsMinutes
      });
      const writeResult = await this.repository.writeScores(results, this.options.config);
      this.processed += results.length;
      this.written += writeResult.snapshotsWritten;
      this.skipped += writeResult.skippedSnapshots;
      this.writtenEvidence += writeResult.evidenceWritten;
      this.latestScoreTs = asOf;
      this.lastRunCompletedAt = this.nowIso();
      this.lastSuccessAt = this.lastRunCompletedAt;
      this.lastError = null;
      this.state = 'running';
      this.recordRunDuration(Date.now() - startedAt.getTime());
      this.options.onUpdate?.({
        generatedAt: this.lastRunCompletedAt,
        reason: input.reason ?? 'manual',
        scoreVersion: this.options.config.version,
        asOf,
        processed: results.length,
        written: writeResult.snapshotsWritten,
        skipped: writeResult.skippedSnapshots,
        failed: 0,
        evidenceWritten: writeResult.evidenceWritten,
        scores: results.map(scoreResultToSseItem)
      });
      return { processed: results.length, written: writeResult.snapshotsWritten, skipped: writeResult.skippedSnapshots, failed: 0, evidence: writeResult.evidenceWritten };
    } catch (error) {
      this.failed += 1;
      this.state = 'degraded';
      this.lastFailureAt = this.nowIso();
      this.lastRunCompletedAt = this.lastFailureAt;
      this.lastError = error instanceof Error ? error.message : String(error);
      this.options.logger.warn({ error: this.lastError, reason: input.reason }, 'Score recompute failed');
      return { processed: 0, written: 0, skipped: 0, failed: 1, evidence: 0 };
    } finally {
      this.running = false;
    }
  }

  getStatus(): ScoreWorkerStatus {
    return {
      enabled: this.options.enabled,
      state: this.state,
      running: this.running,
      intervalMs: this.options.intervalMs,
      scoreVersion: this.options.config.version,
      windowsMinutes: this.options.windowsMinutes,
      queueDepth: this.pendingCoins.size,
      pendingCoinCount: this.pendingCoins.size,
      lastTriggeredAt: this.lastTriggeredAt,
      lastTriggerReason: this.lastTriggerReason,
      lastRunStartedAt: this.lastRunStartedAt,
      lastRunCompletedAt: this.lastRunCompletedAt,
      lastSuccessAt: this.lastSuccessAt,
      lastFailureAt: this.lastFailureAt,
      lastError: this.lastError,
      processed: this.processed,
      written: this.written,
      skipped: this.skipped,
      failed: this.failed,
      writtenEvidence: this.writtenEvidence,
      latestScoreTs: this.latestScoreTs,
      averageRunMs: this.averageRunMs()
    };
  }

  private scheduleDebouncedRun(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.recomputeNow({ reason: 'ingestion' });
    }, this.options.debounceMs);
    this.debounceTimer.unref();
  }

  private takePendingCoins(): string[] {
    const coins = [...this.pendingCoins];
    this.pendingCoins.clear();
    return coins;
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private nowIso(): string {
    return this.now().toISOString();
  }

  private recordRunDuration(durationMs: number): void {
    this.runDurationsMs.push(durationMs);
    if (this.runDurationsMs.length > 100) this.runDurationsMs.shift();
  }

  private averageRunMs(): number | null {
    if (!this.runDurationsMs.length) return null;
    return Math.round(this.runDurationsMs.reduce((sum, value) => sum + value, 0) / this.runDurationsMs.length);
  }
}

function scoreResultToSseItem(result: ReturnType<typeof calculateScores>[number]): ScoreUpdateSseItem {
  return {
    coin: result.coin,
    windowMinutes: result.windowMinutes,
    ts: result.ts,
    bullScore: result.bullScore,
    bearScore: result.bearScore,
    netScore: result.netScore,
    confidenceScore: result.confidenceScore,
    dominantSignal: result.dominantSignal,
    marketRegime: result.marketRegime,
    previousNetScore: result.previousNetScore ?? null,
    netScoreDelta: result.netScoreDelta ?? null,
    eventCount: result.eventCount,
    evidenceCount: result.evidenceCount,
    scoreHash: result.scoreHash,
    evidenceHash: result.evidenceHash
  };
}

export function scoreWorkerOptionsFromConfig(config: AppConfig, logger: AppLogger): ScoreWorkerOptions {
  return {
    enabled: config.scores.enabled,
    intervalMs: config.scores.recalculationIntervalMs,
    debounceMs: config.scores.recomputeDebounceMs,
    maxQueueDepth: config.scores.maxQueueDepth,
    batchCoins: config.scores.batchCoins,
    windowsMinutes: config.scores.windowsMinutes,
    config: scoreConfigForVersion(config.scores.version),
    logger
  };
}

export function disabledScoreWorkerStatus(config: AppConfig): ScoreWorkerStatus {
  return {
    enabled: false,
    state: 'disabled',
    running: false,
    intervalMs: config.scores.recalculationIntervalMs,
    scoreVersion: config.scores.version || defaultScoreConfig.version,
    windowsMinutes: config.scores.windowsMinutes,
    queueDepth: 0,
    pendingCoinCount: 0,
    lastTriggeredAt: null,
    lastTriggerReason: null,
    lastRunStartedAt: null,
    lastRunCompletedAt: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastError: null,
    processed: 0,
    written: 0,
    skipped: 0,
    failed: 0,
    writtenEvidence: 0,
    latestScoreTs: null,
    averageRunMs: null
  };
}

function extractRelevantCoins(events: NormalizedEvent[]): string[] {
  const coins = new Set<string>();
  for (const event of events) {
    if (event.feedKey === 'raw_unclassified') continue;
    for (const coin of event.coins) addCoin(coins, coin);
    for (const entry of event.entries) addCoin(coins, entry.coin);
  }
  return [...coins];
}

function addCoin(coins: Set<string>, value: string | null | undefined): void {
  const coin = value?.trim().toUpperCase();
  if (coin && /^[A-Z0-9]{1,30}$/u.test(coin)) coins.add(coin);
}
