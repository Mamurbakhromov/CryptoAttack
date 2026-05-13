import type { PoolClient, QueryResult, QueryResultRow } from 'pg';

import type { ExchangeKey, ExchangeMarket } from '../exchanges/types.js';
import { calculateForwardReturn, type ForwardReturnStatus } from './forwardReturns.js';

export interface PriceTickInput {
  source: string;
  exchange: ExchangeKey;
  market: ExchangeMarket;
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  sourceTs: string;
  collectedAt: string;
  price: number;
  volume24hBase?: number | null;
  volume24hQuote?: number | null;
  priceChangePercent24h?: number | null;
  openInterest?: number | null;
  openInterestValueUsd?: number | null;
  payload?: unknown;
}

export interface ForwardReturnComputeOptions {
  now: string;
  horizonsMinutes: number[];
  batchSize: number;
  maxPriceSkewMs: number;
}

export interface ForwardReturnComputeResult {
  scanned: number;
  ready: number;
  missingBase: number;
  missingFuture: number;
  errors: number;
}

export interface MarketDataPool {
  connect(): Promise<PoolClient>;
  query<T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<T>>;
}

interface DueForwardReturnRow extends QueryResultRow {
  event_id: string;
  event_received_at: Date | string;
  coin: string;
  horizon_minutes: number;
  base_ts: Date | string;
  target_ts: Date | string;
  exchange: string | null;
  market: string | null;
  symbol: string | null;
  base_asset: string | null;
  quote_asset: string | null;
  entry_id: string | null;
}

interface PriceTickRow extends QueryResultRow {
  ts: Date | string;
  price_usd: string | number;
}

export class MarketDataRepository {
  constructor(private readonly pool: MarketDataPool) {}

  async upsertPriceTicks(ticks: PriceTickInput[]): Promise<{ written: number }> {
    if (!ticks.length) return { written: 0 };
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      for (const tick of ticks) {
        await client.query(
          `insert into price_ticks (
             source,
             exchange,
             market,
             symbol,
             coin,
             base_asset,
             quote_asset,
             ts,
             collected_at,
             price_usd,
             volume_24h_base,
             volume_24h_quote,
             price_change_percent_24h,
             open_interest,
             open_interest_value_usd,
             tick_payload
           ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
           on conflict (source, exchange, market, symbol, ts) do update
           set coin = excluded.coin,
               base_asset = excluded.base_asset,
               quote_asset = excluded.quote_asset,
               collected_at = least(price_ticks.collected_at, excluded.collected_at),
               price_usd = excluded.price_usd,
               volume_24h_base = excluded.volume_24h_base,
               volume_24h_quote = excluded.volume_24h_quote,
               price_change_percent_24h = excluded.price_change_percent_24h,
               open_interest = excluded.open_interest,
               open_interest_value_usd = excluded.open_interest_value_usd,
               tick_payload = excluded.tick_payload`,
          [
            tick.source,
            tick.exchange,
            tick.market,
            tick.symbol.toUpperCase(),
            tick.baseAsset.toUpperCase(),
            tick.baseAsset.toUpperCase(),
            tick.quoteAsset.toUpperCase(),
            tick.sourceTs,
            tick.collectedAt,
            tick.price,
            tick.volume24hBase ?? null,
            tick.volume24hQuote ?? null,
            tick.priceChangePercent24h ?? null,
            tick.openInterest ?? null,
            tick.openInterestValueUsd ?? null,
            tick.payload ?? {}
          ]
        );
      }
      await client.query('commit');
      return { written: ticks.length };
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async getRecentlyActiveCoins(since: string, limit: number): Promise<string[]> {
    const result = await this.pool.query<{ coin: string }>(
      `select coin
       from (
         select upper(coin) as coin, received_at
         from event_entries
         where coin is not null and received_at >= $1
         union all
         select upper(coin) as coin, received_at
         from normalized_events, unnest(coins) as coin
         where received_at >= $1
       ) active
       where coin <> ''
       group by coin
       order by max(received_at) desc, count(*) desc
       limit $2`,
      [since, limit]
    );
    return result.rows.map((row) => row.coin);
  }

  async getTopScoredCoins(limit: number): Promise<string[]> {
    const result = await this.pool.query<{ coin: string }>(
      `select upper(coin) as coin
       from coin_score_current
       group by coin
       order by max(greatest(bull_score, bear_score, abs(net_score))) desc
       limit $1`,
      [limit]
    );
    return result.rows.map((row) => row.coin);
  }

  async seedPendingForwardReturns(horizonsMinutes: number[], limit: number): Promise<number> {
    const result = await this.pool.query(
      `with candidate_entries as (
         select *
         from event_entries
         where coin is not null
         order by received_at desc
         limit $2
        ), event_seeded as (
          insert into forward_returns (
            entry_id,
            event_id,
           event_received_at,
           coin,
           horizon_minutes,
           base_ts,
           target_ts,
           exchange,
           market,
           symbol,
           base_asset,
           quote_asset,
           status,
           payload
         )
         select
           entry_id,
           event_id,
           event_received_at,
           upper(coin),
           horizon_minutes,
           event_received_at,
           event_received_at + (horizon_minutes * interval '1 minute'),
           coalesce(nullif(lower(exchange), ''), 'binance'),
           case
             when market = 'futures' then 'perpetual'
             when market in ('spot', 'perpetual') then market
             when feed_key like '%derivatives%' or feed_key like '%oi%' then 'perpetual'
             else 'spot'
           end,
           upper(coalesce(nullif(pair, ''), coin || 'USDT')),
           upper(coin),
           case
             when upper(coalesce(pair, '')) like '%USDC' then 'USDC'
             when upper(coalesce(pair, '')) like '%USD' and upper(coalesce(pair, '')) not like '%USDT' then 'USD'
             else 'USDT'
           end,
           'pending',
           jsonb_build_object('source', 'event_entries')
          from candidate_entries
          cross join unnest($1::int[]) as horizon_minutes
          on conflict (entry_id, event_received_at, horizon_minutes) where entry_id is not null do update
          set entry_id = coalesce(forward_returns.entry_id, excluded.entry_id),
              target_ts = coalesce(forward_returns.target_ts, excluded.target_ts),
              exchange = coalesce(forward_returns.exchange, excluded.exchange),
             market = coalesce(forward_returns.market, excluded.market),
             symbol = coalesce(forward_returns.symbol, excluded.symbol),
              base_asset = coalesce(forward_returns.base_asset, excluded.base_asset),
              quote_asset = coalesce(forward_returns.quote_asset, excluded.quote_asset)
          returning 1
        ), candidate_scores as (
          select score_snapshot_id, ts, upper(coin) as coin
          from score_snapshots
          order by ts desc
          limit $2
        ), score_seeded as (
          insert into forward_returns (
            entry_id,
            event_id,
            event_received_at,
            coin,
            horizon_minutes,
            base_ts,
            target_ts,
            exchange,
            market,
            symbol,
            base_asset,
            quote_asset,
            status,
            payload
          )
          select
            null::uuid,
            'score:' || score_snapshot_id::text,
            ts,
            coin,
            horizon_minutes,
            ts,
            ts + (horizon_minutes * interval '1 minute'),
            'binance',
            'spot',
            coin || 'USDT',
            coin,
            'USDT',
            'pending',
            jsonb_build_object('source', 'score_snapshots')
          from candidate_scores
          cross join unnest($1::int[]) as horizon_minutes
          on conflict (event_id, event_received_at, coin, horizon_minutes) where entry_id is null do update
          set target_ts = coalesce(forward_returns.target_ts, excluded.target_ts),
              exchange = coalesce(forward_returns.exchange, excluded.exchange),
              market = coalesce(forward_returns.market, excluded.market),
              symbol = coalesce(forward_returns.symbol, excluded.symbol),
              base_asset = coalesce(forward_returns.base_asset, excluded.base_asset),
              quote_asset = coalesce(forward_returns.quote_asset, excluded.quote_asset)
          returning 1
        )
        select ((select count(*) from event_seeded) + (select count(*) from score_seeded))::int as count`,
      [horizonsMinutes, limit]
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async computeDueForwardReturns(options: ForwardReturnComputeOptions): Promise<ForwardReturnComputeResult> {
    const due = await this.getDueForwardReturns(options);
    const result: ForwardReturnComputeResult = { scanned: due.length, ready: 0, missingBase: 0, missingFuture: 0, errors: 0 };

    for (const row of due) {
      try {
        const baseTargetTs = normalizeDbDate(row.base_ts);
        const futureTargetTs = normalizeDbDate(row.target_ts);
        const baseTick = await this.findNearestPrice(row, baseTargetTs, options.maxPriceSkewMs, 'at_or_before');
        const futureTick = await this.findNearestPrice(row, futureTargetTs, options.maxPriceSkewMs, 'at_or_after');
        const windowTicks = baseTick && futureTick ? await this.getWindowPrices(row, normalizeDbDate(baseTick.ts), normalizeDbDate(futureTick.ts)) : [];
        const calculation = calculateForwardReturn({
          basePrice: baseTick ? Number(baseTick.price_usd) : null,
          futurePrice: futureTick ? Number(futureTick.price_usd) : null,
          windowPrices: windowTicks.map((tick) => Number(tick.price_usd))
        });

        await this.updateForwardReturn(row, {
          status: calculation.status,
          baseTs: baseTick ? normalizeDbDate(baseTick.ts) : baseTargetTs,
          basePrice: baseTick ? Number(baseTick.price_usd) : null,
          futureTs: futureTick ? normalizeDbDate(futureTick.ts) : null,
          futurePrice: futureTick ? Number(futureTick.price_usd) : null,
          returnPct: calculation.returnPct,
          maxReturnPct: calculation.maxReturnPct,
          minReturnPct: calculation.minReturnPct,
          errorMessage: calculation.errorMessage
        });

        if (calculation.status === 'ready') result.ready += 1;
        else if (calculation.status === 'missing_base_price') result.missingBase += 1;
        else if (calculation.status === 'missing_future_price') result.missingFuture += 1;
        else result.errors += 1;
      } catch (error) {
        result.errors += 1;
        await this.updateForwardReturn(row, {
          status: 'error',
          baseTs: normalizeDbDate(row.base_ts),
          basePrice: null,
          futureTs: null,
          futurePrice: null,
          returnPct: null,
          maxReturnPct: null,
          minReturnPct: null,
          errorMessage: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return result;
  }

  private async getDueForwardReturns(options: ForwardReturnComputeOptions): Promise<DueForwardReturnRow[]> {
    const query = await this.pool.query<DueForwardReturnRow>(
      `select event_id,
              event_received_at,
              coin,
              horizon_minutes,
              base_ts,
              coalesce(target_ts, event_received_at + (horizon_minutes * interval '1 minute')) as target_ts,
              exchange,
              market,
              symbol,
              base_asset,
              quote_asset,
              entry_id::text
       from forward_returns
       where status in ('pending', 'missing_price', 'missing_base_price', 'missing_future_price')
         and horizon_minutes = any($2::int[])
         and coalesce(target_ts, event_received_at + (horizon_minutes * interval '1 minute')) <= $1
       order by event_received_at asc
       limit $3`,
      [options.now, options.horizonsMinutes, options.batchSize]
    );
    return query.rows;
  }

  private async findNearestPrice(row: DueForwardReturnRow, targetTs: string, maxSkewMs: number, side: 'at_or_before' | 'at_or_after'): Promise<PriceTickRow | null> {
    const skewInterval = `${Math.max(1, Math.ceil(maxSkewMs / 1000))} seconds`;
    const direction = side === 'at_or_before' ? '<=' : '>=';
    const windowDirection = side === 'at_or_before' ? '>=' : '<=';
    const order = side === 'at_or_before' ? 'desc' : 'asc';
    const boundExpression = side === 'at_or_before' ? `$2::timestamptz - $3::interval` : `$2::timestamptz + $3::interval`;
    const query = await this.pool.query<PriceTickRow>(
      `select ts, price_usd
       from price_ticks
       where exchange = $1
         and market = $4
         and symbol = $5
         and ts ${direction} $2
         and ts ${windowDirection} ${boundExpression}
       order by ts ${order}
       limit 1`,
      [normalizeExchange(row.exchange), targetTs, skewInterval, normalizeMarket(row.market), normalizeSymbol(row)]
    );
    return query.rows[0] ?? null;
  }

  private async getWindowPrices(row: DueForwardReturnRow, fromTs: string, toTs: string): Promise<PriceTickRow[]> {
    const query = await this.pool.query<PriceTickRow>(
      `select ts, price_usd
       from price_ticks
       where exchange = $1
         and market = $2
         and symbol = $3
         and ts >= $4
         and ts <= $5
       order by ts asc`,
      [normalizeExchange(row.exchange), normalizeMarket(row.market), normalizeSymbol(row), fromTs, toTs]
    );
    return query.rows;
  }

  private async updateForwardReturn(
    row: DueForwardReturnRow,
    update: {
      status: ForwardReturnStatus;
      baseTs: string;
      basePrice: number | null;
      futureTs: string | null;
      futurePrice: number | null;
      returnPct: number | null;
      maxReturnPct: number | null;
      minReturnPct: number | null;
      errorMessage: string | null;
    }
  ): Promise<void> {
    await this.pool.query(
      `update forward_returns
       set base_ts = $5,
           base_price_usd = $6,
           future_ts = $7,
           future_price_usd = $8,
           return_pct = $9,
           max_return_pct = $10,
           min_return_pct = $11,
           status = $12,
           computed_at = now(),
           attempt_count = attempt_count + 1,
           last_attempt_at = now(),
           error_message = $13,
            payload = jsonb_set(coalesce(payload, '{}'::jsonb), '{labeler}', $15::jsonb, true)
        where event_id = $1
          and event_received_at = $2
          and coin = $3
          and horizon_minutes = $4
          and (($14::uuid is not null and entry_id = $14::uuid) or ($14::uuid is null and entry_id is null))`,
      [
        row.event_id,
        normalizeDbDate(row.event_received_at),
        row.coin,
        row.horizon_minutes,
        update.baseTs,
        update.basePrice,
        update.futureTs,
        update.futurePrice,
        update.returnPct,
        update.maxReturnPct,
        update.minReturnPct,
        update.status,
        update.errorMessage,
        row.entry_id,
        JSON.stringify({ updatedAt: new Date().toISOString(), entryId: row.entry_id })
      ]
    );
  }
}

function normalizeExchange(value: string | null): string {
  const normalized = value?.toLowerCase().replace(/\s+/gu, '') ?? '';
  if (normalized.includes('bybit')) return 'bybit';
  if (normalized.includes('okx')) return 'okx';
  if (normalized.includes('coinbase')) return 'coinbase';
  return 'binance';
}

function normalizeMarket(value: string | null): string {
  if (value === 'perpetual' || value === 'spot') return value;
  if (value === 'futures') return 'perpetual';
  return 'spot';
}

function normalizeSymbol(row: DueForwardReturnRow): string {
  return (row.symbol || `${row.base_asset ?? row.coin}USDT`).toUpperCase();
}

function normalizeDbDate(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

async function rollbackQuietly(client: PoolClient): Promise<void> {
  try {
    await client.query('rollback');
  } catch {
    // Preserve the original write error.
  }
}
