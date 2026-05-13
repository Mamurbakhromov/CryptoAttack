import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { EventStore } from './eventStore.js';
import { normalizeCryptoAttackEvent } from './normalizer.js';
import { feedKeys, type FeedKey, type NormalizedEvent } from './types.js';

const replayFeedKeys = feedKeys.filter((feedKey) => feedKey !== 'raw_unclassified');
const replayFeedKeySet = new Set<FeedKey>(replayFeedKeys);
const ONE_HOUR_MS = 60 * 60 * 1_000;

interface ReplayRawLogOptions {
  rawEventLogPath: string;
  store: EventStore;
  enableDelistings: boolean;
  enableAnnouncementDelistingFallback: boolean;
}

export interface ReplayRawLogResult {
  replayed: number;
  scanned: number;
  skipped: number;
  path: string;
}

export async function replayLatestRawEventsFromLog(options: ReplayRawLogOptions): Promise<ReplayRawLogResult> {
  const path = resolve(process.cwd(), options.rawEventLogPath);
  const result: ReplayRawLogResult = { replayed: 0, scanned: 0, skipped: 0, path };
  let content: string;

  try {
    content = await readFile(path, 'utf8');
  } catch {
    return result;
  }

  const selected = new Map<FeedKey, NormalizedEvent[]>();
  const newestEventTimeByFeed = new Map<FeedKey, number>();
  const lines = content.split('\n').filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    result.scanned += 1;
    const line = lines[index];
    if (line === undefined) continue;
    const record = parseRawLogRecord(line);
    if (!record) {
      result.skipped += 1;
      continue;
    }

    const events = normalizeCryptoAttackEvent(record.raw, {
      endpointName: 'replay',
      enableDelistings: options.enableDelistings,
      enableAnnouncementDelistingFallback: options.enableAnnouncementDelistingFallback,
      ...(record.receivedAtMs === undefined ? {} : { receivedAtMs: record.receivedAtMs })
    });

    for (const event of events) {
      if (!replayFeedKeySet.has(event.feedKey)) continue;
      if (options.store.getEvents(event.feedKey, 1).length > 0) continue;

      const eventTime = Date.parse(event.receivedAt);
      if (!Number.isFinite(eventTime)) continue;

      const newestEventTime = newestEventTimeByFeed.get(event.feedKey);
      if (newestEventTime === undefined) {
        newestEventTimeByFeed.set(event.feedKey, eventTime);
        selected.set(event.feedKey, [event]);
        continue;
      }

      if (eventTime >= newestEventTime - ONE_HOUR_MS) {
        selected.get(event.feedKey)?.push(event);
      }
    }
  }

  const events = [...selected.values()].flat().sort((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt));
  result.replayed = options.store.addEvents(events).length;
  return result;
}

function parseRawLogRecord(line: string): { raw: unknown; receivedAtMs: number | undefined } | null {
  try {
    const parsed: unknown = JSON.parse(line);
    if (!isPlainObject(parsed) || !('raw' in parsed)) return null;

    const receivedAtMs = typeof parsed.receivedAt === 'string' ? Date.parse(parsed.receivedAt) : Number.NaN;
    return {
      raw: parsed.raw,
      receivedAtMs: Number.isFinite(receivedAtMs) ? receivedAtMs : undefined
    };
  } catch {
    return null;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
