import { describe, expect, it, vi } from 'vitest';

import type { MarketDataRepository } from '../src/db/marketDataRepository.js';
import { ForwardReturnWorker } from '../src/market/forwardReturnWorker.js';

describe('ForwardReturnWorker', () => {
  it('seeds and computes due labels with status metrics', async () => {
    const repository = {
      seedPendingForwardReturns: vi.fn(async () => 5),
      computeDueForwardReturns: vi.fn(async () => ({ scanned: 3, ready: 2, missingBase: 1, missingFuture: 0, errors: 0 }))
    } as unknown as MarketDataRepository;
    const worker = new ForwardReturnWorker(repository, {
      enabled: true,
      intervalMs: 60_000,
      horizonsMinutes: [5, 15],
      logger: { warn: vi.fn() } as never
    });

    const result = await worker.computeDueNow('test');

    expect(result).toEqual({ seeded: 5, scanned: 3, ready: 2, missing: 1, failed: 0 });
    expect(repository.seedPendingForwardReturns).toHaveBeenCalledWith([5, 15], 500);
    expect(worker.getStatus()).toMatchObject({ enabled: true, state: 'running', processed: 3, written: 2, skipped: 1, failed: 0 });
  });
});
