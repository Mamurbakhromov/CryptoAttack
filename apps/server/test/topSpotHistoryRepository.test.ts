import { describe, expect, it, vi } from 'vitest';

import { TopSpotHistoryRepository, topSpotFeedKey } from '../src/db/topSpotHistoryRepository.js';

const from = '2026-01-01T05:04:00.000Z';
const to = '2026-01-01T06:04:00.000Z';

describe('TopSpotHistoryRepository', () => {
  it('groups fixed-window top spot feed history into normalized events per feed', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        makeFeedRow({ event_id: 'event-new', event_received_at: '2026-01-01T05:59:00.000Z', coin: 'ETH', rank: 2, raw_line: '#2 ETH' }),
        makeFeedRow({ event_id: 'event-new', event_received_at: '2026-01-01T05:59:00.000Z', coin: 'BTC', rank: 1, raw_line: '#1 BTC' }),
        makeFeedRow({ event_id: 'event-old', event_received_at: '2026-01-01T05:10:00.000Z', coin: 'SOL', rank: 1, raw_line: '#1 SOL' })
      ]
    });
    const repository = new TopSpotHistoryRepository({ query } as never);

    const response = await repository.getTopSpotFeedHistory({ from, to });

    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('ne.received_at >= $2'), [
      ['all_spot_top_buy_5m', 'all_spot_top_sell_5m', 'all_derivatives_top_buy_5m', 'all_derivatives_top_sell_5m'],
      from,
      to
    ]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('ne.received_at < $3'), expect.any(Array));
    expect(response).toMatchObject({
      enabled: true,
      from,
      to,
      summary: { eventCount: 2, entryCount: 3 }
    });
    expect(response.feeds.all_spot_top_buy_5m.latest).toMatchObject({
      id: 'event-new',
      feedKey: 'all_spot_top_buy_5m',
      receivedAt: '2026-01-01T05:59:00.000Z',
      entries: [
        { coin: 'BTC', rank: 1, rawLine: '#1 BTC' },
        { coin: 'ETH', rank: 2, rawLine: '#2 ETH' }
      ]
    });
    expect(response.feeds.all_spot_top_buy_5m.events.map((event) => event.id)).toEqual(['event-new', 'event-old']);
    expect(response.feeds.all_spot_top_sell_5m.events).toEqual([]);
  });

  it('queries only the requested coin and feed keys inside a non-overlapping fixed window', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [makeRow({ feed_key: 'all_spot_top_buy_5m', received_at: new Date('2026-01-01T05:59:00.000Z') })] })
      .mockResolvedValueOnce({ rows: [makeRow({ feed_key: 'all_spot_top_sell_5m', buy_sell_ratio: 0.4, raw_line: '#BTC sell' })] });
    const repository = new TopSpotHistoryRepository({ query } as never);

    const response = await repository.getTopSpotHistory({ coin: 'btc', from, to, market: 'spot', side: 'buy' });

    expect(query).toHaveBeenCalledTimes(2);
    expect(query).toHaveBeenNthCalledWith(1, expect.stringContaining('ee.received_at >= $3'), ['BTC', 'all_spot_top_buy_5m', from, to, null]);
    expect(query).toHaveBeenNthCalledWith(1, expect.stringContaining('ee.received_at < $4'), ['BTC', 'all_spot_top_buy_5m', from, to, null]);
    expect(query).toHaveBeenNthCalledWith(1, expect.stringContaining('order by ee.received_at desc'), ['BTC', 'all_spot_top_buy_5m', from, to, null]);
    expect(query).toHaveBeenNthCalledWith(2, expect.any(String), ['BTC', 'all_spot_top_sell_5m', from, to, null]);
    expect(response).toMatchObject({
      enabled: true,
      coin: 'BTC',
      from,
      to,
      market: 'spot',
      side: 'buy',
      primaryFeedKey: 'all_spot_top_buy_5m',
      comparisonFeedKey: 'all_spot_top_sell_5m',
      summary: { primaryHitCount: 1, comparisonHitCount: 1, latestPrimaryRatio: 2.5, primaryAverage3: 2.5 }
    });
    expect(response.hits[0]).toMatchObject({
      eventId: 'event-1',
      receivedAt: '2026-01-01T05:59:00.000Z',
      feedKey: 'all_spot_top_buy_5m',
      coin: 'BTC',
      buyUsd: 2_500_000,
      sellUsd: 1_000_000,
      buySellRatio: 2.5,
      rawLine: '#BTC buy'
    });
    expect(response.comparisonHits[0]).toMatchObject({ feedKey: 'all_spot_top_sell_5m', buySellRatio: 0.4 });
  });

  it('maps each market and side to the correct primary feed', () => {
    expect(topSpotFeedKey('spot', 'buy')).toBe('all_spot_top_buy_5m');
    expect(topSpotFeedKey('spot', 'sell')).toBe('all_spot_top_sell_5m');
    expect(topSpotFeedKey('perpetual', 'buy')).toBe('all_derivatives_top_buy_5m');
    expect(topSpotFeedKey('perpetual', 'sell')).toBe('all_derivatives_top_sell_5m');
  });

  it('groups fixed-window top OI feed history into gainers and losers', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        makeFeedRow({ event_id: 'oi-gainer-new', feed_key: 'top_oi_gainers_60m', coin: 'BTC', direction: 'gainer', percent: '8.4', price_change_percent: '1.2' }),
        makeFeedRow({ event_id: 'oi-loser-new', feed_key: 'top_oi_losers_60m', coin: 'ETH', direction: 'loser', percent: '-5.5', price_change_percent: '-0.8' })
      ]
    });
    const repository = new TopSpotHistoryRepository({ query } as never);

    const response = await repository.getTopOiFeedHistory({ from, to });

    expect(query).toHaveBeenCalledWith(expect.stringContaining('ne.feed_key = any($1::text[])'), [
      ['top_oi_gainers_60m', 'top_oi_losers_60m'],
      from,
      to
    ]);
    expect(response.feeds.top_oi_gainers_60m.latest?.entries[0]).toMatchObject({ coin: 'BTC', direction: 'gainer', percent: 8.4 });
    expect(response.feeds.top_oi_losers_60m.latest?.entries[0]).toMatchObject({ coin: 'ETH', direction: 'loser', percent: -5.5 });
    expect(response.summary).toMatchObject({ eventCount: 2, entryCount: 2 });
  });

  it('splits Bull/Bear percent feed history by market and direction', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        makeFeedRow({ event_id: 'spot-buy', feed_key: 'all_spot_per', coin: 'BTC', direction: 'buy', percent: '0.4' }),
        makeFeedRow({ event_id: 'spot-sell', feed_key: 'all_spot_per', coin: 'ETH', direction: 'sell', percent: '0.7', buy_sell_ratio: '0.5' }),
        makeFeedRow({ event_id: 'der-buy', feed_key: 'all_derivatives_per', coin: 'SOL', direction: 'buy', percent: '1.1' }),
        makeFeedRow({ event_id: 'der-sell', feed_key: 'all_derivatives_per', coin: 'XRP', direction: 'sell', percent: '0.9', buy_sell_ratio: '0.6' })
      ]
    });
    const repository = new TopSpotHistoryRepository({ query } as never);

    const response = await repository.getAmountsFeedHistory({ from, to });

    expect(query).toHaveBeenCalledWith(expect.any(String), [
      ['all_spot_per', 'all_derivatives_per'],
      from,
      to
    ]);
    expect(response.feeds.spot_buy.latest?.entries.map((entry) => entry.coin)).toEqual(['BTC']);
    expect(response.feeds.spot_sell.latest?.entries.map((entry) => entry.coin)).toEqual(['ETH']);
    expect(response.feeds.derivatives_buy.latest?.entries.map((entry) => entry.coin)).toEqual(['SOL']);
    expect(response.feeds.derivatives_sell.latest?.entries.map((entry) => entry.coin)).toEqual(['XRP']);
  });

  it('filters Bull/Bear percent coin history by feed key and direction', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [makeRow({ feed_key: 'all_spot_per', direction: 'buy', received_at: new Date('2026-01-01T05:40:00.000Z') })] })
      .mockResolvedValueOnce({ rows: [makeRow({ feed_key: 'all_spot_per', direction: 'sell', buy_sell_ratio: '0.5', raw_line: '#BTC percent sell' })] });
    const repository = new TopSpotHistoryRepository({ query } as never);

    const response = await repository.getAmountsHistory({ coin: 'btc', from, to, market: 'spot', side: 'buy' });

    expect(query).toHaveBeenNthCalledWith(1, expect.stringContaining('and ee.direction = coalesce($5::text, ee.direction)'), ['BTC', 'all_spot_per', from, to, 'buy']);
    expect(query).toHaveBeenNthCalledWith(2, expect.any(String), ['BTC', 'all_spot_per', from, to, 'sell']);
    expect(response).toMatchObject({
      enabled: true,
      coin: 'BTC',
      market: 'spot',
      side: 'buy',
      primaryFeedKey: 'spot_buy',
      comparisonFeedKey: 'spot_sell',
      summary: { primaryHitCount: 1, comparisonHitCount: 1 }
    });
  });
});

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    event_id: 'event-1',
    received_at: '2026-01-01T05:30:00.000Z',
    feed_key: 'all_spot_top_buy_5m',
    rank: 1,
    coin: 'btc',
    exchange: 'Binance Spot',
    buy_usd: '2500000',
    sell_usd: '1000000',
    delta_usd: '1500000',
    buy_sell_ratio: '2.5',
    percent: '12.5',
    volume_24h_usd: '100000000',
    raw_line: '#BTC buy',
    ...overrides
  };
}

function makeFeedRow(overrides: Record<string, unknown> = {}) {
  return {
    event_id: 'event-new',
    event_received_at: '2026-01-01T05:30:00.000Z',
    feed_key: 'all_spot_top_buy_5m',
    chapter: 'cex_alerts',
    category: 'all_spot_top',
    title: 'Top 10 Spot Buyers 5m',
    plain_text: 'Top 10 Spot Buyers 5m',
    html_text: 'Top 10 Spot Buyers 5m',
    coins: ['BTC'],
    filters: ['buy', '5m'],
    event_timestamp: '2026-01-01T05:30:00.000Z',
    source_time_ms: 1_767_246_600_000,
    latency_ms: 25,
    severity: 'info',
    endpoint: 'main',
    parser_status: 'parsed',
    amount_metric: null,
    rank: 1,
    coin: 'BTC',
    pair: 'BTCUSDT',
    exchange: 'Binance Spot',
    market: 'spot',
    direction: 'buy',
    interval_label: '5m',
    amount_usd: '2500000',
    amount_asset: null,
    buy_usd: '2500000',
    sell_usd: '1000000',
    delta_usd: '1500000',
    buy_sell_ratio: '2.5',
    volume_24h_usd: '100000000',
    volume_24h_asset: null,
    percent: '12.5',
    price_usd: '42000',
    price_change_percent: '1.5',
    oi_change_15m_percent: null,
    oi_change_30m_percent: null,
    followup_price_change_percent: null,
    total_alerts: null,
    notified_at: null,
    threshold: null,
    href: null,
    raw_line: '#1 BTC',
    ...overrides
  };
}
