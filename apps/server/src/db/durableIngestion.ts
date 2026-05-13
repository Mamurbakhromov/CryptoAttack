import type { AppConfig } from '../config.js';
import type { NormalizedEvent } from '../events/types.js';
import type { AppLogger } from '../utils/logger.js';
import type { EventIngestionRepository, RawEventIngestInput, RawEventIngestResult } from './eventRepository.js';

export interface DurableIngestionJob {
  raw: unknown;
  endpoint: string;
  receivedAt: string;
  normalizedEvents: NormalizedEvent[];
}

export interface DurableIngestionStatus {
  enabled: boolean;
  connected: boolean | null;
  state: 'disabled' | 'running' | 'draining' | 'stopped' | 'degraded';
  queueDepth: number;
  maxQueueDepth: number;
  inFlight: number;
  accepted: number;
  writtenJobs: number;
  writtenEvents: number;
  writtenEntries: number;
  dropped: number;
  failed: number;
  retried: number;
  lastAcceptedAt: string | null;
  lastWriteAt: string | null;
  lastFailureAt: string | null;
  lastDropAt: string | null;
  lastError: string | null;
  oldestQueuedAt: string | null;
  averageWriteMs: number | null;
}

interface QueueItem extends DurableIngestionJob {
  queuedAt: string;
}

interface DurableIngestionOptions {
  maxQueueDepth: number;
  maxRetries: number;
  retryBaseMs: number;
  retryMaxMs: number;
  drainTimeoutMs: number;
  onWritten?: (job: DurableIngestionJob, result: RawEventIngestResult) => void;
  onStatus?: (status: DurableIngestionStatus) => void;
}

export class DurableIngestionQueue {
  private readonly queue: QueueItem[] = [];
  private processing = false;
  private inFlight = 0;
  private state: DurableIngestionStatus['state'] = 'running';
  private connected = true;
  private accepted = 0;
  private writtenJobs = 0;
  private writtenEvents = 0;
  private writtenEntries = 0;
  private dropped = 0;
  private failed = 0;
  private retried = 0;
  private lastAcceptedAt: string | null = null;
  private lastWriteAt: string | null = null;
  private lastFailureAt: string | null = null;
  private lastDropAt: string | null = null;
  private lastError: string | null = null;
  private readonly writeDurationsMs: number[] = [];

  constructor(
    private readonly repository: EventIngestionRepository,
    private readonly logger: Pick<AppLogger, 'warn'>,
    private readonly options: DurableIngestionOptions
  ) {}

  enqueue(job: DurableIngestionJob): boolean {
    if (this.state === 'draining' || this.state === 'stopped') return false;
    if (this.queue.length >= this.options.maxQueueDepth) {
      this.dropped += 1;
      this.lastDropAt = new Date().toISOString();
      this.lastError = 'Durable ingestion queue full';
      this.state = 'degraded';
      this.emitStatus();
      return false;
    }

    const queuedAt = new Date().toISOString();
    this.queue.push({ ...job, queuedAt });
    this.accepted += 1;
    this.lastAcceptedAt = queuedAt;
    this.scheduleProcessing();
    this.emitStatus();
    return true;
  }

  getStatus(): DurableIngestionStatus {
    return {
      enabled: true,
      connected: this.connected,
      state: this.state,
      queueDepth: this.queue.length,
      maxQueueDepth: this.options.maxQueueDepth,
      inFlight: this.inFlight,
      accepted: this.accepted,
      writtenJobs: this.writtenJobs,
      writtenEvents: this.writtenEvents,
      writtenEntries: this.writtenEntries,
      dropped: this.dropped,
      failed: this.failed,
      retried: this.retried,
      lastAcceptedAt: this.lastAcceptedAt,
      lastWriteAt: this.lastWriteAt,
      lastFailureAt: this.lastFailureAt,
      lastDropAt: this.lastDropAt,
      lastError: this.lastError,
      oldestQueuedAt: this.queue[0]?.queuedAt ?? null,
      averageWriteMs: this.averageWriteMs()
    };
  }

  async stop(drainTimeoutMs = this.options.drainTimeoutMs): Promise<void> {
    if (this.state === 'stopped') return;
    this.state = 'draining';
    this.scheduleProcessing();
    const deadline = Date.now() + drainTimeoutMs;
    while ((this.queue.length > 0 || this.inFlight > 0 || this.processing) && Date.now() < deadline) {
      await sleep(25);
    }

    if (this.queue.length > 0) {
      this.dropped += this.queue.length;
      this.queue.length = 0;
      this.lastDropAt = new Date().toISOString();
      this.lastError = 'Durable ingestion queue dropped during shutdown';
    }

    this.state = 'stopped';
    this.emitStatus();
  }

  private scheduleProcessing(): void {
    if (this.processing) return;
    this.processing = true;
    void this.processQueue();
  }

  private async processQueue(): Promise<void> {
    try {
      while (this.queue.length > 0) {
        const item = this.queue.shift();
        if (!item) continue;
        this.inFlight = 1;
        const startedAt = Date.now();
        try {
          const result = await this.writeWithRetry(item);
          this.connected = true;
          this.writtenJobs += 1;
          this.writtenEvents += result.normalizedEventCount;
          this.writtenEntries += result.entryCount;
          this.lastWriteAt = new Date().toISOString();
          this.recordWriteDuration(Date.now() - startedAt);
          if (this.state === 'degraded') this.state = 'running';
          this.options.onWritten?.(item, result);
          this.emitStatus();
        } catch (error) {
          this.connected = false;
          this.failed += 1;
          this.lastFailureAt = new Date().toISOString();
          this.lastError = errorMessage(error);
          this.state = 'degraded';
          this.emitStatus();
          await this.recordFailure(item, error);
        } finally {
          this.inFlight = 0;
        }
      }
    } finally {
      this.processing = false;
      if (this.queue.length > 0 && this.state !== 'stopped') this.scheduleProcessing();
    }
  }

  private async writeWithRetry(item: QueueItem): Promise<RawEventIngestResult> {
    let attempt = 0;
    for (;;) {
      try {
        return await this.repository.ingestRawEvent(toRepositoryInput(item));
      } catch (error) {
        if (attempt >= this.options.maxRetries || !isTransientDatabaseError(error)) throw error;
        attempt += 1;
        this.retried += 1;
        await sleep(retryDelayMs(attempt, this.options));
      }
    }
  }

  private async recordFailure(item: QueueItem, error: unknown): Promise<void> {
    try {
      await this.repository.recordIngestionError({
        stage: 'durable_ingestion_queue',
        errorMessage: errorMessage(error),
        retryCount: this.options.maxRetries,
        errorCode: databaseErrorCode(error),
        payload: {
          endpoint: item.endpoint,
          receivedAt: item.receivedAt,
          normalizedEventIds: item.normalizedEvents.map((event) => event.id),
          feedKeys: item.normalizedEvents.map((event) => event.feedKey)
        }
      });
    } catch (recordError) {
      this.logger.warn({ error: errorMessage(recordError) }, 'Failed to record durable ingestion error');
    }
  }

  private recordWriteDuration(durationMs: number): void {
    this.writeDurationsMs.push(durationMs);
    if (this.writeDurationsMs.length > 100) this.writeDurationsMs.shift();
  }

  private averageWriteMs(): number | null {
    if (!this.writeDurationsMs.length) return null;
    return Math.round(this.writeDurationsMs.reduce((sum, value) => sum + value, 0) / this.writeDurationsMs.length);
  }

  private emitStatus(): void {
    this.options.onStatus?.(this.getStatus());
  }
}

export function disabledDurableIngestionStatus(): DurableIngestionStatus {
  return {
    enabled: false,
    connected: null,
    state: 'disabled',
    queueDepth: 0,
    maxQueueDepth: 0,
    inFlight: 0,
    accepted: 0,
    writtenJobs: 0,
    writtenEvents: 0,
    writtenEntries: 0,
    dropped: 0,
    failed: 0,
    retried: 0,
    lastAcceptedAt: null,
    lastWriteAt: null,
    lastFailureAt: null,
    lastDropAt: null,
    lastError: null,
    oldestQueuedAt: null,
    averageWriteMs: null
  };
}

export function durableIngestionOptionsFromConfig(config: AppConfig): DurableIngestionOptions {
  return {
    maxQueueDepth: config.database.writeQueueMax,
    maxRetries: config.database.writeMaxRetries,
    retryBaseMs: config.database.writeRetryBaseMs,
    retryMaxMs: config.database.writeRetryMaxMs,
    drainTimeoutMs: config.database.writeDrainTimeoutMs
  };
}

function toRepositoryInput(item: QueueItem): RawEventIngestInput {
  return {
    raw: item.raw,
    endpoint: item.endpoint,
    receivedAt: item.receivedAt,
    normalizedEvents: item.normalizedEvents
  };
}

function isTransientDatabaseError(error: unknown): boolean {
  const code = databaseErrorCode(error);
  if (code && ['40001', '40P01', '53300', '53400', '55P03', '57P01', '57P02', '57P03'].includes(code)) return true;
  const message = errorMessage(error).toLowerCase();
  return ['econnreset', 'etimedout', 'enotfound', 'connection terminated', 'timeout'].some((needle) => message.includes(needle));
}

function retryDelayMs(attempt: number, options: DurableIngestionOptions): number {
  const exponential = options.retryBaseMs * 2 ** Math.max(0, attempt - 1);
  return Math.min(options.retryMaxMs, exponential);
}

function databaseErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('code' in error)) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
