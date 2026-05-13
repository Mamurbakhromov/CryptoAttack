import type { MarketDataRepository } from '../db/marketDataRepository.js';
import type { ExchangeSymbolCache } from '../exchanges/symbolCache.js';
import type { NormalizedEvent } from '../events/types.js';
import type { AppLogger } from '../utils/logger.js';
import { buildPriceTargets, fetchPriceTick, type PriceFetchTarget, type PriceProviderOptions } from './priceProviders.js';
import type { WorkerStatus } from './workerStatus.js';

interface ActiveCoinState {
  lastSeenAtMs: number;
  count: number;
}

interface PriceCollectionServiceOptions {
  enabled: boolean;
  intervalMs: number;
  activeCoinTtlMs: number;
  timeoutMs: number;
  maxTargets?: number;
  fetchImpl?: typeof fetch;
  logger: AppLogger;
}

export class PriceCollectionService {
  private readonly activeCoins = new Map<string, ActiveCoinState>();
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
    private readonly symbolCache: ExchangeSymbolCache,
    private readonly options: PriceCollectionServiceOptions
  ) {
    this.state = options.enabled ? 'stopped' : 'disabled';
  }

  start(): void {
    if (!this.options.enabled || this.timer) return;
    this.state = 'running';
    this.timer = setInterval(() => {
      void this.collectNow('scheduled');
    }, this.options.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.state = this.options.enabled ? 'stopped' : 'disabled';
  }

  markActiveCoins(events: NormalizedEvent[]): void {
    const now = Date.now();
    for (const coin of extractCoins(events)) {
      const existing = this.activeCoins.get(coin);
      this.activeCoins.set(coin, {
        lastSeenAtMs: now,
        count: (existing?.count ?? 0) + 1
      });
    }
    this.pruneActiveCoins(now);
  }

  async collectNow(reason = 'manual'): Promise<{ processed: number; written: number; skipped: number; failed: number }> {
    if (!this.options.enabled || this.running) return { processed: 0, written: 0, skipped: 0, failed: 0 };
    this.running = true;
    const startedAtMs = Date.now();
    this.lastRunStartedAt = new Date(startedAtMs).toISOString();

    try {
      const activeCoins = await this.resolveActiveCoins();
      const targets = this.resolveTargets(activeCoins);
      let written = 0;
      let skipped = 0;
      let failed = 0;

      for (const target of targets) {
        try {
          const tick = await fetchPriceTick(target, this.priceProviderOptions());
          if (!tick) {
            skipped += 1;
            continue;
          }
          const result = await this.repository.upsertPriceTicks([tick]);
          written += result.written;
        } catch (error) {
          failed += 1;
          this.options.logger.warn({ error: error instanceof Error ? error.message : String(error), target, reason }, 'Price collection target failed');
        }
      }

      this.processed += targets.length;
      this.written += written;
      this.skipped += skipped;
      this.failed += failed;
      this.lastRunCompletedAt = new Date().toISOString();
      this.recordRunDuration(Date.now() - startedAtMs);
      if (failed > 0) {
        this.state = 'degraded';
        this.lastFailureAt = this.lastRunCompletedAt;
        this.lastError = `${failed} price target(s) failed`;
      } else {
        this.state = 'running';
        this.lastSuccessAt = this.lastRunCompletedAt;
        this.lastError = null;
      }
      return { processed: targets.length, written, skipped, failed };
    } catch (error) {
      this.failed += 1;
      this.state = 'degraded';
      this.lastFailureAt = new Date().toISOString();
      this.lastRunCompletedAt = this.lastFailureAt;
      this.lastError = error instanceof Error ? error.message : String(error);
      return { processed: 0, written: 0, skipped: 0, failed: 1 };
    } finally {
      this.running = false;
    }
  }

  getStatus(): WorkerStatus {
    return {
      enabled: this.options.enabled,
      state: this.state,
      running: this.running,
      activeCoinCount: this.activeCoins.size,
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

  private async resolveActiveCoins(): Promise<string[]> {
    const now = Date.now();
    this.pruneActiveCoins(now);
    const memoryCoins = [...this.activeCoins.entries()]
      .sort((a, b) => b[1].lastSeenAtMs - a[1].lastSeenAtMs || b[1].count - a[1].count)
      .map(([coin]) => coin);
    const since = new Date(now - this.options.activeCoinTtlMs).toISOString();
    const [recentCoins, scoredCoins] = await Promise.all([
      this.repository.getRecentlyActiveCoins(since, this.options.maxTargets ?? 100).catch(() => []),
      this.repository.getTopScoredCoins(25).catch(() => [])
    ]);
    return [...new Set([...memoryCoins, ...scoredCoins, ...recentCoins])].slice(0, this.options.maxTargets ?? 100);
  }

  private resolveTargets(activeCoins: string[]): PriceFetchTarget[] {
    const response = this.symbolCache.getSymbols({ status: 'active', limit: 10_000, offset: 0 });
    return buildPriceTargets(response.symbols, activeCoins, this.options.maxTargets ?? 100);
  }

  private pruneActiveCoins(now: number): void {
    for (const [coin, state] of this.activeCoins) {
      if (state.lastSeenAtMs + this.options.activeCoinTtlMs < now) this.activeCoins.delete(coin);
    }
  }

  private priceProviderOptions(): PriceProviderOptions {
    return {
      timeoutMs: this.options.timeoutMs,
      ...(this.options.fetchImpl ? { fetchImpl: this.options.fetchImpl } : {})
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

function extractCoins(events: NormalizedEvent[]): string[] {
  const coins = new Set<string>();
  for (const event of events) {
    for (const coin of event.coins) addCoin(coins, coin);
    for (const entry of event.entries) addCoin(coins, entry.coin);
  }
  return [...coins];
}

function addCoin(coins: Set<string>, coin: string | null | undefined): void {
  const normalized = coin?.trim().toUpperCase();
  if (normalized && /^[A-Z0-9]{1,30}$/u.test(normalized)) coins.add(normalized);
}
