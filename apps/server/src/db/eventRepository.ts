import { createHash } from 'node:crypto';

import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';

import type { NormalizedEvent, ParsedTopEntry } from '../events/types.js';

export interface RawEventIngestInput {
  raw: unknown;
  endpoint: string;
  receivedAt: string;
  normalizedEvents: NormalizedEvent[];
  provider?: string;
}

export interface RawEventIngestResult {
  rawEventId: string;
  rawReceivedAt: string;
  normalizedEventCount: number;
  entryCount: number;
}

export interface IngestionErrorInput {
  stage: string;
  errorMessage: string;
  rawEventId?: string | null;
  rawReceivedAt?: string | null;
  eventId?: string | null;
  eventReceivedAt?: string | null;
  feedKey?: string | null;
  retryCount?: number;
  errorCode?: string | null;
  payload?: unknown;
}

export interface ClearEventDataResult {
  clearedAt: string;
  tables: string[];
}

export interface HistoryPruneTableResult {
  table: string;
  rowsDeleted: number;
}

export interface DeleteHistoryOlderThanResult {
  prunedAt: string;
  cutoff: string;
  retentionDays: number;
  rowsDeleted: number;
  tables: HistoryPruneTableResult[];
}

interface QueryableClient {
  query<T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<T>>;
}

interface ConnectablePool {
  connect(): Promise<PoolClient>;
}

interface RawEventKeyRow extends QueryResultRow {
  raw_event_id: string;
  raw_received_at: Date | string;
}

interface NormalizedEventKeyRow extends QueryResultRow {
  received_at: Date | string;
}

interface EventEntryKeyRow extends QueryResultRow {
  entry_id: string;
  received_at: Date | string;
}

export class EventIngestionRepository {
  constructor(private readonly pool: Pool | ConnectablePool) {}

  async ingestRawEvent(input: RawEventIngestInput): Promise<RawEventIngestResult> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const rawMetadata = buildRawMetadata(input);
      const rawKey = await upsertRawEventKey(client, rawMetadata.idempotencyKey, input.receivedAt);
      const rawReceivedAt = normalizeDbDate(rawKey.raw_received_at);

      await upsertRawEvent(client, {
        input,
        rawMetadata,
        rawEventId: rawKey.raw_event_id,
        rawReceivedAt
      });

      let entryCount = 0;
      for (const event of input.normalizedEvents) {
        const eventReceivedAt = await upsertNormalizedEvent(client, event, rawKey.raw_event_id, rawReceivedAt);
        for (let index = 0; index < event.entries.length; index += 1) {
          const entry = event.entries[index];
          if (!entry) continue;
          await upsertEventEntry(client, event, entry, index, eventReceivedAt);
          entryCount += 1;
        }
      }

      await client.query('commit');
      return {
        rawEventId: rawKey.raw_event_id,
        rawReceivedAt,
        normalizedEventCount: input.normalizedEvents.length,
        entryCount
      };
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async recordIngestionError(input: IngestionErrorInput): Promise<void> {
    await queryRecordIngestionError(this.pool as unknown as QueryableClient, input);
  }
}

const eventDataTables = [
  'event_entries',
  'normalized_events',
  'raw_events',
  'event_entry_keys',
  'normalized_event_keys',
  'raw_event_keys'
] as const;

const allStoredDataTables = [
  'event_entries',
  'normalized_events',
  'raw_events',
  'event_entry_keys',
  'normalized_event_keys',
  'raw_event_keys',
  'ingestion_errors'
] as const;

const historyPruneTables = [
  { table: 'event_entries', timeColumn: 'received_at' },
  { table: 'normalized_events', timeColumn: 'received_at' },
  { table: 'raw_events', timeColumn: 'received_at' },
  { table: 'event_entry_keys', timeColumn: 'received_at' },
  { table: 'normalized_event_keys', timeColumn: 'received_at' },
  { table: 'raw_event_keys', timeColumn: 'raw_received_at' },
  { table: 'ingestion_errors', timeColumn: 'failed_at' }
] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

export class EventMaintenanceRepository {
  constructor(private readonly pool: Pool | ConnectablePool) {}

  async clearEventData(): Promise<ClearEventDataResult> {
    return this.truncateTables([...eventDataTables]);
  }

  async clearAllStoredData(): Promise<ClearEventDataResult> {
    return this.truncateTables([...allStoredDataTables]);
  }

  async deleteHistoryOlderThan(retentionDays: number, now = new Date()): Promise<DeleteHistoryOlderThanResult> {
    const cutoff = new Date(now.getTime() - retentionDays * DAY_MS).toISOString();
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const tables: HistoryPruneTableResult[] = [];
      for (const { table, timeColumn } of historyPruneTables) {
        const result = await client.query(`delete from ${table} where ${timeColumn} < $1`, [cutoff]);
        tables.push({ table, rowsDeleted: result.rowCount ?? 0 });
      }
      await client.query('commit');
      return {
        prunedAt: new Date().toISOString(),
        cutoff,
        retentionDays,
        rowsDeleted: tables.reduce((sum, table) => sum + table.rowsDeleted, 0),
        tables
      };
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }

  private async truncateTables(tables: string[]): Promise<ClearEventDataResult> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query(`truncate table ${tables.join(', ')} restart identity`);
      await client.query('commit');
      return {
        clearedAt: new Date().toISOString(),
        tables
      };
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }
}

export function buildRawIdempotencyKey(raw: unknown, provider = 'cryptoattack'): string {
  const providerEventId = getStringField(raw, 'id');
  const chapter = normalizeTextField(getStringField(raw, 'chapter'), 'unknown');
  const category = normalizeTextField(getStringField(raw, 'category'), 'unknown');
  if (providerEventId) return `${provider}:id:${chapter}:${category}:${providerEventId}`;
  return `${provider}:hash:${hashUnknown(raw)}`;
}

export function hashUnknown(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

async function upsertRawEventKey(client: QueryableClient, idempotencyKey: string, receivedAt: string): Promise<RawEventKeyRow> {
  const result = await client.query<RawEventKeyRow>(
    `insert into raw_event_keys (idempotency_key, raw_event_id, raw_received_at)
     values ($1, gen_random_uuid(), $2)
     on conflict (idempotency_key) do update
     set last_seen_at = now()
     returning raw_event_id::text, raw_received_at`,
    [idempotencyKey, receivedAt]
  );
  const row = result.rows[0];
  if (!row) throw new Error('raw_event_keys upsert returned no row');
  return row;
}

async function upsertRawEvent(
  client: QueryableClient,
  args: {
    input: RawEventIngestInput;
    rawMetadata: RawMetadata;
    rawEventId: string;
    rawReceivedAt: string;
  }
): Promise<void> {
  const { input, rawMetadata, rawEventId, rawReceivedAt } = args;
  await client.query(
    `insert into raw_events (
       raw_event_id,
       provider,
       endpoint,
       provider_event_id,
       provider_chapter,
       provider_category,
       provider_timestamp,
       received_at,
       raw_payload,
       payload_hash,
       normalized_event_ids,
       feed_keys,
       parser_status
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     on conflict (raw_event_id, received_at) do update
     set endpoint = excluded.endpoint,
         provider_event_id = excluded.provider_event_id,
         provider_chapter = excluded.provider_chapter,
         provider_category = excluded.provider_category,
         provider_timestamp = excluded.provider_timestamp,
         raw_payload = excluded.raw_payload,
         payload_hash = excluded.payload_hash,
         normalized_event_ids = excluded.normalized_event_ids,
         feed_keys = excluded.feed_keys,
         parser_status = excluded.parser_status`,
    [
      rawEventId,
      rawMetadata.provider,
      input.endpoint,
      rawMetadata.providerEventId,
      rawMetadata.chapter,
      rawMetadata.category,
      rawMetadata.providerTimestamp,
      rawReceivedAt,
      input.raw,
      Buffer.from(rawMetadata.payloadHash, 'hex'),
      input.normalizedEvents.map((event) => event.id),
      [...new Set(input.normalizedEvents.map((event) => event.feedKey))],
      rawMetadata.parserStatus
    ]
  );
}

async function upsertNormalizedEvent(client: QueryableClient, event: NormalizedEvent, rawEventId: string, rawReceivedAt: string): Promise<string> {
  const keyResult = await client.query<NormalizedEventKeyRow>(
    `insert into normalized_event_keys (event_id, received_at, raw_event_id, raw_received_at)
     values ($1, $2, $3, $4)
     on conflict (event_id) do update
     set raw_event_id = excluded.raw_event_id,
         raw_received_at = excluded.raw_received_at,
         last_seen_at = now()
     returning received_at`,
    [event.id, event.receivedAt, rawEventId, rawReceivedAt]
  );
  const canonicalReceivedAt = normalizeDbDate(keyResult.rows[0]?.received_at ?? event.receivedAt);

  await client.query(
    `insert into normalized_events (
       event_id,
       raw_event_id,
       raw_received_at,
       feed_key,
       chapter,
       category,
       title,
       plain_text,
       html_text,
       coins,
       filters,
       event_timestamp,
       source_time_ms,
       received_at,
       latency_ms,
       severity,
       endpoint,
       parser_status,
       amount_metric,
       normalized_payload
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
     on conflict (event_id, received_at) do update
     set raw_event_id = excluded.raw_event_id,
         raw_received_at = excluded.raw_received_at,
         feed_key = excluded.feed_key,
         chapter = excluded.chapter,
         category = excluded.category,
         title = excluded.title,
         plain_text = excluded.plain_text,
         html_text = excluded.html_text,
         coins = excluded.coins,
         filters = excluded.filters,
         event_timestamp = excluded.event_timestamp,
         source_time_ms = excluded.source_time_ms,
         latency_ms = excluded.latency_ms,
         severity = excluded.severity,
         endpoint = excluded.endpoint,
         parser_status = excluded.parser_status,
         amount_metric = excluded.amount_metric,
         normalized_payload = excluded.normalized_payload`,
    [
      event.id,
      rawEventId,
      rawReceivedAt,
      event.feedKey,
      event.chapter,
      event.category,
      event.title,
      event.plainText,
      event.htmlText,
      event.coins,
      event.filters,
      event.timestamp,
      event.sourceTime,
      canonicalReceivedAt,
      event.latencyMs,
      event.severity,
      event.endpoint,
      event.parserStatus,
      event.amountMetric,
      normalizedEventPayload(event)
    ]
  );

  return canonicalReceivedAt;
}

async function upsertEventEntry(
  client: QueryableClient,
  event: NormalizedEvent,
  entry: ParsedTopEntry,
  entryIndex: number,
  eventReceivedAt: string
): Promise<void> {
  const entryKey = `${event.id}:${entryIndex}`;
  const keyResult = await client.query<EventEntryKeyRow>(
    `insert into event_entry_keys (entry_key, entry_id, received_at, event_id)
     values ($1, gen_random_uuid(), $2, $3)
     on conflict (entry_key) do update
     set last_seen_at = now()
     returning entry_id::text, received_at`,
    [entryKey, eventReceivedAt, event.id]
  );
  const keyRow = keyResult.rows[0];
  if (!keyRow) throw new Error('event_entry_keys upsert returned no row');
  const receivedAt = normalizeDbDate(keyRow.received_at);

  await client.query(
    `insert into event_entries (
       entry_id,
       event_id,
       event_received_at,
       received_at,
       feed_key,
       rank,
       coin,
       pair,
       exchange,
       market,
       direction,
       interval_label,
       amount_usd,
       amount_asset,
       buy_usd,
       sell_usd,
       delta_usd,
       buy_sell_ratio,
       volume_24h_usd,
       volume_24h_asset,
       percent,
       price_usd,
       price_change_percent,
       oi_change_15m_percent,
       oi_change_30m_percent,
       followup_price_change_percent,
       total_alerts,
       notified_at,
       threshold,
       href,
       raw_line,
       entry_payload
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
               $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32)
     on conflict (entry_id, received_at) do update
     set event_id = excluded.event_id,
         event_received_at = excluded.event_received_at,
         feed_key = excluded.feed_key,
         rank = excluded.rank,
         coin = excluded.coin,
         pair = excluded.pair,
         exchange = excluded.exchange,
         market = excluded.market,
         direction = excluded.direction,
         interval_label = excluded.interval_label,
         amount_usd = excluded.amount_usd,
         amount_asset = excluded.amount_asset,
         buy_usd = excluded.buy_usd,
         sell_usd = excluded.sell_usd,
         delta_usd = excluded.delta_usd,
         buy_sell_ratio = excluded.buy_sell_ratio,
         volume_24h_usd = excluded.volume_24h_usd,
         volume_24h_asset = excluded.volume_24h_asset,
         percent = excluded.percent,
         price_usd = excluded.price_usd,
         price_change_percent = excluded.price_change_percent,
         oi_change_15m_percent = excluded.oi_change_15m_percent,
         oi_change_30m_percent = excluded.oi_change_30m_percent,
         followup_price_change_percent = excluded.followup_price_change_percent,
         total_alerts = excluded.total_alerts,
         notified_at = excluded.notified_at,
         threshold = excluded.threshold,
         href = excluded.href,
         raw_line = excluded.raw_line,
         entry_payload = excluded.entry_payload`,
    [
      keyRow.entry_id,
      event.id,
      eventReceivedAt,
      receivedAt,
      event.feedKey,
      entry.rank,
      entry.coin,
      entry.pair,
      entry.exchange,
      marketForEvent(event),
      entry.direction,
      entry.interval,
      entry.amountUsd,
      entry.amountAsset ?? null,
      entry.buyUsd,
      entry.sellUsd,
      entry.deltaUsd,
      entry.buySellRatio,
      entry.volume24hUsd,
      entry.volume24hAsset ?? null,
      entry.percent,
      entry.priceUsd,
      entry.priceChangePercent,
      entry.oiChange15mPercent ?? null,
      entry.oiChange30mPercent ?? null,
      entry.followupPriceChangePercent ?? null,
      entry.totalAlerts ?? null,
      parseOptionalTimestamp(entry.notifiedAt),
      entry.threshold ?? null,
      entry.href ?? null,
      entry.rawLine,
      entry
    ]
  );
}

export async function queryRecordIngestionError(client: QueryableClient, input: IngestionErrorInput): Promise<void> {
  await client.query(
    `insert into ingestion_errors (
       stage,
       raw_event_id,
       raw_received_at,
       event_id,
       event_received_at,
       feed_key,
       retry_count,
       error_code,
       error_message,
       payload
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      input.stage,
      input.rawEventId ?? null,
      input.rawReceivedAt ?? null,
      input.eventId ?? null,
      input.eventReceivedAt ?? null,
      input.feedKey ?? null,
      input.retryCount ?? 0,
      input.errorCode ?? null,
      input.errorMessage,
      input.payload ?? null
    ]
  );
}

interface RawMetadata {
  provider: string;
  idempotencyKey: string;
  providerEventId: string | null;
  chapter: string;
  category: string;
  providerTimestamp: string | null;
  payloadHash: string;
  parserStatus: NormalizedEvent['parserStatus'];
}

function buildRawMetadata(input: RawEventIngestInput): RawMetadata {
  const provider = input.provider ?? 'cryptoattack';
  const firstEvent = input.normalizedEvents[0];
  return {
    provider,
    idempotencyKey: buildRawIdempotencyKey(input.raw, provider),
    providerEventId: getStringField(input.raw, 'id'),
    chapter: firstEvent?.chapter ?? normalizeTextField(getStringField(input.raw, 'chapter'), 'unknown'),
    category: firstEvent?.category ?? normalizeTextField(getStringField(input.raw, 'category'), 'unknown'),
    providerTimestamp: firstEvent?.timestamp ?? parseRawTimestamp(input.raw),
    payloadHash: hashUnknown(input.raw),
    parserStatus: aggregateParserStatus(input.normalizedEvents)
  };
}

function aggregateParserStatus(events: NormalizedEvent[]): NormalizedEvent['parserStatus'] {
  if (events.some((event) => event.parserStatus === 'parser_needs_sample')) return 'parser_needs_sample';
  if (events.some((event) => event.parserStatus === 'parsed')) return 'parsed';
  return 'not_applicable';
}

function normalizedEventPayload(event: NormalizedEvent): Omit<NormalizedEvent, 'raw'> & { rawStoredSeparately: true } {
  const { raw: _raw, ...payload } = event;
  return { ...payload, rawStoredSeparately: true };
}

function marketForEvent(event: NormalizedEvent): string | null {
  if (event.feedKey.includes('spot')) return 'spot';
  if (event.feedKey.includes('derivatives') || event.feedKey.includes('oi')) return 'perpetual';
  return null;
}

function parseRawTimestamp(raw: unknown): string | null {
  const timestamp = getStringField(raw, 'timestamp');
  if (timestamp) {
    const parsed = new Date(timestamp);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }

  for (const key of ['time', 'timesend1']) {
    const value = isRecord(raw) ? raw[key] : undefined;
    const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
    if (Number.isFinite(numeric) && numeric > 0) return new Date(numeric).toISOString();
  }

  return null;
}

function parseOptionalTimestamp(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function getStringField(value: unknown, field: string): string | null {
  if (!isRecord(value)) return null;
  const rawValue = value[field];
  return typeof rawValue === 'string' && rawValue.trim() ? rawValue.trim() : null;
}

function normalizeTextField(value: string | null, fallback: string): string {
  return value?.trim().toLowerCase() || fallback;
}

function normalizeDbDate(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

function stableStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(stabilize(value, seen));
}

function stabilize(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => stabilize(item, seen));

  const record = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(record).sort().map((key) => [key, stabilize(record[key], seen)]));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function rollbackQuietly(client: PoolClient): Promise<void> {
  try {
    await client.query('rollback');
  } catch {
    // Keep the original persistence error.
  }
}
