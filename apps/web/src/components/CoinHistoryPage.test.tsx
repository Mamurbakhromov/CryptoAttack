import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CoinHistoryPage, getCurrentFeedHistoryWindow, getCurrentHistoryWindow } from './CoinHistoryPage';
import type { FeedKey, NormalizedEvent, TopSpotHistoryHit, TopSpotHistoryResponse } from '../types';

const apiMocks = vi.hoisted(() => ({
  fetchTopSpotHistory: vi.fn(),
  fetchTopSpotFeedHistory: vi.fn(),
  fetchTopOiHistory: vi.fn(),
  fetchTopOiFeedHistory: vi.fn(),
  fetchAmountsHistory: vi.fn(),
  fetchAmountsFeedHistory: vi.fn()
}));

vi.mock('../api/sse', () => ({
  fetchTopSpotHistory: apiMocks.fetchTopSpotHistory,
  fetchTopSpotFeedHistory: apiMocks.fetchTopSpotFeedHistory,
  fetchTopOiHistory: apiMocks.fetchTopOiHistory,
  fetchTopOiFeedHistory: apiMocks.fetchTopOiFeedHistory,
  fetchAmountsHistory: apiMocks.fetchAmountsHistory,
  fetchAmountsFeedHistory: apiMocks.fetchAmountsFeedHistory
}));

describe('CoinHistoryPage', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 0, 1, 10, 37, 0));
    window.history.pushState({}, '', '/history/BTC');
    apiMocks.fetchTopSpotHistory.mockImplementation((_token, coin: string, query: { from: string; to: string; market: 'spot' | 'perpetual'; side: 'buy' | 'sell' }) => {
      return Promise.resolve(makeHistoryResponse({ coin, ...query }));
    });
    apiMocks.fetchTopSpotFeedHistory.mockImplementation((_token, query: { from: string; to: string }) => {
      return Promise.resolve(makeFeedHistoryResponse(query));
    });
    apiMocks.fetchTopOiFeedHistory.mockImplementation((_token, query: { from: string; to: string }) => {
      return Promise.resolve(makeTopOiFeedHistoryResponse(query));
    });
    apiMocks.fetchAmountsFeedHistory.mockImplementation((_token, query: { from: string; to: string }) => {
      return Promise.resolve(makeAmountsFeedHistoryResponse(query));
    });
    apiMocks.fetchTopOiHistory.mockImplementation((_token, coin: string, query: { from: string; to: string; side: 'gainer' | 'loser' }) => {
      return Promise.resolve(makeTopOiHistoryResponse({ coin, ...query }));
    });
    apiMocks.fetchAmountsHistory.mockImplementation((_token, coin: string, query: { from: string; to: string; market: 'spot' | 'perpetual'; side: 'buy' | 'sell' }) => {
      return Promise.resolve(makeHistoryResponse({ coin, ...query }));
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('opens the current active local xx:04 window even when it has no hits', async () => {
    const currentWindow = getCurrentHistoryWindow(new Date(2026, 0, 1, 10, 37, 0));

    render(<CoinHistoryPage authToken={null} coin="btc" storageStateLabel="Storage live" />);

    expect(screen.getByRole('heading', { name: 'BTC History' })).toBeInTheDocument();
    expect(screen.getByText(/Storage live/)).toBeInTheDocument();
    expect(await screen.findByText(/No B\/S hits found for BTC in this hour/i)).toBeInTheDocument();
    expect(screen.getAllByText(/10:04.*11:04/).length).toBeGreaterThan(0);
    expect(apiMocks.fetchTopSpotHistory).toHaveBeenCalledWith(null, 'BTC', {
      from: currentWindow.from.toISOString(),
      to: currentWindow.to.toISOString(),
      market: 'spot',
      side: 'buy'
    }, expect.any(AbortSignal));
    expect(screen.getByRole('button', { name: 'Next hour' })).toBeDisabled();
  });

  it('renders top spot feed history by default and keeps coin search available', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const currentWindow = getCurrentFeedHistoryWindow(new Date(2026, 0, 1, 10, 37, 0));
    window.history.pushState({}, '', '/history');

    render(<CoinHistoryPage authToken={null} coin="" storageStateLabel="Storage live" />);

    expect(screen.getByRole('heading', { name: 'Top Spot History' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'By feeds' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'By coin' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Spot Buyers' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Spot Sellers' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Derivatives Buyers' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Derivatives Sellers' })).toHaveAttribute('aria-pressed', 'false');
    expect(await screen.findByRole('heading', { name: 'Top 10 Spot Buyers 5m' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Top 10 Derivatives Sellers 5m' })).not.toBeInTheDocument();
    expect(await screen.findByText('BTC')).toBeInTheDocument();
    expect(apiMocks.fetchTopSpotFeedHistory).toHaveBeenCalledWith(null, {
      from: currentWindow.from.toISOString(),
      to: currentWindow.to.toISOString()
    }, expect.any(AbortSignal));
    expect(apiMocks.fetchTopSpotHistory).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Next hour' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'By coin' }));
    expect(screen.getByRole('button', { name: 'By coin' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('heading', { name: 'Search a coin' })).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('Search a coin'), 'sol');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    expect(window.location.pathname).toBe('/history/SOL');
    expect(new URLSearchParams(window.location.search).get('market')).toBe('spot');
    expect(new URLSearchParams(window.location.search).get('side')).toBe('buy');
  });

  it('switches history sections from Top Spot to Top OI feed history', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const currentWindow = getCurrentFeedHistoryWindow(new Date(2026, 0, 1, 10, 37, 0));
    window.history.pushState({}, '', '/history');

    render(<CoinHistoryPage authToken={null} coin="" storageStateLabel="Storage live" />);

    expect(await screen.findByRole('heading', { name: 'Top Spot History' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Top OI' }));

    expect(screen.getByRole('heading', { name: 'Top OI History' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Top OI' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'OI Gainers' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'OI Losers' })).toHaveAttribute('aria-pressed', 'false');
    expect(await screen.findByRole('heading', { name: 'Top 10 OI Gainers 60m' })).toBeInTheDocument();
    expect(screen.getByText('BTC')).toBeInTheDocument();
    expect(apiMocks.fetchTopOiFeedHistory).toHaveBeenCalledWith(null, {
      from: currentWindow.from.toISOString(),
      to: currentWindow.to.toISOString()
    }, expect.any(AbortSignal));
  });

  it('shows Bull/Bear percent as one history section with four feed choices', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    window.history.pushState({}, '', '/history');

    render(<CoinHistoryPage authToken={null} coin="" storageStateLabel="Storage live" />);

    await screen.findByRole('heading', { name: 'Top Spot History' });
    await user.click(screen.getByRole('button', { name: 'Bull/Bear %' }));

    expect(screen.getByRole('heading', { name: 'Bull/Bear % History' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Spot Buying %' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Spot Selling %' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Derivatives Buying %' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Derivatives Selling %' })).toHaveAttribute('aria-pressed', 'false');
    expect(await screen.findByRole('heading', { name: 'Top 10 Spot Buying Percent' })).toBeInTheDocument();
    expect(screen.getByText('BTC')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Spot Selling %' }));

    expect(screen.getByRole('button', { name: 'Spot Selling %' })).toHaveAttribute('aria-pressed', 'true');
    expect(await screen.findByRole('heading', { name: 'Top 10 Spot Selling Percent' })).toBeInTheDocument();
    expect(screen.getByText('ETH')).toBeInTheDocument();
  });

  it('searches coin history inside the selected Top OI section', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    window.history.pushState({}, '', '/history');

    render(<CoinHistoryPage authToken={null} coin="" storageStateLabel="Storage live" />);

    await user.click(await screen.findByRole('button', { name: 'Top OI' }));
    await user.click(screen.getByRole('button', { name: 'By coin' }));
    await user.type(screen.getByPlaceholderText('Search a coin'), 'eth');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    expect(window.location.pathname).toBe('/history/ETH');
    expect(new URLSearchParams(window.location.search).get('section')).toBe('top-oi');
    await waitFor(() => expect(screen.getAllByRole('heading', { name: 'ETH OI History' }).length).toBeGreaterThan(0));
    await waitFor(() => expect(apiMocks.fetchTopOiHistory).toHaveBeenCalledWith(null, 'ETH', expect.objectContaining({ side: 'gainer' }), expect.any(AbortSignal)));
  });

  it('switches from coin history back to feed history', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<CoinHistoryPage authToken={null} coin="BTC" storageStateLabel="Storage live" />);

    expect(screen.getByRole('button', { name: 'By coin' })).toHaveAttribute('aria-pressed', 'true');
    expect(await screen.findByText(/No B\/S hits found/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'By feeds' }));

    expect(window.location.pathname).toBe('/history');
    expect(screen.getByRole('button', { name: 'By feeds' })).toHaveAttribute('aria-pressed', 'true');
    expect(await screen.findByRole('heading', { name: 'Top 10 Spot Buyers 5m' })).toBeInTheDocument();
  });

  it('pages top spot feed history by fixed hourly windows', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    window.history.pushState({}, '', '/history');
    render(<CoinHistoryPage authToken={null} coin="" storageStateLabel="Storage live" />);
    await screen.findByRole('heading', { name: 'Top 10 Spot Buyers 5m' });

    expect(screen.getAllByText(/10:04.*11:04/).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'Previous hour' }));

    await waitFor(() => expect(apiMocks.fetchTopSpotFeedHistory).toHaveBeenLastCalledWith(null, {
      from: new Date(2026, 0, 1, 9, 4, 0).toISOString(),
      to: new Date(2026, 0, 1, 10, 4, 0).toISOString()
    }, expect.any(AbortSignal)));
    expect(screen.getByRole('button', { name: 'Next hour' })).not.toBeDisabled();
  });

  it('filters top spot feed history by selected local date', async () => {
    window.history.pushState({}, '', '/history');
    render(<CoinHistoryPage authToken={null} coin="" storageStateLabel="Storage live" />);
    await screen.findByRole('heading', { name: 'Top 10 Spot Buyers 5m' });

    expect(screen.getByLabelText('History date')).toHaveValue('2026-01-01');

    fireEvent.change(screen.getByLabelText('History date'), { target: { value: '2025-12-31' } });

    await waitFor(() => expect(apiMocks.fetchTopSpotFeedHistory).toHaveBeenLastCalledWith(null, {
      from: new Date(2025, 11, 31, 10, 4, 0).toISOString(),
      to: new Date(2025, 11, 31, 11, 4, 0).toISOString()
    }, expect.any(AbortSignal)));
    expect(screen.getAllByText(/12\/31\/2025.*10:04.*11:04|Dec 31, 2025.*10:04.*11:04/).length).toBeGreaterThan(0);
  });

  it('shows one selected feed with every coin seen in that hourly feed window', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    apiMocks.fetchTopSpotFeedHistory.mockImplementation((_token, query: { from: string; to: string }) => {
      return Promise.resolve(makeLargeFeedHistoryResponse(query));
    });
    window.history.pushState({}, '', '/history');
    const { container } = render(<CoinHistoryPage authToken={null} coin="" storageStateLabel="Storage live" />);

    expect(await screen.findByRole('heading', { name: 'Top 10 Spot Buyers 5m' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Top 10 Spot Sellers 5m' })).not.toBeInTheDocument();
    expect(await screen.findByText('UNI')).toBeInTheDocument();
    expect(container.querySelectorAll('tbody tr')).toHaveLength(11);

    await user.click(screen.getByRole('button', { name: 'Spot Sellers' }));

    expect(screen.getByRole('button', { name: 'Spot Sellers' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('heading', { name: 'Top 10 Spot Sellers 5m' })).toBeInTheDocument();
    expect(screen.getByText('AAVE')).toBeInTheDocument();
    expect(screen.queryByText('UNI')).not.toBeInTheDocument();
  });

  it('pages by fixed one-hour windows anchored at minute 04', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<CoinHistoryPage authToken={null} coin="BTC" storageStateLabel="Storage live" />);
    await screen.findByText(/No B\/S hits found/i);

    await user.click(screen.getByRole('button', { name: 'Previous hour' }));

    const previousWindow = {
      from: new Date(2026, 0, 1, 9, 4, 0),
      to: new Date(2026, 0, 1, 10, 4, 0)
    };
    await waitFor(() => expect(apiMocks.fetchTopSpotHistory).toHaveBeenLastCalledWith(null, 'BTC', {
      from: previousWindow.from.toISOString(),
      to: previousWindow.to.toISOString(),
      market: 'spot',
      side: 'buy'
    }, expect.any(AbortSignal)));
    expect(screen.getByRole('button', { name: 'Next hour' })).not.toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Next hour' }));
    await waitFor(() => expect(apiMocks.fetchTopSpotHistory).toHaveBeenLastCalledWith(null, 'BTC', expect.objectContaining({
      from: new Date(2026, 0, 1, 10, 4, 0).toISOString(),
      to: new Date(2026, 0, 1, 11, 4, 0).toISOString()
    }), expect.any(AbortSignal)));
    expect(screen.getByRole('button', { name: 'Next hour' })).toBeDisabled();
  });

  it('filters coin history by selected local date', async () => {
    render(<CoinHistoryPage authToken={null} coin="BTC" storageStateLabel="Storage live" />);
    await screen.findByText(/No B\/S hits found/i);

    fireEvent.change(screen.getByLabelText('History date'), { target: { value: '2025-12-31' } });

    await waitFor(() => expect(apiMocks.fetchTopSpotHistory).toHaveBeenLastCalledWith(null, 'BTC', {
      from: new Date(2025, 11, 31, 10, 4, 0).toISOString(),
      to: new Date(2025, 11, 31, 11, 4, 0).toISOString(),
      market: 'spot',
      side: 'buy'
    }, expect.any(AbortSignal)));
  });

  it('uses source tabs to refetch and updates graph/details labels', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    apiMocks.fetchTopSpotHistory.mockImplementation((_token, coin: string, query: { from: string; to: string; market: 'spot' | 'perpetual'; side: 'buy' | 'sell' }) => {
      return Promise.resolve(makeHistoryResponse({
        coin,
        ...query,
        hits: [makeHistoryHit({ feedKey: query.side === 'sell' ? 'all_derivatives_top_sell_5m' : 'all_spot_top_buy_5m', buySellRatio: query.side === 'sell' ? 0.4 : 2.5 })],
        comparisonHits: [makeHistoryHit({ feedKey: query.side === 'sell' ? 'all_derivatives_top_buy_5m' : 'all_spot_top_sell_5m', buySellRatio: query.side === 'sell' ? 2.5 : 0.4, rawLine: '#BTC opposite' })]
      }));
    });

    render(<CoinHistoryPage authToken={null} coin="BTC" storageStateLabel="Storage live" />);

    expect(await screen.findByRole('img', { name: /BTC B\/S and S\/B ratio history/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Derivatives Sellers' }));

    await waitFor(() => expect(apiMocks.fetchTopSpotHistory).toHaveBeenLastCalledWith(null, 'BTC', expect.objectContaining({
      market: 'perpetual',
      side: 'sell'
    }), expect.any(AbortSignal)));
    expect(screen.getByRole('img', { name: /BTC S\/B and B\/S ratio history/i })).toBeInTheDocument();
    expect(window.location.search).toContain('market=perpetual');
    expect(window.location.search).toContain('side=sell');

    await user.click(screen.getByRole('tab', { name: 'Details' }));
    const details = screen.getByRole('tabpanel', { name: 'Details' });
    expect(within(details).getByText('Hits by time')).toBeInTheDocument();
    expect(within(details).getByText('2.50x')).toBeInTheDocument();
  });
});

function makeHistoryResponse(overrides: Partial<TopSpotHistoryResponse> = {}): TopSpotHistoryResponse {
  const market = overrides.market ?? 'spot';
  const side = overrides.side ?? 'buy';
  return {
    generatedAt: '2026-01-01T05:10:00.000Z',
    enabled: true,
    coin: overrides.coin ?? 'BTC',
    from: overrides.from ?? new Date(2026, 0, 1, 10, 4, 0).toISOString(),
    to: overrides.to ?? new Date(2026, 0, 1, 11, 4, 0).toISOString(),
    market,
    side,
    primaryFeedKey: market === 'spot' ? (side === 'buy' ? 'all_spot_top_buy_5m' : 'all_spot_top_sell_5m') : (side === 'buy' ? 'all_derivatives_top_buy_5m' : 'all_derivatives_top_sell_5m'),
    comparisonFeedKey: market === 'spot' ? (side === 'buy' ? 'all_spot_top_sell_5m' : 'all_spot_top_buy_5m') : (side === 'buy' ? 'all_derivatives_top_sell_5m' : 'all_derivatives_top_buy_5m'),
    hits: [],
    comparisonHits: [],
    summary: {
      primaryHitCount: 0,
      comparisonHitCount: 0,
      latestPrimaryRatio: null,
      primaryAverage3: null
    },
    ...overrides
  };
}

function makeHistoryHit(overrides: Partial<TopSpotHistoryHit> = {}): TopSpotHistoryHit {
  return {
    eventId: 'event-1',
    receivedAt: new Date(2026, 0, 1, 10, 49, 0).toISOString(),
    feedKey: 'all_spot_top_buy_5m',
    rank: 1,
    coin: 'BTC',
    exchange: 'Binance Spot',
    buyUsd: 2_500_000,
    sellUsd: 1_000_000,
    deltaUsd: 1_500_000,
    buySellRatio: 2.5,
    percent: 12.5,
    volume24hUsd: 100_000_000,
    rawLine: '#BTC top spot',
    ...overrides
  };
}

function makeFeedHistoryResponse(query: { from: string; to: string }) {
  const spotBuyEvent = makeFeedEvent({ id: 'spot-buy-1', feedKey: 'all_spot_top_buy_5m', title: 'Top 10 Spot Buyers 5m' });
  const derivativesSellEvent = makeFeedEvent({
    id: 'der-sell-1',
    feedKey: 'all_derivatives_top_sell_5m',
    title: 'Top 10 Derivatives Sellers 5m',
    entries: [makeFeedEntry({ coin: 'ETH', direction: 'sell', buyUsd: 1_000_000, sellUsd: 2_500_000, buySellRatio: 0.4 })]
  });
  return {
    generatedAt: '2026-01-01T05:10:00.000Z',
    enabled: true,
    from: query.from,
    to: query.to,
    feeds: {
      all_spot_top_buy_5m: { events: [spotBuyEvent], latest: spotBuyEvent },
      all_spot_top_sell_5m: { events: [], latest: null },
      all_derivatives_top_buy_5m: { events: [], latest: null },
      all_derivatives_top_sell_5m: { events: [derivativesSellEvent], latest: derivativesSellEvent }
    },
    summary: { eventCount: 2, entryCount: 2 }
  };
}

function makeTopOiHistoryResponse(overrides: { coin?: string; from?: string; to?: string; side?: 'gainer' | 'loser' } = {}) {
  const side = overrides.side ?? 'gainer';
  return {
    generatedAt: '2026-01-01T05:10:00.000Z',
    enabled: true,
    coin: overrides.coin ?? 'BTC',
    from: overrides.from ?? new Date(2026, 0, 1, 10, 4, 0).toISOString(),
    to: overrides.to ?? new Date(2026, 0, 1, 11, 4, 0).toISOString(),
    side,
    primaryFeedKey: side === 'gainer' ? 'top_oi_gainers_60m' : 'top_oi_losers_60m',
    comparisonFeedKey: side === 'gainer' ? 'top_oi_losers_60m' : 'top_oi_gainers_60m',
    hits: [makeHistoryHit({ feedKey: side === 'gainer' ? 'top_oi_gainers_60m' : 'top_oi_losers_60m', percent: side === 'gainer' ? 8.4 : -5.5 })],
    comparisonHits: [],
    summary: {
      primaryHitCount: 1,
      comparisonHitCount: 0,
      latestPrimaryRatio: null,
      primaryAverage3: null
    }
  };
}

function makeTopOiFeedHistoryResponse(query: { from: string; to: string }) {
  const gainer = makeFeedEvent({
    id: 'oi-gainer-1',
    feedKey: 'top_oi_gainers_60m',
    title: 'Top 10 OI Gainers 60m',
    entries: [makeFeedEntry({ direction: 'gainer', percent: 8.4, priceUsd: 42_000, priceChangePercent: 1.2 })]
  });
  const loser = makeFeedEvent({
    id: 'oi-loser-1',
    feedKey: 'top_oi_losers_60m',
    title: 'Top 10 OI Losers 60m',
    entries: [makeFeedEntry({ coin: 'ETH', direction: 'loser', percent: -5.5, priceUsd: 2_500, priceChangePercent: -0.8 })]
  });
  return {
    generatedAt: '2026-01-01T05:10:00.000Z',
    enabled: true,
    from: query.from,
    to: query.to,
    feeds: {
      top_oi_gainers_60m: { events: [gainer], latest: gainer },
      top_oi_losers_60m: { events: [loser], latest: loser }
    },
    summary: { eventCount: 2, entryCount: 2 }
  };
}

function makeAmountsFeedHistoryResponse(query: { from: string; to: string }) {
  const spotBuy = makeFeedEvent({
    id: 'spot-buy-percent',
    feedKey: 'all_spot_per',
    title: 'Top 10 Spot Buying Percent',
    entries: [makeFeedEntry({ direction: 'buy', percent: 0.4 })]
  });
  const spotSell = makeFeedEvent({
    id: 'spot-sell-percent',
    feedKey: 'all_spot_per',
    title: 'Top 10 Spot Selling Percent',
    entries: [makeFeedEntry({ coin: 'ETH', direction: 'sell', buyUsd: 1_000_000, sellUsd: 2_000_000, buySellRatio: 0.5, percent: 0.7 })]
  });
  const derivativesBuy = makeFeedEvent({
    id: 'derivatives-buy-percent',
    feedKey: 'all_derivatives_per',
    title: 'Top 10 Derivatives Buying Percent',
    entries: [makeFeedEntry({ coin: 'SOL', direction: 'buy', percent: 1.1 })]
  });
  const derivativesSell = makeFeedEvent({
    id: 'derivatives-sell-percent',
    feedKey: 'all_derivatives_per',
    title: 'Top 10 Derivatives Selling Percent',
    entries: [makeFeedEntry({ coin: 'XRP', direction: 'sell', buyUsd: 1_000_000, sellUsd: 1_800_000, buySellRatio: 0.56, percent: 0.9 })]
  });
  return {
    generatedAt: '2026-01-01T05:10:00.000Z',
    enabled: true,
    from: query.from,
    to: query.to,
    feeds: {
      spot_buy: { events: [spotBuy], latest: spotBuy },
      spot_sell: { events: [spotSell], latest: spotSell },
      derivatives_buy: { events: [derivativesBuy], latest: derivativesBuy },
      derivatives_sell: { events: [derivativesSell], latest: derivativesSell }
    },
    summary: { eventCount: 4, entryCount: 4 }
  };
}

function makeLargeFeedHistoryResponse(query: { from: string; to: string }) {
  const latestSpotBuyCoins = ['BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'DOGE', 'ADA', 'LINK', 'AVAX', 'TON'];
  const latestSpotBuy = makeFeedEvent({
    id: 'spot-buy-latest',
    feedKey: 'all_spot_top_buy_5m',
    title: 'Top 10 Spot Buyers 5m',
    receivedAt: new Date(2026, 0, 1, 10, 34, 0).toISOString(),
    entries: latestSpotBuyCoins.map((coin, index) => makeFeedEntry({
      rank: index + 1,
      coin,
      rawLine: `#${index + 1} ${coin} latest`,
      buyUsd: 3_000_000 - index * 100_000,
      sellUsd: 1_000_000,
      buySellRatio: 3 - index * 0.1
    }))
  });
  const olderSpotBuy = makeFeedEvent({
    id: 'spot-buy-older',
    feedKey: 'all_spot_top_buy_5m',
    title: 'Top 10 Spot Buyers 5m',
    receivedAt: new Date(2026, 0, 1, 10, 9, 0).toISOString(),
    entries: [makeFeedEntry({
      rank: 1,
      coin: 'UNI',
      rawLine: '#1 UNI older',
      buyUsd: 1_100_000,
      sellUsd: 1_000_000,
      buySellRatio: 1.1
    })]
  });
  const spotSell = makeFeedEvent({
    id: 'spot-sell-latest',
    feedKey: 'all_spot_top_sell_5m',
    title: 'Top 10 Spot Sellers 5m',
    receivedAt: new Date(2026, 0, 1, 10, 29, 0).toISOString(),
    entries: [makeFeedEntry({
      rank: 1,
      coin: 'AAVE',
      direction: 'sell',
      rawLine: '#1 AAVE sell',
      buyUsd: 800_000,
      sellUsd: 2_000_000,
      buySellRatio: 0.4
    })]
  });

  return {
    generatedAt: '2026-01-01T05:10:00.000Z',
    enabled: true,
    from: query.from,
    to: query.to,
    feeds: {
      all_spot_top_buy_5m: { events: [latestSpotBuy, olderSpotBuy], latest: latestSpotBuy },
      all_spot_top_sell_5m: { events: [spotSell], latest: spotSell },
      all_derivatives_top_buy_5m: { events: [], latest: null },
      all_derivatives_top_sell_5m: { events: [], latest: null }
    },
    summary: { eventCount: 3, entryCount: 12 }
  };
}

function makeFeedEvent(overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
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
    timestamp: new Date(2026, 0, 1, 10, 34, 0).toISOString(),
    sourceTime: null,
    receivedAt: new Date(2026, 0, 1, 10, 34, 0).toISOString(),
    latencyMs: 25,
    severity: 'info',
    raw: {},
    endpoint: 'main',
    entries: [makeFeedEntry()],
    amountMetric: null,
    parserStatus: 'parsed',
    ...overrides
  };
}

function makeFeedEntry(overrides: Partial<NormalizedEvent['entries'][number]> = {}): NormalizedEvent['entries'][number] {
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
