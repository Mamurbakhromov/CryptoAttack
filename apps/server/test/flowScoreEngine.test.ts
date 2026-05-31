import { describe, expect, it } from 'vitest';

import { scoreConfigForVersion } from '../src/scoring/defaultScoreConfig.js';
import { calculateScores } from '../src/scoring/scoreEngine.js';
import type { ScoreSourceRow } from '../src/scoring/types.js';

const now = '2026-01-01T00:15:00.000Z';
const config = scoreConfigForVersion('flow-v2');

describe('flow-v2 intraday scoring', () => {
  it('scores spot top and spot percent as one capped family with 1h hit weight', () => {
    const score = scoreFor('HYPE', [
      row('HYPE', 'all_spot_top_buy_5m', { id: 'spot-1', rank: 2, buyUsd: 2_000_000, sellUsd: 500_000, deltaUsd: 1_500_000, amountUsd: 2_000_000, volume24hUsd: 50_000_000, minutesAgo: 0 }),
      row('HYPE', 'all_spot_per', { id: 'spot-2', rank: 3, buyUsd: 1_800_000, sellUsd: 450_000, deltaUsd: 1_350_000, amountUsd: 1_800_000, volume24hUsd: 50_000_000, direction: 'buy', minutesAgo: 10 }),
      row('HYPE', 'all_spot_top_buy_5m', { id: 'spot-3', rank: 4, buyUsd: 1_500_000, sellUsd: 375_000, deltaUsd: 1_125_000, amountUsd: 1_500_000, volume24hUsd: 50_000_000, minutesAgo: 20 }),
      row('HYPE', 'all_spot_per', { id: 'spot-4', rank: 5, buyUsd: 1_200_000, sellUsd: 300_000, deltaUsd: 900_000, amountUsd: 1_200_000, volume24hUsd: 50_000_000, direction: 'buy', minutesAgo: 40 })
    ]);

    expect(component(score, 'spot', 'bull')).toBeCloseTo(37.52, 2);
    expect(score.evidence.filter((item) => item.ruleKey === 'flow_spot_buy')).toHaveLength(1);
    expect(score.bullScore).toBeCloseTo(37.52, 2);
    expect(score.payload).toMatchObject({ rawMax: 100, bullRaw: 37.52 });
    expect(score.payload).toMatchObject({ scoreState: 'clean_bull', tradeAction: 'WATCH' });
  });

  it('exposes flow math details for the score popup', () => {
    const score = scoreFor('HYPE', [
      row('HYPE', 'all_spot_top_buy_5m', { id: 'spot-1', rank: 2, buyUsd: 2_000_000, sellUsd: 500_000, deltaUsd: 1_500_000, amountUsd: 2_000_000, volume24hUsd: 50_000_000, minutesAgo: 0 }),
      row('HYPE', 'all_spot_per', { id: 'spot-2', rank: 3, buyUsd: 1_800_000, sellUsd: 450_000, deltaUsd: 1_350_000, amountUsd: 1_800_000, volume24hUsd: 50_000_000, direction: 'buy', minutesAgo: 10 }),
      row('HYPE', 'all_spot_top_buy_5m', { id: 'spot-3', rank: 4, buyUsd: 1_500_000, sellUsd: 375_000, deltaUsd: 1_125_000, amountUsd: 1_500_000, volume24hUsd: 50_000_000, minutesAgo: 20 }),
      row('HYPE', 'all_spot_per', { id: 'spot-4', rank: 5, buyUsd: 1_200_000, sellUsd: 300_000, deltaUsd: 900_000, amountUsd: 1_200_000, volume24hUsd: 50_000_000, direction: 'buy', minutesAgo: 40 })
    ]);

    expect(flowDetail(score, 'spot', 'bull')).toMatchObject({
      score: 37.52,
      rawScore: 37.52,
      rawBeforeCap: 37.52,
      volumeCap: 41,
      activityCap: 41,
      hitPoints: 4.8,
      subpoints: {
        dominance: 4,
        dominancePoints: 19.43,
        relativeImpact: 3,
        relativeImpactPoints: 7.54,
        deltaPoints: 3.5,
        rankPoints: 2.25,
        hitPoints: 4.8
      }
    });
  });

  it('prevents big-cap delta from overpowering weak B/S and small relative impact', () => {
    const score = scoreFor('BTC', [
      row('BTC', 'all_spot_top_buy_5m', { rank: 1, buyUsd: 10_000_000, sellUsd: 8_000_000, deltaUsd: 2_000_000, amountUsd: 10_000_000, volume24hUsd: 2_000_000_000, minutesAgo: 0 })
    ]);

    expect(component(score, 'spot', 'bull')).toBeCloseTo(12.26, 2);
    expect(score.bullScore).toBeCloseTo(12.26, 2);
  });

  it('caps extreme spot dominance when liquidity and activity are too thin', () => {
    const score = scoreFor('MICRO', [
      row('MICRO', 'all_spot_top_buy_5m', { rank: 1, buyUsd: 5_000, sellUsd: 500, deltaUsd: 4_500, amountUsd: 5_000, volume24hUsd: 100_000, minutesAgo: 0 })
    ]);

    expect(component(score, 'spot', 'bull')).toBe(6);
    expect(score.payload).toMatchObject({ scoreState: 'thin_liquidity', tradeAction: 'AVOID' });
    expect(score.payload.riskTags).toEqual(expect.arrayContaining(['thin_liquidity']));
  });

  it('discounts derivatives-only flow and heavily discounts opposite spot hedges', () => {
    const derivativesOnly = scoreFor('SOL', [
      row('SOL', 'all_derivatives_top_buy_5m', { rank: 2, buyUsd: 1_000_000, sellUsd: 250_000, deltaUsd: 750_000, amountUsd: 1_000_000, volume24hUsd: 100_000_000, minutesAgo: 0 })
    ]);
    const confirmed = scoreFor('SOL', [
      row('SOL', 'all_spot_top_buy_5m', { rank: 1, buyUsd: 700_000, sellUsd: 200_000, deltaUsd: 500_000, amountUsd: 700_000, volume24hUsd: 20_000_000, minutesAgo: 0 }),
      row('SOL', 'all_derivatives_top_buy_5m', { rank: 2, buyUsd: 1_000_000, sellUsd: 250_000, deltaUsd: 750_000, amountUsd: 1_000_000, volume24hUsd: 100_000_000, minutesAgo: 0 })
    ]);
    const hedged = scoreFor('SOL', [
      row('SOL', 'all_spot_top_sell_5m', { rank: 1, buyUsd: 200_000, sellUsd: 700_000, deltaUsd: 500_000, amountUsd: 700_000, volume24hUsd: 20_000_000, minutesAgo: 0 }),
      row('SOL', 'all_derivatives_top_buy_5m', { rank: 2, buyUsd: 1_000_000, sellUsd: 250_000, deltaUsd: 750_000, amountUsd: 1_000_000, volume24hUsd: 100_000_000, minutesAgo: 0 })
    ]);

    expect(component(derivativesOnly, 'derivatives', 'bull')).toBeCloseTo(13.28, 2);
    expect(derivativesOnly.payload).toMatchObject({ scoreState: 'derivatives_only_bull' });
    expect(component(confirmed, 'derivatives', 'bull')).toBeCloseTo(18.97, 2);
    expect(component(hedged, 'derivatives', 'bull')).toBeCloseTo(5.69, 2);
    expect(hedged.marketRegime).toBe('conflicted');
    expect(hedged.payload.riskTags).toEqual(expect.arrayContaining(['spot_derivatives_hedge']));
  });

  it('treats CryptoAttack top OI as sparse confirmation with no absence penalty', () => {
    const withoutOi = scoreFor('OP', []);
    const withOi = scoreFor('OP', [
      row('OP', 'top_oi_gainers_60m', { rank: 3, percent: 18, priceChangePercent: 2, direction: 'gainer', minutesAgo: 0 })
    ]);
    const conflictedOi = scoreFor('OP', [
      row('OP', 'top_oi_gainers_60m', { rank: 3, percent: 18, priceChangePercent: -2, direction: 'gainer', minutesAgo: 0 })
    ]);

    expect(component(withoutOi, 'topOi', 'bull')).toBe(0);
    expect(component(withOi, 'topOi', 'bull')).toBeCloseTo(9.40, 2);
    expect(withOi.bullScore).toBeCloseTo(9.40, 2);
    expect(component(conflictedOi, 'topOi', 'bull')).toBeCloseTo(5.90, 2);
    expect(conflictedOi.payload.riskTags).toEqual(expect.arrayContaining(['top_oi_price_conflict']));
  });

  it('scores big buying as lower-conviction standalone flow and confirms it with spot pressure', () => {
    const standalone = scoreFor('ARB', [
      row('ARB', 'cex_track', { id: 'big-1', amountUsd: 500_000, volume24hUsd: 50_000_000, direction: 'buy', minutesAgo: 0 }),
      row('ARB', 'cex_track', { id: 'big-2', amountUsd: 400_000, volume24hUsd: 50_000_000, direction: 'buy', minutesAgo: 20 })
    ]);
    const confirmed = scoreFor('ARB', [
      row('ARB', 'all_spot_top_buy_5m', { rank: 1, buyUsd: 700_000, sellUsd: 200_000, deltaUsd: 500_000, amountUsd: 700_000, volume24hUsd: 50_000_000, minutesAgo: 0 }),
      row('ARB', 'cex_track', { id: 'big-1', amountUsd: 500_000, volume24hUsd: 50_000_000, direction: 'buy', minutesAgo: 0 }),
      row('ARB', 'cex_track', { id: 'big-2', amountUsd: 400_000, volume24hUsd: 50_000_000, direction: 'buy', minutesAgo: 20 })
    ]);

    expect(component(standalone, 'bigActivity', 'bull')).toBeCloseTo(9.45, 2);
    expect(component(confirmed, 'bigActivity', 'bull')).toBeCloseTo(12.60, 2);
  });
});

function scoreFor(coin: string, rows: ScoreSourceRow[]) {
  const result = calculateScores({ config, asOf: now, coins: [coin], sourceRows: rows, windowsMinutes: [15] })[0];
  if (!result) throw new Error('Expected score result');
  return result;
}

function component(score: ReturnType<typeof scoreFor>, family: string, side: 'bull' | 'bear'): number {
  const payload = score.payload as { componentScores?: Record<string, Record<'bull' | 'bear', number>> };
  return payload.componentScores?.[family]?.[side] ?? 0;
}

function flowDetail(score: ReturnType<typeof scoreFor>, family: string, side: 'bull' | 'bear'): Record<string, unknown> {
  const payload = score.payload as { flowBreakdown?: Array<Record<string, unknown>> };
  const detail = payload.flowBreakdown?.find((item) => item.family === family && item.side === side);
  if (!detail) throw new Error(`Expected ${family} ${side} detail`);
  return detail;
}

function row(coin: string, feedKey: string, overrides: Partial<ScoreSourceRow> & { minutesAgo?: number; id?: string } = {}): ScoreSourceRow {
  const receivedAt = new Date(Date.parse(now) - (overrides.minutesAgo ?? 1) * 60_000).toISOString();
  const id = overrides.id ?? `${feedKey}-${coin}-${receivedAt}`;
  return {
    source: overrides.source ?? 'entry',
    eventId: id,
    eventReceivedAt: receivedAt,
    entryId: overrides.source === 'event' ? null : `${id}-entry`,
    feedKey,
    coin,
    parserStatus: overrides.parserStatus ?? 'parsed',
    receivedAt,
    rank: overrides.rank ?? 1,
    amountUsd: overrides.amountUsd ?? null,
    deltaUsd: overrides.deltaUsd ?? null,
    buyUsd: overrides.buyUsd ?? null,
    sellUsd: overrides.sellUsd ?? null,
    buySellRatio: overrides.buySellRatio ?? null,
    volume24hUsd: overrides.volume24hUsd ?? null,
    percent: overrides.percent ?? null,
    priceChangePercent: overrides.priceChangePercent ?? null,
    oiChange15mPercent: overrides.oiChange15mPercent ?? null,
    oiChange30mPercent: overrides.oiChange30mPercent ?? null,
    totalAlerts: overrides.totalAlerts ?? null,
    direction: overrides.direction ?? directionForFeed(feedKey),
    exchange: overrides.exchange ?? 'Binance',
    market: overrides.market ?? null,
    rawLine: overrides.rawLine ?? `${feedKey} ${coin}`
  };
}

function directionForFeed(feedKey: string): string | null {
  if (feedKey.includes('buy')) return 'buy';
  if (feedKey.includes('sell')) return 'sell';
  if (feedKey.includes('gainers')) return 'gainer';
  if (feedKey.includes('losers')) return 'loser';
  return null;
}
