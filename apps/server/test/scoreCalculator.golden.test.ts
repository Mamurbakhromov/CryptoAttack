import { describe, expect, it } from 'vitest';

import { defaultScoreConfig } from '../src/scoring/defaultScoreConfig.js';
import { calculateScores } from '../src/scoring/scoreEngine.js';
import type { ScoreSourceRow } from '../src/scoring/types.js';

const now = '2026-01-01T00:15:00.000Z';
const config = { ...defaultScoreConfig, version: 'golden-v1' };

describe('score engine golden scenarios', () => {
  it('scores a strong bull scenario with diverse confirmation', () => {
    const score = scoreFor('BTC', [
      row('BTC', 'all_spot_top_buy_5m', { amountUsd: 2_000_000, buyUsd: 2_000_000, sellUsd: 500_000, buySellRatio: 4, volume24hUsd: 250_000_000, exchange: 'Binance', minutesAgo: 1 }),
      row('BTC', 'all_derivatives_top_buy_5m', { deltaUsd: 1_500_000, exchange: 'Bybit', minutesAgo: 2 }),
      row('BTC', 'pricealerts', { priceChangePercent: 6, exchange: 'Binance', minutesAgo: 1 }),
      row('BTC', 'volalerts', { priceChangePercent: 4, exchange: 'OKX', minutesAgo: 3 }),
      row('BTC', 'top_oi_gainers_60m', { percent: 18, priceChangePercent: 2, exchange: 'Binance', minutesAgo: 4 })
    ]);

    expect(score.bullScore).toBeGreaterThan(60);
    expect(score.bearScore).toBeLessThan(5);
    expect(score.netScore).toBeGreaterThan(55);
    expect(score.confidenceScore).toBeGreaterThan(70);
    expect(score.evidence.map((item) => item.ruleKey)).toEqual(expect.arrayContaining(['spot_buy_pressure', 'derivatives_buy_pressure', 'price_alert_up', 'volume_alert_up']));
  });

  it('scores a strong bear scenario with negative catalysts', () => {
    const score = scoreFor('ETH', [
      row('ETH', 'all_spot_top_sell_5m', { amountUsd: 2_500_000, buyUsd: 400_000, sellUsd: 2_500_000, buySellRatio: 0.16, volume24hUsd: 300_000_000, exchange: 'Binance', minutesAgo: 1 }),
      row('ETH', 'all_derivatives_top_sell_5m', { deltaUsd: 2_000_000, exchange: 'Bybit', minutesAgo: 2 }),
      row('ETH', 'pricealerts', { priceChangePercent: -7, exchange: 'OKX', minutesAgo: 2 }),
      row('ETH', 'top_oi_losers_60m', { percent: 14, priceChangePercent: -3, exchange: 'Binance', minutesAgo: 5 }),
      row('ETH', 'delistings', { source: 'event', minutesAgo: 3 })
    ]);

    expect(score.bearScore).toBeGreaterThan(68);
    expect(score.bullScore).toBeLessThan(5);
    expect(score.netScore).toBeLessThan(-65);
    expect(score.confidenceScore).toBeGreaterThan(70);
    expect(score.evidence.map((item) => item.ruleKey)).toContain('delisting');
  });

  it('reduces confidence for mixed conflicting evidence', () => {
    const bull = scoreFor('SOL', [
      row('SOL', 'all_spot_top_buy_5m', { amountUsd: 2_000_000, exchange: 'Binance', minutesAgo: 1 }),
      row('SOL', 'pricealerts', { priceChangePercent: 5, exchange: 'Bybit', minutesAgo: 2 })
    ]);
    const mixed = scoreFor('SOL', [
      row('SOL', 'all_spot_top_buy_5m', { amountUsd: 2_000_000, exchange: 'Binance', minutesAgo: 1 }),
      row('SOL', 'pricealerts', { priceChangePercent: 5, exchange: 'Bybit', minutesAgo: 2 }),
      row('SOL', 'all_spot_top_sell_5m', { amountUsd: 2_200_000, exchange: 'OKX', minutesAgo: 1 }),
      row('SOL', 'pricealerts', { priceChangePercent: -4, exchange: 'Binance', minutesAgo: 3 })
    ]);

    expect(mixed.bullScore).toBeGreaterThan(25);
    expect(mixed.bearScore).toBeGreaterThan(25);
    expect(mixed.marketRegime).toBe('conflicted');
    expect(mixed.confidenceScore).toBeLessThan(bull.confidenceScore);
  });

  it('uses buy/sell imbalance so neutral large spot flow scores below smaller dominant buying', () => {
    const neutralLargeCap = scoreFor('BTC', [row('BTC', 'all_spot_top_buy_5m', { amountUsd: 10_000_000, buyUsd: 10_000_000, sellUsd: 9_500_000, buySellRatio: 1.05, volume24hUsd: 20_000_000_000, minutesAgo: 1 })]);
    const dominantMidLiquidity = scoreFor('HYPE', [row('HYPE', 'all_spot_top_buy_5m', { amountUsd: 2_000_000, buyUsd: 2_000_000, sellUsd: 666_667, buySellRatio: 3, volume24hUsd: 300_000_000, minutesAgo: 1 })]);
    const neutralContribution = contributionFor(neutralLargeCap, 'spot_buy_pressure');
    const dominantContribution = contributionFor(dominantMidLiquidity, 'spot_buy_pressure');

    expect(neutralContribution).toBeLessThan(2);
    expect(dominantContribution).toBeGreaterThan(12);
    expect(dominantContribution).toBeGreaterThan(neutralContribution * 8);
    expect(dominantMidLiquidity.bullScore).toBeGreaterThan(neutralLargeCap.bullScore);
  });

  it('caps high B/S spot buys when liquidity and amount are tiny', () => {
    const thinLiquidity = scoreFor('MICRO', [row('MICRO', 'all_spot_top_buy_5m', { amountUsd: 5_000, buyUsd: 5_000, sellUsd: 500, buySellRatio: 10, volume24hUsd: 100_000, minutesAgo: 1 })]);
    const strongLiquid = scoreFor('HYPE', [row('HYPE', 'all_spot_top_buy_5m', { amountUsd: 2_000_000, buyUsd: 2_000_000, sellUsd: 500_000, buySellRatio: 4, volume24hUsd: 300_000_000, minutesAgo: 1 })]);
    const thinContribution = contributionFor(thinLiquidity, 'spot_buy_pressure');
    const strongContribution = contributionFor(strongLiquid, 'spot_buy_pressure');

    expect(thinContribution).toBeLessThan(5);
    expect(strongContribution).toBeGreaterThan(12);
  });

  it('uses sell/buy imbalance symmetrically for spot sell pressure', () => {
    const neutralLargeSell = scoreFor('BTC', [row('BTC', 'all_spot_top_sell_5m', { amountUsd: 10_000_000, buyUsd: 9_500_000, sellUsd: 10_000_000, buySellRatio: 0.95, volume24hUsd: 20_000_000_000, minutesAgo: 1 })]);
    const dominantSell = scoreFor('ARB', [row('ARB', 'all_spot_top_sell_5m', { amountUsd: 2_000_000, buyUsd: 500_000, sellUsd: 2_000_000, buySellRatio: 0.25, volume24hUsd: 300_000_000, minutesAgo: 1 })]);

    expect(contributionFor(neutralLargeSell, 'spot_sell_pressure')).toBeLessThan(2);
    expect(contributionFor(dominantSell, 'spot_sell_pressure')).toBeGreaterThan(12);
    expect(dominantSell.bearScore).toBeGreaterThan(neutralLargeSell.bearScore);
  });

  it('applies exact half-life decay to stale evidence contribution', () => {
    const fresh = scoreFor('AVAX', [row('AVAX', 'pricealerts', { priceChangePercent: 2, minutesAgo: 0 })]);
    const decayed = scoreFor('AVAX', [row('AVAX', 'pricealerts', { priceChangePercent: 2, minutesAgo: 7.5 })]);

    const freshContribution = fresh.evidence.find((item) => item.ruleKey === 'price_alert_up')?.contribution ?? 0;
    const decayedContribution = decayed.evidence.find((item) => item.ruleKey === 'price_alert_up')?.contribution ?? 0;

    expect(decayedContribution).toBeCloseTo(freshContribution / 2, 4);
    expect(decayed.confidenceScore).toBeLessThan(fresh.confidenceScore);
  });

  it('keeps parser-needs-sample evidence low confidence', () => {
    const score = scoreFor('SUI', [row('SUI', 'pricealerts', { priceChangePercent: 1, parserStatus: 'parser_needs_sample', minutesAgo: 20 })]);

    expect(score.bullScore).toBeGreaterThan(0);
    expect(score.confidenceScore).toBeLessThan(35);
  });

  it('caps repeated alert bursts while surfacing burst evidence', () => {
    const rows = Array.from({ length: 6 }, (_, index) => row('DOGE', 'pricealerts', { id: `burst-${index}`, priceChangePercent: 3, minutesAgo: index * 0.5 }));
    const score = scoreFor('DOGE', rows);

    expect(score.evidence.some((item) => item.ruleKey === 'price_alert_up_burst')).toBe(true);
    expect(score.bullScore).toBeLessThan(80);
    expect(score.confidenceScore).toBeLessThan(85);
  });

  it('treats overheated positive funding as bearish risk evidence', () => {
    const score = scoreFor('BNB', [row('BNB', 'top_funding', { percent: 0.18, exchange: 'Binance', minutesAgo: 1 })]);

    expect(score.bearScore).toBeGreaterThan(0);
    expect(score.bullScore).toBe(0);
    expect(score.evidence[0]).toMatchObject({ side: 'risk', ruleKey: 'positive_funding_overheated' });
  });
});

function scoreFor(coin: string, rows: ScoreSourceRow[]) {
  const result = calculateScores({ config, asOf: now, coins: [coin], sourceRows: rows, windowsMinutes: [15] })[0];
  if (!result) throw new Error('Expected score result');
  return result;
}

function contributionFor(score: ReturnType<typeof scoreFor>, ruleKey: string): number {
  return score.evidence.find((item) => item.ruleKey === ruleKey)?.contribution ?? 0;
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
  if (feedKey.includes('flows')) return 'outflow';
  return null;
}
