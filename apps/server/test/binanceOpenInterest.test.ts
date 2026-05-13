import { describe, expect, it } from 'vitest';

import { buildBinanceOpenInterestResponse, calculateOpenInterestChangePercent, parseBinanceOpenInterestHistory } from '../src/binance/openInterest.js';

describe('Binance open interest helpers', () => {
  it('parses history rows and calculates 15m and 30m OI changes', () => {
    const points = parseBinanceOpenInterestHistory([
      row('BTCUSDT', 0, '100', '1000'),
      row('BTCUSDT', 15 * 60_000, '110', '1100'),
      row('BTCUSDT', 30 * 60_000, '120', '1200')
    ]);

    expect(points).toHaveLength(3);
    expect(calculateOpenInterestChangePercent(points, 15)).toBeCloseTo(9.09, 2);
    expect(calculateOpenInterestChangePercent(points, 30)).toBeCloseTo(20, 2);

    const response = buildBinanceOpenInterestResponse({
      symbol: 'BTCUSDT',
      period: '5m',
      requestedEndTimeMs: 30 * 60_000,
      currentOpenInterest: 125,
      currentOpenInterestTime: '1970-01-01T00:31:00.000Z',
      points
    });

    expect(response.coin).toBe('BTC');
    expect(response.latest?.sumOpenInterest).toBe(120);
    expect(response.change15mPercent).toBeCloseTo(9.09, 2);
    expect(response.change30mPercent).toBeCloseTo(20, 2);
  });

  it('ignores malformed history rows', () => {
    const points = parseBinanceOpenInterestHistory([
      false,
      { symbol: 'BTCUSDT', timestamp: 'not-a-time', sumOpenInterest: '100' },
      row('ETHUSDT', 60_000, '200', '3000')
    ]);

    expect(points).toHaveLength(1);
    expect(points[0]?.symbol).toBe('ETHUSDT');
  });
});

function row(symbol: string, timestamp: number, sumOpenInterest: string, sumOpenInterestValue: string): object {
  return { symbol, timestamp, sumOpenInterest, sumOpenInterestValue };
}
