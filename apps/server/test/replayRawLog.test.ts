import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { EventStore } from '../src/events/eventStore.js';
import { normalizeCryptoAttackEvent } from '../src/events/normalizer.js';
import { replayLatestRawEventsFromLog } from '../src/events/replayRawLog.js';

const tempDirs: string[] = [];

describe('replayLatestRawEventsFromLog', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  it('seeds empty feeds with latest-hour matching raw log events', async () => {
    const store = createStore();
    const logPath = await writeRawLog([
      rawLogRecord('2026-01-01T00:00:00.000Z', rawListing('old-listing', 'OLD')),
      rawLogRecord('2026-01-01T00:01:00.000Z', rawListing('new-listing', 'WRON')),
      rawLogRecord('2026-01-01T00:02:00.000Z', {
        chapter: 'market_data',
        category: 'top_oi',
        texts: ['📈📊 Top 10 OI Gainers (1h) #OpenInterest #TopGainers\n\n#UB OKX OI Change (1h): 82.36% Price: 0.0560 (3.02%)'],
        coins: ['UB'],
        filters: ['gainers', '30_min'],
        timestamp: '2026-01-01T00:02:00.000Z',
        id: 'oi-gainers'
      }),
      rawLogRecord('2026-01-01T00:03:00.000Z', {
        chapter: 'signals',
        category: 'oi_alerts',
        texts: ['#HEMI OI alert on Binance Futures: +14.2% in 10m. Price: 0.00783 (1.69%)'],
        coins: ['HEMI'],
        filters: ['oi_alerts'],
        timestamp: '2026-01-01T00:03:00.000Z',
        id: 'oi-alert'
      })
    ]);

    const result = await replayLatestRawEventsFromLog({
      rawEventLogPath: logPath,
      store,
      enableDelistings: true,
      enableAnnouncementDelistingFallback: false
    });

    const snapshot = store.getSnapshot();
    expect(result.replayed).toBe(4);
    expect(snapshot.feeds.listings.latest?.coins).toEqual(['WRON']);
    expect(snapshot.feeds.listings.events.map((event) => event.coins[0])).toEqual(['WRON', 'OLD']);
    expect(snapshot.feeds.top_oi_gainers_60m.latest?.entries[0]?.coin).toBe('UB');
    expect(snapshot.feeds.oi_alerts.latest?.coins).toEqual(['HEMI']);
    expect(snapshot.feeds.raw_unclassified.events).toHaveLength(0);
  });

  it('does not replace feeds that already have live events', async () => {
    const store = createStore();
    const liveEvent = normalizeCryptoAttackEvent(rawListing('live-listing', 'LIVE'), {
      endpointName: 'main',
      receivedAtMs: Date.parse('2026-01-01T00:10:00.000Z')
    })[0];
    if (!liveEvent) throw new Error('Expected live listing fixture to normalize');
    store.addEvent(liveEvent);

    const logPath = await writeRawLog([
      rawLogRecord('2026-01-01T00:11:00.000Z', rawListing('replay-listing', 'REPLAY'))
    ]);

    const result = await replayLatestRawEventsFromLog({
      rawEventLogPath: logPath,
      store,
      enableDelistings: true,
      enableAnnouncementDelistingFallback: false
    });

    expect(result.replayed).toBe(0);
    expect(store.getSnapshot().feeds.listings.latest?.coins).toEqual(['LIVE']);
  });
});

function createStore(): EventStore {
  return new EventStore({ bufferSize: 10, dedupeTtlMs: 60_000, mockMode: true, authEnabled: false });
}

async function writeRawLog(records: object[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'cryptoattack-replay-'));
  tempDirs.push(dir);
  const path = join(dir, 'raw-events.ndjson');
  await writeFile(path, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`, 'utf8');
  return path;
}

function rawLogRecord(receivedAt: string, raw: object): object {
  return {
    receivedAt,
    normalizedEventIds: [],
    feedKeys: [],
    raw
  };
}

function rawListing(id: string, coin: string): object {
  return {
    chapter: 'cex_alerts',
    category: 'listings',
    texts: [`#${coin} listed on Coinbase spot`],
    coins: [coin],
    filters: ['coinbase spot'],
    timestamp: '2026-01-01T00:00:00.000Z',
    id
  };
}
