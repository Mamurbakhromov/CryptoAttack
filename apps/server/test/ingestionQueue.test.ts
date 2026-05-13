import { describe, expect, it, vi } from 'vitest';

import { DurableIngestionQueue } from '../src/db/durableIngestion.js';
import type { EventIngestionRepository, RawEventIngestInput, RawEventIngestResult } from '../src/db/eventRepository.js';
import type { NormalizedEvent } from '../src/events/types.js';

describe('DurableIngestionQueue', () => {
  it('enqueues without awaiting a slow repository write and drains on stop', async () => {
    const deferred = createDeferred<RawEventIngestResult>();
    const repository = fakeRepository({ ingest: () => deferred.promise });
    const queue = new DurableIngestionQueue(repository, fakeLogger(), options());

    expect(queue.enqueue(makeJob())).toBe(true);
    expect(queue.getStatus()).toMatchObject({ accepted: 1, writtenJobs: 0 });

    deferred.resolve({ rawEventId: 'raw-id', rawReceivedAt: '2026-01-01T00:00:00.000Z', normalizedEventCount: 1, entryCount: 0 });
    await queue.stop(1_000);

    expect(queue.getStatus()).toMatchObject({ state: 'stopped', writtenJobs: 1, writtenEvents: 1, failed: 0 });
  });

  it('drops newest jobs when the bounded queue is full', () => {
    const repository = fakeRepository();
    const queue = new DurableIngestionQueue(repository, fakeLogger(), options({ maxQueueDepth: 0 }));

    expect(queue.enqueue(makeJob())).toBe(false);

    expect(queue.getStatus()).toMatchObject({ state: 'degraded', dropped: 1, queueDepth: 0, lastError: 'Durable ingestion queue full' });
  });

  it('records failed jobs without throwing worker errors', async () => {
    const recordIngestionError = vi.fn(async () => undefined);
    const repository = fakeRepository({
      ingest: async () => {
        throw new Error('permanent database failure');
      },
      recordIngestionError
    });
    const queue = new DurableIngestionQueue(repository, fakeLogger(), options({ maxRetries: 0 }));

    expect(queue.enqueue(makeJob())).toBe(true);
    await queue.stop(1_000);

    expect(queue.getStatus()).toMatchObject({ state: 'stopped', failed: 1, writtenJobs: 0, lastError: 'permanent database failure' });
    expect(recordIngestionError).toHaveBeenCalledWith(expect.objectContaining({ stage: 'durable_ingestion_queue', errorMessage: 'permanent database failure' }));
  });
});

function options(overrides: Partial<ConstructorParameters<typeof DurableIngestionQueue>[2]> = {}): ConstructorParameters<typeof DurableIngestionQueue>[2] {
  return {
    maxQueueDepth: 10,
    maxRetries: 0,
    retryBaseMs: 1,
    retryMaxMs: 1,
    drainTimeoutMs: 1_000,
    ...overrides
  };
}

function fakeRepository(input: Partial<{ ingest: (job: RawEventIngestInput) => Promise<RawEventIngestResult>; recordIngestionError: EventIngestionRepository['recordIngestionError'] }> = {}): EventIngestionRepository {
  return {
    ingestRawEvent: input.ingest ?? (async () => ({ rawEventId: 'raw-id', rawReceivedAt: '2026-01-01T00:00:00.000Z', normalizedEventCount: 1, entryCount: 0 })),
    recordIngestionError: input.recordIngestionError ?? (async () => undefined)
  } as EventIngestionRepository;
}

function fakeLogger() {
  return { warn: vi.fn() } as never;
}

function makeJob() {
  return {
    raw: { id: 'raw-1', chapter: 'cex_alerts', category: 'listings' },
    endpoint: 'fast',
    receivedAt: '2026-01-01T00:00:00.000Z',
    normalizedEvents: [makeEvent()]
  };
}

function makeEvent(): NormalizedEvent {
  return {
    id: 'event-1',
    feedKey: 'listings',
    chapter: 'cex_alerts',
    category: 'listings',
    title: 'Listing',
    plainText: '#BTC listed',
    htmlText: '#BTC listed',
    coins: ['BTC'],
    filters: [],
    timestamp: '2026-01-01T00:00:00.000Z',
    sourceTime: Date.parse('2026-01-01T00:00:00.000Z'),
    receivedAt: '2026-01-01T00:00:00.000Z',
    latencyMs: 1,
    severity: 'info',
    raw: {},
    endpoint: 'fast',
    entries: [],
    amountMetric: null,
    parserStatus: 'not_applicable'
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}
