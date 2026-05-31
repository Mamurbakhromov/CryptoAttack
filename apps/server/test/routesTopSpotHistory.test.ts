import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { loadConfig } from '../src/config.js';
import type { TopSpotHistoryHit, TopSpotHistoryRepository, TopSpotHistoryResponse } from '../src/db/topSpotHistoryRepository.js';
import { EventStore } from '../src/events/eventStore.js';
import { registerHttpRoutes } from '../src/http/routes.js';

const from = '2026-01-01T05:04:00.000Z';
const to = '2026-01-01T06:04:00.000Z';

describe('top spot history API routes', () => {
  it('returns fixed-window top spot feed history for all four top spot feeds', async () => {
    const repository = fakeTopSpotHistoryRepository({
      getTopSpotFeedHistory: vi.fn(async (query) => ({
        generatedAt: '2026-01-01T06:10:00.000Z',
        enabled: true,
        from: query.from,
        to: query.to,
        feeds: {
          all_spot_top_buy_5m: {
            events: [makeFeedEvent({ id: 'spot-buy-1', feedKey: 'all_spot_top_buy_5m' })],
            latest: makeFeedEvent({ id: 'spot-buy-1', feedKey: 'all_spot_top_buy_5m' })
          },
          all_spot_top_sell_5m: { events: [], latest: null },
          all_derivatives_top_buy_5m: { events: [], latest: null },
          all_derivatives_top_sell_5m: { events: [], latest: null }
        },
        summary: { eventCount: 1, entryCount: 1 }
      }))
    } as never);
    const app = Fastify({ logger: false });
    await registerHttpRoutes(app, makeDeps(repository));

    const response = await app.inject({
      method: 'GET',
      url: `/api/history/top-spot?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(repository.getTopSpotFeedHistory).toHaveBeenCalledWith({ from, to });
    expect(body).toMatchObject({
      enabled: true,
      from,
      to,
      feeds: {
        all_spot_top_buy_5m: {
          latest: { id: 'spot-buy-1', feedKey: 'all_spot_top_buy_5m', entries: [{ coin: 'BTC', rank: 1 }] }
        },
        all_spot_top_sell_5m: { events: [], latest: null }
      },
      summary: { eventCount: 1, entryCount: 1 }
    });
    await app.close();
  });

  it('returns disabled top spot feed history when storage is unavailable', async () => {
    const app = Fastify({ logger: false });
    await registerHttpRoutes(app, makeDeps(null));

    const response = await app.inject({
      method: 'GET',
      url: `/api/history/top-spot?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body).toMatchObject({
      enabled: false,
      state: 'disabled',
      reason: 'history_storage_unavailable',
      from,
      to,
      feeds: {
        all_spot_top_buy_5m: { events: [], latest: null },
        all_spot_top_sell_5m: { events: [], latest: null },
        all_derivatives_top_buy_5m: { events: [], latest: null },
        all_derivatives_top_sell_5m: { events: [], latest: null }
      }
    });
    await app.close();
  });

  it('returns top spot history for a normalized coin and selected source', async () => {
    const repository = fakeTopSpotHistoryRepository({
      getTopSpotHistory: vi.fn(async (query) => ({
        generatedAt: '2026-01-01T06:10:00.000Z',
        enabled: true,
        coin: query.coin,
        from: query.from,
        to: query.to,
        market: query.market,
        side: query.side,
        primaryFeedKey: 'all_spot_top_buy_5m',
        comparisonFeedKey: 'all_spot_top_sell_5m',
        hits: [makeHistoryHit({ feedKey: 'all_spot_top_buy_5m' })],
        comparisonHits: [makeHistoryHit({ feedKey: 'all_spot_top_sell_5m', buySellRatio: 0.4 })],
        summary: {
          primaryHitCount: 1,
          comparisonHitCount: 1,
          latestPrimaryRatio: 2.5,
          primaryAverage3: 2.5
        }
      } satisfies TopSpotHistoryResponse))
    });
    const app = Fastify({ logger: false });
    await registerHttpRoutes(app, makeDeps(repository));

    const response = await app.inject({
      method: 'GET',
      url: `/api/history/top-spot/btc?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&market=spot&side=buy`
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(repository.getTopSpotHistory).toHaveBeenCalledWith({ coin: 'BTC', from, to, market: 'spot', side: 'buy' });
    expect(body).toMatchObject({
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
    expect(body.hits[0]).toMatchObject({ coin: 'BTC', feedKey: 'all_spot_top_buy_5m', buySellRatio: 2.5 });
    expect(body.comparisonHits[0]).toMatchObject({ feedKey: 'all_spot_top_sell_5m' });
    await app.close();
  });

  it('returns a disabled history envelope when storage is unavailable', async () => {
    const app = Fastify({ logger: false });
    await registerHttpRoutes(app, makeDeps(null));

    const response = await app.inject({
      method: 'GET',
      url: `/api/history/top-spot/eth?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&market=perpetual&side=sell`
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body).toMatchObject({
      enabled: false,
      state: 'disabled',
      reason: 'history_storage_unavailable',
      coin: 'ETH',
      market: 'perpetual',
      side: 'sell',
      primaryFeedKey: 'all_derivatives_top_sell_5m',
      comparisonFeedKey: 'all_derivatives_top_buy_5m',
      hits: [],
      comparisonHits: []
    });
    await app.close();
  });

  it('rejects invalid coin, market, side, and date windows', async () => {
    const app = Fastify({ logger: false });
    await registerHttpRoutes(app, makeDeps(fakeTopSpotHistoryRepository()));

    const invalidCoin = await app.inject({
      method: 'GET',
      url: `/api/history/top-spot/btc%21?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&market=spot&side=buy`
    });
    const invalidMarket = await app.inject({
      method: 'GET',
      url: `/api/history/top-spot/btc?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&market=margin&side=buy`
    });
    const invalidSide = await app.inject({
      method: 'GET',
      url: `/api/history/top-spot/btc?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&market=spot&side=long`
    });
    const invalidWindow = await app.inject({
      method: 'GET',
      url: `/api/history/top-spot/btc?from=${encodeURIComponent(to)}&to=${encodeURIComponent(from)}&market=spot&side=buy`
    });

    expect(invalidCoin.statusCode).toBe(400);
    expect(invalidMarket.statusCode).toBe(400);
    expect(invalidSide.statusCode).toBe(400);
    expect(invalidWindow.statusCode).toBe(400);
    await app.close();
  });

  it('uses the same dashboard auth guard as the rest of the API', async () => {
    const app = Fastify({ logger: false });
    await registerHttpRoutes(app, makeDeps(fakeTopSpotHistoryRepository(), loadConfig({ DASHBOARD_AUTH_ENABLED: 'true', DASHBOARD_AUTH_TOKEN: 'secret' })));

    const unauthorized = await app.inject({
      method: 'GET',
      url: `/api/history/top-spot/btc?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&market=spot&side=buy`
    });
    const authorized = await app.inject({
      method: 'GET',
      url: `/api/history/top-spot/btc?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&market=spot&side=buy`,
      headers: { authorization: 'Bearer secret' }
    });

    expect(unauthorized.statusCode).toBe(401);
    expect(authorized.statusCode).toBe(200);
    await app.close();
  });

  it('returns fixed-window top OI feed history for gainers and losers', async () => {
    const repository = fakeTopSpotHistoryRepository({
      getTopOiFeedHistory: vi.fn(async (query) => ({
        generatedAt: '2026-01-01T06:10:00.000Z',
        enabled: true,
        from: query.from,
        to: query.to,
        feeds: {
          top_oi_gainers_60m: {
            events: [makeFeedEvent({ id: 'oi-gainer-1', feedKey: 'top_oi_gainers_60m', entries: [makeHistoryEntry({ direction: 'gainer', percent: 8.4 })] })],
            latest: makeFeedEvent({ id: 'oi-gainer-1', feedKey: 'top_oi_gainers_60m', entries: [makeHistoryEntry({ direction: 'gainer', percent: 8.4 })] })
          },
          top_oi_losers_60m: { events: [], latest: null }
        },
        summary: { eventCount: 1, entryCount: 1 }
      }))
    } as never);
    const app = Fastify({ logger: false });
    await registerHttpRoutes(app, makeDeps(repository));

    const response = await app.inject({
      method: 'GET',
      url: `/api/history/top-oi?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(repository.getTopOiFeedHistory).toHaveBeenCalledWith({ from, to });
    expect(body.feeds.top_oi_gainers_60m.latest.entries[0]).toMatchObject({ coin: 'BTC', direction: 'gainer', percent: 8.4 });
    await app.close();
  });

  it('returns Bull/Bear percent history as one grouped feed family', async () => {
    const repository = fakeTopSpotHistoryRepository({
      getAmountsFeedHistory: vi.fn(async (query) => ({
        generatedAt: '2026-01-01T06:10:00.000Z',
        enabled: true,
        from: query.from,
        to: query.to,
        feeds: {
          spot_buy: {
            events: [makeFeedEvent({ id: 'spot-buy-percent', feedKey: 'all_spot_per', entries: [makeHistoryEntry({ direction: 'buy', percent: 0.4 })] })],
            latest: makeFeedEvent({ id: 'spot-buy-percent', feedKey: 'all_spot_per', entries: [makeHistoryEntry({ direction: 'buy', percent: 0.4 })] })
          },
          spot_sell: { events: [], latest: null },
          derivatives_buy: { events: [], latest: null },
          derivatives_sell: { events: [], latest: null }
        },
        summary: { eventCount: 1, entryCount: 1 }
      }))
    } as never);
    const app = Fastify({ logger: false });
    await registerHttpRoutes(app, makeDeps(repository));

    const response = await app.inject({
      method: 'GET',
      url: `/api/history/amounts?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(repository.getAmountsFeedHistory).toHaveBeenCalledWith({ from, to });
    expect(body.feeds.spot_buy.latest.entries[0]).toMatchObject({ coin: 'BTC', direction: 'buy', percent: 0.4 });
    await app.close();
  });

  it('returns coin history for Top OI and Bull/Bear percent sections', async () => {
    const repository = fakeTopSpotHistoryRepository({
      getTopOiHistory: vi.fn(async (query) => ({
        generatedAt: '2026-01-01T06:10:00.000Z',
        enabled: true,
        coin: query.coin,
        from: query.from,
        to: query.to,
        side: query.side,
        primaryFeedKey: 'top_oi_gainers_60m',
        comparisonFeedKey: 'top_oi_losers_60m',
        hits: [makeHistoryHit({ feedKey: 'top_oi_gainers_60m', percent: 8.4 })],
        comparisonHits: [],
        summary: { primaryHitCount: 1, comparisonHitCount: 0, latestPrimaryRatio: null, primaryAverage3: null }
      })),
      getAmountsHistory: vi.fn(async (query) => ({
        generatedAt: '2026-01-01T06:10:00.000Z',
        enabled: true,
        coin: query.coin,
        from: query.from,
        to: query.to,
        market: query.market,
        side: query.side,
        primaryFeedKey: 'spot_buy',
        comparisonFeedKey: 'spot_sell',
        hits: [makeHistoryHit({ feedKey: 'all_spot_per', percent: 0.4 })],
        comparisonHits: [],
        summary: { primaryHitCount: 1, comparisonHitCount: 0, latestPrimaryRatio: 2.5, primaryAverage3: 2.5 }
      }))
    } as never);
    const app = Fastify({ logger: false });
    await registerHttpRoutes(app, makeDeps(repository));

    const topOi = await app.inject({
      method: 'GET',
      url: `/api/history/top-oi/btc?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&side=gainer`
    });
    const amounts = await app.inject({
      method: 'GET',
      url: `/api/history/amounts/btc?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&market=spot&side=buy`
    });

    expect(topOi.statusCode).toBe(200);
    expect(amounts.statusCode).toBe(200);
    expect(repository.getTopOiHistory).toHaveBeenCalledWith({ coin: 'BTC', from, to, side: 'gainer' });
    expect(repository.getAmountsHistory).toHaveBeenCalledWith({ coin: 'BTC', from, to, market: 'spot', side: 'buy' });
    await app.close();
  });
});

function makeDeps(topSpotHistoryRepository: TopSpotHistoryRepository | null = fakeTopSpotHistoryRepository(), config = loadConfig({})) {
  return {
    config,
    store: new EventStore({ bufferSize: 10, dedupeTtlMs: 60_000, mockMode: true, authEnabled: config.dashboardAuthEnabled }),
    sseHub: { handleStream: vi.fn() },
    symbolCache: { getSymbols: vi.fn(), refresh: vi.fn() },
    spotPerformance: { getPerformance: vi.fn() },
    topSpotHistoryRepository
  } as never;
}

function fakeTopSpotHistoryRepository(overrides: Partial<TopSpotHistoryRepository> = {}): TopSpotHistoryRepository {
  return {
    getTopSpotHistory: vi.fn(async () => ({
      generatedAt: '2026-01-01T06:10:00.000Z',
      enabled: true,
      coin: 'BTC',
      from,
      to,
      market: 'spot',
      side: 'buy',
      primaryFeedKey: 'all_spot_top_buy_5m',
      comparisonFeedKey: 'all_spot_top_sell_5m',
      hits: [],
      comparisonHits: [],
      summary: {
        primaryHitCount: 0,
        comparisonHitCount: 0,
        latestPrimaryRatio: null,
        primaryAverage3: null
      }
    } satisfies TopSpotHistoryResponse)),
    ...overrides
  } as unknown as TopSpotHistoryRepository;
}

function makeHistoryHit(overrides: Partial<TopSpotHistoryHit> = {}): TopSpotHistoryHit {
  return {
    eventId: 'event-1',
    receivedAt: '2026-01-01T05:30:00.000Z',
    feedKey: 'all_spot_top_buy_5m',
    rank: 1,
    coin: 'BTC',
    market: 'spot',
    direction: 'buy',
    exchange: 'Binance Spot',
    amountUsd: 2_500_000,
    buyUsd: 2_500_000,
    sellUsd: 1_000_000,
    deltaUsd: 1_500_000,
    buySellRatio: 2.5,
    percent: 12.5,
    priceUsd: 42_000,
    priceChangePercent: 1.5,
    oiChange15mPercent: null,
    oiChange30mPercent: null,
    volume24hUsd: 100_000_000,
    rawLine: '#BTC spot buy',
    ...overrides
  };
}

function makeFeedEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'spot-buy-1',
    feedKey: 'all_spot_top_buy_5m',
    chapter: 'cex_alerts',
    category: 'all_spot_top',
    title: 'Top 10 Spot Buyers 5m',
    plainText: 'Top 10 Spot Buyers 5m',
    htmlText: 'Top 10 Spot Buyers 5m',
    coins: ['BTC'],
    filters: ['buy', '5m'],
    timestamp: '2026-01-01T05:30:00.000Z',
    sourceTime: 1_767_246_600_000,
    receivedAt: '2026-01-01T05:30:00.000Z',
    latencyMs: 25,
    severity: 'info',
    raw: {},
    endpoint: 'main',
    entries: [makeHistoryEntry()],
    amountMetric: null,
    parserStatus: 'parsed',
    ...overrides
  };
}

function makeHistoryEntry(overrides: Record<string, unknown> = {}) {
  return {
    rank: 1,
    coin: 'BTC',
    pair: 'BTCUSDT',
    amountUsd: 2_500_000,
    buyUsd: 2_500_000,
    sellUsd: 1_000_000,
    deltaUsd: 1_500_000,
    buySellRatio: 2.5,
    volume24hUsd: 100_000_000,
    percent: 12.5,
    priceUsd: 42_000,
    priceChangePercent: 1.5,
    direction: 'buy',
    interval: '5m',
    exchange: 'Binance Spot',
    rawLine: '#BTC spot buy',
    ...overrides
  };
}
