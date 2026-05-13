import { describe, expect, it, vi } from 'vitest';

import type { ScoreRepository } from '../src/db/scoreRepository.js';
import { defaultScoreConfig } from '../src/scoring/defaultScoreConfig.js';
import { ScoreWorker } from '../src/scoring/scoreWorker.js';
import type { ScoreResult } from '../src/scoring/types.js';
import type { NormalizedEvent } from '../src/events/types.js';

describe('ScoreWorker', () => {
  it('queues coins from relevant events and recomputes scores', async () => {
    const repository = fakeRepository();
    const worker = new ScoreWorker(repository, {
      enabled: true,
      intervalMs: 30_000,
      debounceMs: 1_000,
      maxQueueDepth: 100,
      batchCoins: 25,
      windowsMinutes: [15],
      config: defaultScoreConfig,
      logger: { warn: vi.fn() } as never,
      now: () => new Date('2026-01-01T00:15:00.000Z')
    });

    expect(worker.enqueueEvents([makeEvent('BTC')])).toBe(true);
    expect(worker.getStatus()).toMatchObject({ pendingCoinCount: 1, lastTriggerReason: 'ingestion' });

    const result = await worker.recomputeNow({ reason: 'test' });

    expect(result).toMatchObject({ processed: 1, written: 1, failed: 0 });
    expect(repository.getScoreSourceRows).toHaveBeenCalledWith(expect.objectContaining({ coins: ['BTC'], feedKeys: expect.arrayContaining(['pricealerts']) }));
    expect(worker.getStatus()).toMatchObject({ state: 'running', processed: 1, written: 1, writtenEvidence: 1 });
  });

  it('marks failures as degraded without throwing', async () => {
    const repository = fakeRepository({ writeScores: vi.fn(async () => { throw new Error('score write failed'); }) });
    const warn = vi.fn();
    const worker = new ScoreWorker(repository, {
      enabled: true,
      intervalMs: 30_000,
      debounceMs: 1_000,
      maxQueueDepth: 100,
      batchCoins: 25,
      windowsMinutes: [15],
      config: defaultScoreConfig,
      logger: { warn } as never,
      now: () => new Date('2026-01-01T00:15:00.000Z')
    });

    worker.enqueueEvents([makeEvent('BTC')]);
    const result = await worker.recomputeNow({ reason: 'test' });

    expect(result.failed).toBe(1);
    expect(worker.getStatus()).toMatchObject({ state: 'degraded', failed: 1, lastError: 'score write failed' });
    expect(warn).toHaveBeenCalled();
  });
});

function fakeRepository(overrides: Partial<ScoreRepository> = {}): ScoreRepository {
  return {
    ensureScoreConfig: vi.fn(async () => undefined),
    getCandidateCoins: vi.fn(async () => ['BTC']),
    getScoreSourceRows: vi.fn(async () => [
      {
        source: 'entry',
        eventId: 'event-1',
        eventReceivedAt: '2026-01-01T00:14:00.000Z',
        entryId: 'entry-1',
        feedKey: 'pricealerts',
        coin: 'BTC',
        parserStatus: 'parsed',
        receivedAt: '2026-01-01T00:14:00.000Z',
        rank: 1,
        amountUsd: null,
        deltaUsd: null,
        buyUsd: null,
        sellUsd: null,
        buySellRatio: null,
        volume24hUsd: null,
        percent: null,
        priceChangePercent: 4,
        oiChange15mPercent: null,
        oiChange30mPercent: null,
        totalAlerts: null,
        direction: null,
        exchange: 'Binance',
        market: null,
        rawLine: 'BTC up'
      }
    ]),
    writeScores: vi.fn(async (results: ScoreResult[]) => ({ snapshotsWritten: results.length, evidenceWritten: results.reduce((sum, result) => sum + result.evidence.length, 0), currentWritten: results.length, skippedSnapshots: 0 })),
    ...overrides
  } as unknown as ScoreRepository;
}

function makeEvent(coin: string): NormalizedEvent {
  return {
    id: 'event-1',
    feedKey: 'pricealerts',
    chapter: 'signals',
    category: 'pricealerts',
    title: 'Price alert',
    plainText: 'Price alert',
    htmlText: 'Price alert',
    coins: [coin],
    filters: [],
    timestamp: '2026-01-01T00:14:00.000Z',
    sourceTime: null,
    receivedAt: '2026-01-01T00:14:00.000Z',
    latencyMs: null,
    severity: 'info',
    raw: {},
    endpoint: 'main',
    entries: [],
    amountMetric: null,
    parserStatus: 'parsed'
  };
}
