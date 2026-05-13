import type { MarketDataRepository } from '../db/marketDataRepository.js';
import type { AppLogger } from '../utils/logger.js';
import type { WorkerStatus } from './workerStatus.js';

interface ForwardReturnWorkerOptions {
  enabled: boolean;
  intervalMs: number;
  horizonsMinutes: number[];
  batchSize?: number;
  maxPriceSkewMs?: number;
  logger: AppLogger;
}

export class ForwardReturnWorker {
  private readonly runDurationsMs: number[] = [];
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private state: WorkerStatus['state'];
  private lastRunStartedAt: string | null = null;
  private lastRunCompletedAt: string | null = null;
  private lastSuccessAt: string | null = null;
  private lastFailureAt: string | null = null;
  private lastError: string | null = null;
  private processed = 0;
  private written = 0;
  private skipped = 0;
  private failed = 0;

  constructor(
    private readonly repository: MarketDataRepository,
    private readonly options: ForwardReturnWorkerOptions
  ) {
    this.state = options.enabled ? 'stopped' : 'disabled';
  }

  start(): void {
    if (!this.options.enabled || this.timer) return;
    this.state = 'running';
    this.timer = setInterval(() => {
      void this.computeDueNow('scheduled');
    }, this.options.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.state = this.options.enabled ? 'stopped' : 'disabled';
  }

  async computeDueNow(reason = 'manual'): Promise<{ seeded: number; scanned: number; ready: number; missing: number; failed: number }> {
    if (!this.options.enabled || this.running) return { seeded: 0, scanned: 0, ready: 0, missing: 0, failed: 0 };
    this.running = true;
    const startedAtMs = Date.now();
    this.lastRunStartedAt = new Date(startedAtMs).toISOString();

    try {
      const seeded = await this.repository.seedPendingForwardReturns(this.options.horizonsMinutes, this.options.batchSize ?? 500);
      const result = await this.repository.computeDueForwardReturns({
        now: new Date().toISOString(),
        horizonsMinutes: this.options.horizonsMinutes,
        batchSize: this.options.batchSize ?? 500,
        maxPriceSkewMs: this.options.maxPriceSkewMs ?? 120_000
      });
      const missing = result.missingBase + result.missingFuture;
      this.processed += result.scanned;
      this.written += result.ready;
      this.skipped += missing;
      this.failed += result.errors;
      this.lastRunCompletedAt = new Date().toISOString();
      this.recordRunDuration(Date.now() - startedAtMs);
      if (result.errors > 0) {
        this.state = 'degraded';
        this.lastFailureAt = this.lastRunCompletedAt;
        this.lastError = `${result.errors} forward return row(s) failed`;
      } else {
        this.state = 'running';
        this.lastSuccessAt = this.lastRunCompletedAt;
        this.lastError = null;
      }
      return { seeded, scanned: result.scanned, ready: result.ready, missing, failed: result.errors };
    } catch (error) {
      this.failed += 1;
      this.state = 'degraded';
      this.lastFailureAt = new Date().toISOString();
      this.lastRunCompletedAt = this.lastFailureAt;
      this.lastError = error instanceof Error ? error.message : String(error);
      this.options.logger.warn({ error: this.lastError, reason }, 'Forward return worker failed');
      return { seeded: 0, scanned: 0, ready: 0, missing: 0, failed: 1 };
    } finally {
      this.running = false;
    }
  }

  getStatus(): WorkerStatus {
    return {
      enabled: this.options.enabled,
      state: this.state,
      running: this.running,
      activeCoinCount: 0,
      intervalMs: this.options.intervalMs,
      lastRunStartedAt: this.lastRunStartedAt,
      lastRunCompletedAt: this.lastRunCompletedAt,
      lastSuccessAt: this.lastSuccessAt,
      lastFailureAt: this.lastFailureAt,
      lastError: this.lastError,
      processed: this.processed,
      written: this.written,
      skipped: this.skipped,
      failed: this.failed,
      averageRunMs: this.averageRunMs()
    };
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
