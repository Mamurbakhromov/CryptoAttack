import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { backfillRawEventsFromNdjson } from '../src/db/backfillRawEvents.js';
import type { EventIngestionRepository, RawEventIngestInput } from '../src/db/eventRepository.js';

const tempDirs: string[] = [];

describe('backfillRawEventsFromNdjson', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  it('persists raw log records without printing raw payload text', async () => {
    const path = await writeFixture([
      JSON.stringify(rawLogRecord('2026-01-01T00:00:00.000Z', rawListing('listing-1', 'BTC'))),
      'not-json',
      JSON.stringify({ receivedAt: '2026-01-01T00:00:01.000Z' })
    ]);
    const ingested: RawEventIngestInput[] = [];
    const repository = fakeRepository(ingested);

    const result = await backfillRawEventsFromNdjson({
      path,
      repository,
      enableDelistings: true,
      enableAnnouncementDelistingFallback: false
    });

    expect(result).toMatchObject({ scanned: 3, processed: 1, skipped: 2, failed: 0, normalizedEvents: 1 });
    expect(ingested).toHaveLength(1);
    expect(ingested[0]).toMatchObject({ endpoint: 'backfill', receivedAt: '2026-01-01T00:00:00.000Z' });
    expect(ingested[0]?.normalizedEvents[0]?.feedKey).toBe('listings');
  });

  it('continues after repository failures and records sanitized ingestion errors', async () => {
    const path = await writeFixture([JSON.stringify(rawLogRecord('2026-01-01T00:00:00.000Z', rawListing('listing-1', 'SECRET')))]);
    const recordIngestionError = vi.fn(async () => undefined);
    const repository = {
      ingestRawEvent: async () => {
        throw new Error('database unavailable');
      },
      recordIngestionError
    } as unknown as EventIngestionRepository;

    const result = await backfillRawEventsFromNdjson({
      path,
      repository,
      enableDelistings: true,
      enableAnnouncementDelistingFallback: false
    });

    expect(result).toMatchObject({ scanned: 1, processed: 0, failed: 1 });
    expect(recordIngestionError).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'backfill_raw_events',
        errorMessage: 'database unavailable',
        payload: { receivedAt: '2026-01-01T00:00:00.000Z' }
      })
    );
  });
});

async function writeFixture(lines: string[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'cryptoattack-backfill-'));
  tempDirs.push(dir);
  const path = join(dir, 'raw-events.ndjson');
  await writeFile(path, `${lines.join('\n')}\n`, 'utf8');
  return path;
}

function rawLogRecord(receivedAt: string, raw: object): object {
  return { receivedAt, raw, normalizedEventIds: [], feedKeys: [] };
}

function rawListing(id: string, coin: string): object {
  return {
    chapter: 'cex_alerts',
    category: 'listings',
    texts: [`#${coin} listed on Binance spot`],
    coins: [coin],
    filters: ['listing'],
    timestamp: '2026-01-01T00:00:00.000Z',
    id
  };
}

function fakeRepository(ingested: RawEventIngestInput[]): EventIngestionRepository {
  return {
    ingestRawEvent: async (input: RawEventIngestInput) => {
      ingested.push(input);
      return { rawEventId: 'raw-id', rawReceivedAt: input.receivedAt, normalizedEventCount: input.normalizedEvents.length, entryCount: 0 };
    },
    recordIngestionError: async () => undefined
  } as unknown as EventIngestionRepository;
}
