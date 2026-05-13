import { afterEach, describe, expect, it, vi } from 'vitest';

import { EventStore } from '../src/events/eventStore.js';
import type { FeedKey, NormalizedEvent } from '../src/events/types.js';

describe('EventStore', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('deduplicates normalized event ids', () => {
    const store = createStore();
    const event = makeEvent('same-id', 'listings');

    expect(store.addEvent(event)).toBe(true);
    expect(store.addEvent(event)).toBe(false);

    const snapshot = store.getSnapshot();
    expect(snapshot.feeds.listings.events).toHaveLength(1);
    expect(snapshot.counters.stored).toBe(1);
    expect(snapshot.counters.deduplicated).toBe(1);
  });

  it('keeps a bounded ring buffer per feed', () => {
    const store = new EventStore({ bufferSize: 2, dedupeTtlMs: 60_000, mockMode: true, authEnabled: false });
    store.addEvent(makeEvent('one', 'top_oi_gainers_60m'));
    store.addEvent(makeEvent('two', 'top_oi_gainers_60m'));
    store.addEvent(makeEvent('three', 'top_oi_gainers_60m'));

    const events = store.getSnapshot().feeds.top_oi_gainers_60m.events;
    expect(events.map((event) => event.id)).toEqual(['three', 'two']);
  });

  it('returns snapshot, events, and stats for recent store state', () => {
    const store = createStore();
    const listing = makeEvent('listing-one', 'listings', '2026-01-01T00:00:00.000Z');
    const alert = makeEvent('alert-one', 'top_oi_gainers_60m', '2026-01-01T00:00:02.000Z');

    store.addEvent(listing);
    store.addEvent(alert);

    const snapshot = store.getSnapshot();
    expect(snapshot.feeds.listings.latest?.id).toBe('listing-one');
    expect(snapshot.feeds.top_oi_gainers_60m.latest?.id).toBe('alert-one');
    expect(snapshot.lastEventTime).toBe(alert.receivedAt);
    expect(snapshot.counters.byFeed.listings).toBe(1);
    expect(snapshot.counters.byFeed.top_oi_gainers_60m).toBe(1);

    expect(store.getEvents(undefined, 10).map((event) => event.id)).toEqual(['alert-one', 'listing-one']);

    const stats = store.getStats();
    expect(stats.lastEventTime).toBe(alert.receivedAt);
    expect(stats.bufferSizes.listings).toBe(1);
    expect(stats.bufferSizes.top_oi_gainers_60m).toBe(1);
    expect(stats.dedupeSize).toBe(2);
  });

  it('stores oi_alerts in their own feed buffer and counters', () => {
    const store = createStore();
    const event = makeEvent('oi-alert-one', 'oi_alerts');

    expect(store.addEvent(event)).toBe(true);

    const snapshot = store.getSnapshot();
    expect(snapshot.feeds.oi_alerts.latest?.id).toBe('oi-alert-one');
    expect(snapshot.counters.byFeed.oi_alerts).toBe(1);
  });

  it('allows the same id again after dedupe TTL expires', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    const store = new EventStore({ bufferSize: 10, dedupeTtlMs: 100, mockMode: true, authEnabled: false });
    const event = makeEvent('ttl-id', 'listings');

    expect(store.addEvent(event)).toBe(true);
    expect(store.addEvent(event)).toBe(false);

    vi.advanceTimersByTime(101);

    expect(store.addEvent(event)).toBe(true);
    expect(store.getSnapshot().feeds.listings.events).toHaveLength(2);
    expect(store.getStats().counters).toMatchObject({
      received: 3,
      stored: 2,
      deduplicated: 1
    });
  });

  it('does not throw when storing many events', () => {
    const store = new EventStore({ bufferSize: 25, dedupeTtlMs: 60_000, mockMode: true, authEnabled: false });

    expect(() => {
      for (let index = 0; index < 1_000; index += 1) {
        store.addEvent(makeEvent(`bulk-${index}`, index % 2 === 0 ? 'listings' : 'top_oi_gainers_60m', `2026-01-01T00:00:${String(index % 60).padStart(2, '0')}.000Z`));
      }
    }).not.toThrow();

    const snapshot = store.getSnapshot();
    expect(snapshot.counters.received).toBe(1_000);
    expect(snapshot.counters.stored).toBe(1_000);
    expect(snapshot.feeds.listings.events).toHaveLength(25);
    expect(snapshot.feeds.top_oi_gainers_60m.events).toHaveLength(25);
  });
});

function createStore(): EventStore {
  return new EventStore({ bufferSize: 10, dedupeTtlMs: 60_000, mockMode: true, authEnabled: false });
}

function makeEvent(id: string, feedKey: FeedKey, receivedAt = '2026-01-01T00:00:00.000Z'): NormalizedEvent {
  return {
    id,
    feedKey,
    chapter: 'cex_alerts',
    category: 'listings',
    title: 'Test Event',
    plainText: 'Test event',
    htmlText: 'Test event',
    coins: ['BTC'],
    filters: [],
    timestamp: receivedAt,
    sourceTime: Date.parse(receivedAt),
    receivedAt,
    latencyMs: 10,
    severity: 'info',
    raw: {},
    endpoint: 'mock',
    entries: [],
    amountMetric: null,
    parserStatus: 'not_applicable'
  };
}
