import { describe, expect, it } from 'vitest';

import { normalizeCryptoAttackEvent } from '../src/events/normalizer.js';
import { buildAmountMetric, isBuy5mTopEvent, isOiGainerEvent, parseRankedRows, parseTotalUsdAmount, parseUsdAmount, sanitizeHtmlText, stripHtml } from '../src/events/parsers.js';

describe('parser fallback behavior', () => {
  it('routes buy 5m top events without inventing amount metrics when entries cannot be parsed', () => {
    const events = normalizeCryptoAttackEvent(
      {
        chapter: 'cex_alerts',
        category: 'all_spot_top',
        texts: ['Market participants are buying aggressively in 5m, but this payload format is unknown.'],
        filters: ['buy', '5m'],
        coins: false,
        id: 'fallback-sample'
      },
      { receivedAtMs: Date.parse('2026-01-01T00:00:01.000Z') }
    );

    expect(events.map((event) => event.feedKey)).toEqual(['all_spot_top_buy_5m']);
    expect(events[0]?.parserStatus).toBe('parser_needs_sample');
    expect(events[0]?.plainText).toContain('payload format is unknown');
  });

  it('sanitizes unsafe HTML while preserving safe links', () => {
    const html = sanitizeHtmlText([
      'Listing <script>alert(1)</script> <a href="https://example.com/path">Source</a> <a href="javascript:alert(1)">bad</a>'
    ]);

    expect(html).not.toContain('<script>');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('href="https://example.com/path"');
    expect(html).toContain('Source');
  });

  it('strips HTML tags for plain text', () => {
    expect(stripHtml('OKX <b>listing</b> <a href="https://example.com">Source</a>')).toBe('OKX listing Source');
  });

  it('decodes provider percent escapes without breaking normal percent signs', () => {
    expect(stripHtml('%23BTC%20buy%3A%20%24123%0Adelta%3A%200.5%25')).toBe('#BTC buy: $123\ndelta: 0.5%');
    expect(stripHtml('#BTC buy: $123 delta: 0.5%')).toBe('#BTC buy: $123 delta: 0.5%');
  });

  it('parses ranked rows and USD amount formats conservatively', () => {
    expect(parseUsdAmount('$123')).toBe(123);
    expect(parseUsdAmount('$123,456')).toBe(123_456);
    expect(parseUsdAmount('$1.2M')).toBe(1_200_000);
    expect(parseUsdAmount('1.2M')).toBe(1_200_000);
    expect(parseUsdAmount('2.5M')).toBe(2_500_000);
    expect(parseUsdAmount('$2.5B')).toBe(2_500_000_000);

    const rows = parseRankedRows('1. #BTC buy $1.2M +2%\n2. $ETH purchases 500K +1%', 'buy');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ rank: 1, coin: 'BTC', amountUsd: 1_200_000 });
    expect(rows[1]).toMatchObject({ rank: 2, coin: 'ETH', amountUsd: 500_000 });
    expect(parseTotalUsdAmount('', rows)).toBe(1_700_000);
  });

  it('parses provider hashtag coin rows separated by encoded line breaks', () => {
    const rows = parseRankedRows(
      '📊🔫 Top 10 Buying coins on all derivatives in the last 5 minutes (amount) #TopCEXad%0A#BTC buy: $26251549 sell: $19628254%0Adelta: $6623295 (0,026%, Vol24: 26B)%0A#ETH buy: $3331449 sell: $2277471%0Adelta: $1053978',
      'buy'
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ coin: 'BTC', amountUsd: 26_251_549 });
    expect(rows[0]).toMatchObject({ buyUsd: 26_251_549, sellUsd: 19_628_254, deltaUsd: 6_623_295 });
    expect(rows[0]?.volume24hUsd).toBe(26_000_000_000);
    expect(rows[0]?.percent).toBeCloseTo(0.026, 3);
    expect(rows[0]?.buySellRatio).toBeCloseTo(1.34, 2);
    expect(rows[0]?.rawLine).toContain('delta: $6623295');
    expect(rows[1]).toMatchObject({ coin: 'ETH', amountUsd: 3_331_449 });
    expect(rows[1]).toMatchObject({ buyUsd: 3_331_449, sellUsd: 2_277_471, deltaUsd: 1_053_978 });
    expect(rows[1]?.buySellRatio).toBeCloseTo(1.46, 2);
  });

  it('parses buy/sell amounts and ratio when provider does not send a percent', () => {
    const buyRows = parseRankedRows('#BTC buy: $5590597 sell: $4889157\n#HYPE buy: $4445330 sell: $956166', 'buy');
    expect(buyRows[0]).toMatchObject({ coin: 'BTC', amountUsd: 5_590_597, direction: 'buy' });
    expect(buyRows[0]).toMatchObject({ buyUsd: 5_590_597, sellUsd: 4_889_157, deltaUsd: 701_440 });
    expect(buyRows[0]?.buySellRatio).toBeCloseTo(1.14, 2);
    expect(buyRows[0]?.percent).toBeNull();
    expect(buyRows[1]?.buySellRatio).toBeCloseTo(4.65, 2);

    const sellRows = parseRankedRows('#BTC buy: $100 sell: $300', 'sell');
    expect(sellRows[0]).toMatchObject({ coin: 'BTC', amountUsd: 300, direction: 'sell' });
    expect(sellRows[0]).toMatchObject({ buyUsd: 100, sellUsd: 300, deltaUsd: 200 });
    expect(sellRows[0]?.buySellRatio).toBeCloseTo(0.33, 2);
  });

  it('builds amount metrics from explicit totals or parsed entries', () => {
    const rows = parseRankedRows('#BTC buy: $5590597 sell: $4889157\n#HYPE buy: $4445330 sell: $956166', 'buy');
    const fromRows = buildAmountMetric('all_spot_per', rows, '');
    const fromTotal = buildAmountMetric('all_derivatives_per', rows, 'All derivatives amount\nTotal amount: $12.5M');

    expect(fromRows).toMatchObject({ status: 'ok', totalUsd: 10_035_927, sourceFeedKey: 'all_spot_per', entryCount: 2 });
    expect(fromTotal).toMatchObject({ status: 'ok', totalUsd: 12_500_000, sourceFeedKey: 'all_derivatives_per', entryCount: 2 });
  });

  it('parses OI rows with exchange, OI change, price, and price change', () => {
    const rows = parseRankedRows(
      '📈📊 Top 10 OI Gainers (1h) #OpenInterest #TopGainers\n#ORDI Bybit OI Change (1h): 52.82% Price: 3.297 (-1.61%)\n#TST Hyperliquid OI Change (1h): 42.73% Price: 0.0117 (5.65%)',
      'gainer'
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      coin: 'ORDI',
      exchange: 'BYBIT',
      percent: 52.82,
      priceUsd: 3.297,
      priceChangePercent: -1.61,
      direction: 'gainer'
    });
    expect(rows[1]).toMatchObject({ exchange: 'HYPERLIQUID', priceUsd: 0.0117, priceChangePercent: 5.65 });
  });

  it('does not throw on unknown ranked row text', () => {
    expect(() => parseRankedRows('unknown text with no market rows')).not.toThrow();
    expect(parseRankedRows('unknown text with no market rows')).toEqual([]);
  });

  it('rejects non-buy or non-5m top events', () => {
    expect(isBuy5mTopEvent(['sell', '5m'], 'Top selling coins 5m')).toBe(false);
    expect(isBuy5mTopEvent(['buy'], 'Top buying coins without interval')).toBe(false);
  });

  it('rejects OI loser events as gainers', () => {
    expect(isOiGainerEvent(['losers'], 'Top OI losers decrease')).toBe(false);
  });
});
