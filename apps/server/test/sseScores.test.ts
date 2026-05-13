import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import { disabledDurableIngestionStatus } from '../src/db/durableIngestion.js';
import { EventStore } from '../src/events/eventStore.js';
import { disabledWorkerStatus } from '../src/market/workerStatus.js';
import { SseHub, type ScoreSnapshotSseEvent, type StorageStatusSseEvent } from '../src/http/sse.js';
import type { ScoreUpdateSseEvent } from '../src/scoring/scoreWorker.js';

describe('score SSE events', () => {
  it('streams initial score/storage snapshots and broadcasts score updates', () => {
    const writes: string[] = [];
    const requestRaw = new EventEmitter();
    const reply = {
      hijack: vi.fn(),
      raw: {
        destroyed: false,
        writeHead: vi.fn(),
        write: vi.fn((chunk: string) => {
          writes.push(chunk);
          return true;
        }),
        end: vi.fn()
      }
    };
    const store = new EventStore({ bufferSize: 10, dedupeTtlMs: 60_000, mockMode: true, authEnabled: false });
    const storageStatus = makeStorageStatus();
    const scoreSnapshot = makeScoreSnapshot();
    const hub = new SseHub(store, { corsOrigin: '*', getScoreSnapshot: () => scoreSnapshot, getStorageStatus: () => storageStatus });

    hub.handleStream({ headers: {}, raw: requestRaw } as never, reply as never);
    hub.broadcastScoreUpdate(makeScoreUpdate());
    hub.broadcastScoreSnapshot(scoreSnapshot);
    hub.broadcastStorageStatus(storageStatus);

    const stream = writes.join('');
    expect(reply.raw.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({ 'Content-Type': 'text/event-stream; charset=utf-8' }));
    expect(stream).toContain('event: snapshot');
    expect(stream).toContain('event: status');
    expect(stream).toContain('event: score-snapshot');
    expect(stream).toContain('event: storage-status');
    expect(stream).toContain('event: score-update');

    requestRaw.emit('close');
    hub.close();
  });
});

function makeScoreUpdate(): ScoreUpdateSseEvent {
  return {
    generatedAt: '2026-01-01T00:15:01.000Z',
    reason: 'ingestion',
    scoreVersion: 'rule-v1',
    asOf: '2026-01-01T00:15:00.000Z',
    processed: 1,
    written: 1,
    skipped: 0,
    failed: 0,
    evidenceWritten: 1,
    scores: [
      {
        coin: 'BTC',
        windowMinutes: 15,
        ts: '2026-01-01T00:15:00.000Z',
        bullScore: 70,
        bearScore: 5,
        netScore: 65,
        confidenceScore: 80,
        dominantSignal: 'price_alert_up',
        marketRegime: 'bullish',
        previousNetScore: null,
        netScoreDelta: null,
        eventCount: 1,
        evidenceCount: 1,
        scoreHash: 'score-hash',
        evidenceHash: 'evidence-hash'
      }
    ]
  };
}

function makeScoreSnapshot(): ScoreSnapshotSseEvent {
  return {
    generatedAt: '2026-01-01T00:15:01.000Z',
    scoreVersion: 'rule-v1',
    asOf: '2026-01-01T00:15:00.000Z',
    windowsMinutes: [15],
    scores: makeScoreUpdate().scores,
    health: {
      enabled: true,
      state: 'running',
      running: false,
      intervalMs: 30_000,
      scoreVersion: 'rule-v1',
      windowsMinutes: [15],
      queueDepth: 0,
      pendingCoinCount: 0,
      lastTriggeredAt: '2026-01-01T00:14:59.000Z',
      lastTriggerReason: 'ingestion',
      lastRunStartedAt: '2026-01-01T00:15:00.000Z',
      lastRunCompletedAt: '2026-01-01T00:15:01.000Z',
      lastSuccessAt: '2026-01-01T00:15:01.000Z',
      lastFailureAt: null,
      lastError: null,
      processed: 1,
      written: 1,
      skipped: 0,
      failed: 0,
      writtenEvidence: 1,
      latestScoreTs: '2026-01-01T00:15:00.000Z',
      averageRunMs: 1000
    }
  };
}

function makeStorageStatus(): StorageStatusSseEvent {
  return {
    generatedAt: '2026-01-01T00:15:01.000Z',
    storage: disabledDurableIngestionStatus(),
    workers: {
      priceCollection: disabledWorkerStatus(60_000),
      forwardReturns: disabledWorkerStatus(60_000),
      scores: makeScoreSnapshot().health
    }
  };
}
