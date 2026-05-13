import { EventEmitter } from 'node:events';

import { feedKeys, type ApiStatus, type ConnectionStatus, type DashboardSnapshot, type EventCounters, type FeedKey, type FeedSnapshot, type LatencyStats, type NormalizedEvent } from './types.js';

interface EventStoreOptions {
  bufferSize: number;
  dedupeTtlMs: number;
  mockMode: boolean;
  authEnabled: boolean;
}

export class EventStore extends EventEmitter {
  private readonly buffers = new Map<FeedKey, NormalizedEvent[]>();
  private readonly dedupe = new Map<string, number>();
  private readonly counters: EventCounters;
  private readonly socketStatuses = new Map<string, ConnectionStatus>();
  private readonly lastEventByCategory: Record<string, string> = {};
  private readonly latencySamples: number[] = [];
  private lastEventTime: string | null = null;

  constructor(private readonly options: EventStoreOptions) {
    super();
    this.counters = {
      received: 0,
      stored: 0,
      deduplicated: 0,
      byFeed: createFeedCounter()
    };

    for (const feedKey of feedKeys) {
      this.buffers.set(feedKey, []);
    }
  }

  addEvents(events: NormalizedEvent[]): NormalizedEvent[] {
    const stored: NormalizedEvent[] = [];
    for (const event of events) {
      if (this.addEvent(event)) stored.push(event);
    }
    return stored;
  }

  addEvent(event: NormalizedEvent): boolean {
    this.counters.received += 1;
    const now = Date.now();
    this.cleanupDedupe(now);

    const existingExpiresAt = this.dedupe.get(event.id);
    if (existingExpiresAt !== undefined && existingExpiresAt > now) {
      this.counters.deduplicated += 1;
      return false;
    }

    this.dedupe.set(event.id, now + this.options.dedupeTtlMs);

    const buffer = this.buffers.get(event.feedKey) ?? [];
    buffer.unshift(event);
    if (buffer.length > this.options.bufferSize) buffer.length = this.options.bufferSize;
    this.buffers.set(event.feedKey, buffer);

    this.counters.stored += 1;
    this.counters.byFeed[event.feedKey] += 1;
    this.lastEventTime = event.receivedAt;
    this.lastEventByCategory[`${event.chapter}/${event.category}`] = event.receivedAt;

    if (event.latencyMs !== null) {
      this.latencySamples.push(event.latencyMs);
      if (this.latencySamples.length > 100) this.latencySamples.shift();
    }

    this.emit('event', event);
    return true;
  }

  setConnectionStatus(status: ConnectionStatus): void {
    this.socketStatuses.set(status.name, cloneConnectionStatus(status));
    this.emit('status', this.getStatus());
  }

  getSnapshot(): DashboardSnapshot {
    const feeds = {} as Record<FeedKey, FeedSnapshot>;
    for (const feedKey of feedKeys) {
      const events = [...(this.buffers.get(feedKey) ?? [])];
      feeds[feedKey] = {
        events,
        latest: events[0] ?? null
      };
    }

    return {
      generatedAt: new Date().toISOString(),
      feeds,
      counters: this.getCounters(),
      lastEventTime: this.lastEventTime,
      latency: this.getLatencyStats()
    };
  }

  getStatus(): ApiStatus {
    return {
      generatedAt: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      mockMode: this.options.mockMode,
      authEnabled: this.options.authEnabled,
      sockets: Object.fromEntries([...this.socketStatuses.entries()].map(([name, status]) => [name, cloneConnectionStatus(status)])),
      counters: this.getCounters(),
      lastEventTime: this.lastEventTime,
      lastEventByCategory: { ...this.lastEventByCategory },
      latency: this.getLatencyStats()
    };
  }

  getEvents(feedKey: FeedKey | undefined, limit: number): NormalizedEvent[] {
    const boundedLimit = Math.max(1, Math.min(limit, this.options.bufferSize));
    if (feedKey) return [...(this.buffers.get(feedKey) ?? [])].slice(0, boundedLimit);

    return [...this.buffers.values()]
      .flat()
      .sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt))
      .slice(0, boundedLimit);
  }

  getStats() {
    return {
      counters: this.getCounters(),
      lastEventTime: this.lastEventTime,
      lastEventByCategory: { ...this.lastEventByCategory },
      latency: this.getLatencyStats(),
      bufferSizes: Object.fromEntries(feedKeys.map((feedKey) => [feedKey, this.buffers.get(feedKey)?.length ?? 0])) as Record<FeedKey, number>,
      dedupeSize: this.dedupe.size
    };
  }

  private getCounters(): EventCounters {
    return {
      received: this.counters.received,
      stored: this.counters.stored,
      deduplicated: this.counters.deduplicated,
      byFeed: { ...this.counters.byFeed }
    };
  }

  private getLatencyStats(): LatencyStats {
    const latestMs = this.latencySamples.at(-1) ?? null;
    const averageMs = this.latencySamples.length
      ? Math.round(this.latencySamples.reduce((sum, value) => sum + value, 0) / this.latencySamples.length)
      : null;
    return {
      latestMs,
      averageMs,
      samples: this.latencySamples.length
    };
  }

  private cleanupDedupe(now: number): void {
    if (this.dedupe.size <= this.options.bufferSize * 20) return;

    for (const [id, expiresAt] of this.dedupe) {
      if (expiresAt <= now) this.dedupe.delete(id);
    }
  }
}

function createFeedCounter(): Record<FeedKey, number> {
  const counters = {} as Record<FeedKey, number>;
  for (const feedKey of feedKeys) counters[feedKey] = 0;
  return counters;
}

function cloneConnectionStatus(status: ConnectionStatus): ConnectionStatus {
  return {
    ...status,
    subscriptions: status.subscriptions.map((subscription) => ({
      ...subscription,
      payloadPreview: subscription.payloadPreview ? { ...subscription.payloadPreview } : null
    }))
  };
}
