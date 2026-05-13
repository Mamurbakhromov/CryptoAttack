import { createReadStream } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';

import { normalizeCryptoAttackEvent } from '../events/normalizer.js';
import type { EventIngestionRepository } from './eventRepository.js';

export interface BackfillRawEventsOptions {
  path: string;
  repository: EventIngestionRepository;
  enableDelistings: boolean;
  enableAnnouncementDelistingFallback: boolean;
  limit?: number;
}

export interface BackfillRawEventsResult {
  path: string;
  scanned: number;
  processed: number;
  skipped: number;
  failed: number;
  normalizedEvents: number;
  entries: number;
}

export async function backfillRawEventsFromNdjson(options: BackfillRawEventsOptions): Promise<BackfillRawEventsResult> {
  const path = resolve(process.cwd(), options.path);
  const result: BackfillRawEventsResult = {
    path,
    scanned: 0,
    processed: 0,
    skipped: 0,
    failed: 0,
    normalizedEvents: 0,
    entries: 0
  };

  const lineReader = createInterface({
    input: createReadStream(path, { encoding: 'utf8' }),
    crlfDelay: Infinity
  });

  for await (const line of lineReader) {
    if (options.limit !== undefined && result.scanned >= options.limit) break;
    if (!line.trim()) continue;
    result.scanned += 1;

    const record = parseRawLogRecord(line);
    if (!record) {
      result.skipped += 1;
      continue;
    }

    try {
      const events = normalizeCryptoAttackEvent(record.raw, {
        endpointName: 'backfill',
        enableDelistings: options.enableDelistings,
        enableAnnouncementDelistingFallback: options.enableAnnouncementDelistingFallback,
        ...(record.receivedAtMs === null ? {} : { receivedAtMs: record.receivedAtMs })
      });
      const ingestResult = await options.repository.ingestRawEvent({
        raw: record.raw,
        endpoint: 'backfill',
        receivedAt: record.receivedAt,
        normalizedEvents: events
      });
      result.processed += 1;
      result.normalizedEvents += ingestResult.normalizedEventCount;
      result.entries += ingestResult.entryCount;
    } catch (error) {
      result.failed += 1;
      await options.repository.recordIngestionError({
        stage: 'backfill_raw_events',
        errorMessage: error instanceof Error ? error.message : String(error),
        payload: {
          receivedAt: record.receivedAt
        }
      }).catch(() => undefined);
    }
  }

  lineReader.close();
  return result;
}

function parseRawLogRecord(line: string): { raw: unknown; receivedAt: string; receivedAtMs: number | null } | null {
  try {
    const parsed: unknown = JSON.parse(line);
    if (!isRecord(parsed) || !('raw' in parsed)) return null;

    const receivedAtMs = typeof parsed.receivedAt === 'string' ? Date.parse(parsed.receivedAt) : Number.NaN;
    const receivedAt = Number.isFinite(receivedAtMs) ? new Date(receivedAtMs).toISOString() : new Date().toISOString();
    return {
      raw: parsed.raw,
      receivedAt,
      receivedAtMs: Number.isFinite(receivedAtMs) ? receivedAtMs : null
    };
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
