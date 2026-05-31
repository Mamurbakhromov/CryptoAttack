import { act, render, screen, waitFor } from '@testing-library/react';
import { within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import App from './App';
import { makeEntry, makeEvent, makeSnapshot, makeStatus } from './test/builders';

interface MockStreamHandlers {
  onEvent: (event: unknown) => void;
  onSnapshot: (snapshot: unknown) => void;
  onStateChange: (state: unknown) => void;
}

const apiMocks = vi.hoisted(() => ({
  fetchDashboardSnapshot: vi.fn(),
  fetchDashboardStatus: vi.fn(),
  clearEventData: vi.fn(),
  resetAllStoredData: vi.fn(),
  deleteOldHistory: vi.fn(),
  fetchExchangeSymbols: vi.fn(),
  fetchTopSpotFeedHistory: vi.fn(),
  fetchTopSpotHistory: vi.fn(),
  getEnvDashboardAuthToken: vi.fn(),
  closeStream: vi.fn(),
  streamHandlers: null as null | MockStreamHandlers
}));

vi.mock('./api/sse', () => ({
  connectDashboardStream: (handlers: MockStreamHandlers) => {
    apiMocks.streamHandlers = handlers;
    handlers.onStateChange('connecting');
    return { close: apiMocks.closeStream } as unknown as EventSource;
  },
  fetchDashboardSnapshot: apiMocks.fetchDashboardSnapshot,
  fetchDashboardStatus: apiMocks.fetchDashboardStatus,
  clearEventData: apiMocks.clearEventData,
  resetAllStoredData: apiMocks.resetAllStoredData,
  deleteOldHistory: apiMocks.deleteOldHistory,
  fetchExchangeSymbols: apiMocks.fetchExchangeSymbols,
  fetchTopSpotFeedHistory: apiMocks.fetchTopSpotFeedHistory,
  fetchTopSpotHistory: apiMocks.fetchTopSpotHistory,
  getEnvDashboardAuthToken: apiMocks.getEnvDashboardAuthToken
}));

vi.mock('./components/StatusBar', () => ({
  StatusBar: (props: {
    queuedCount: number;
    streamState: string;
    adminUnlocked: boolean;
    onTogglePause: () => void;
    onAdminTokenSave: (token: string) => void;
    onAdminTokenClear: () => void;
    onClearEventData: () => void;
    onResetAllStoredData: () => void;
    onDeleteOldHistory: () => void;
  }) => (
    <div>
      <button type="button" onClick={props.onTogglePause}>toggle-pause</button>
      <button type="button" onClick={() => props.onAdminTokenSave('admin-secret')}>unlock-admin</button>
      <button type="button" onClick={props.onAdminTokenClear}>lock-admin</button>
      {props.adminUnlocked ? (
        <>
          <button type="button" onClick={props.onClearEventData}>clear-events</button>
          <button type="button" onClick={props.onResetAllStoredData}>reset-all-data</button>
          <button type="button" onClick={props.onDeleteOldHistory}>delete-old-history</button>
        </>
      ) : null}
      <span data-testid="queued-count">{props.queuedCount}</span>
      <span data-testid="stream-state">{props.streamState}</span>
    </div>
  )
}));

vi.mock('./components/Dashboard', () => ({
  Dashboard: (props: { snapshot: { feeds: { listings: { events: Array<{ title: string }> } } } }) => (
    <div>
      <span data-testid="listings-count">{props.snapshot.feeds.listings.events.length}</span>
      <span data-testid="latest-listing">{props.snapshot.feeds.listings.events[0]?.title ?? 'none'}</span>
    </div>
  )
}));

describe('App', () => {
  beforeEach(() => {
    apiMocks.streamHandlers = null;
    apiMocks.closeStream.mockReset();
    apiMocks.fetchDashboardSnapshot.mockResolvedValue(makeSnapshot());
    apiMocks.fetchDashboardStatus.mockResolvedValue(makeStatus());
    apiMocks.clearEventData.mockResolvedValue(makeClearEventDataResponse());
    apiMocks.resetAllStoredData.mockResolvedValue(makeResetAllStoredDataResponse());
    apiMocks.deleteOldHistory.mockResolvedValue(makeDeleteOldHistoryResponse());
    apiMocks.fetchExchangeSymbols.mockResolvedValue({ symbols: [] });
    apiMocks.fetchTopSpotFeedHistory.mockResolvedValue(makeTopSpotFeedHistoryResponse());
    apiMocks.fetchTopSpotHistory.mockResolvedValue(makeTopSpotHistoryResponse());
    apiMocks.getEnvDashboardAuthToken.mockReturnValue(null);
    window.history.pushState({}, '', '/bull');
  });

  it('buffers live events while paused and applies them on resume', async () => {
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => expect(screen.getByTestId('listings-count')).toHaveTextContent('0'));
    expect(apiMocks.streamHandlers).not.toBeNull();

    const firstEvent = makeEvent('listings', {
      id: 'listing-1',
      title: 'Listing 1',
      entries: [makeEntry()]
    });
    const secondEvent = makeEvent('listings', {
      id: 'listing-2',
      title: 'Listing 2',
      entries: [makeEntry()]
    });

    act(() => {
      apiMocks.streamHandlers?.onEvent(firstEvent);
    });

    expect(screen.getByTestId('listings-count')).toHaveTextContent('1');
    expect(screen.getByTestId('latest-listing')).toHaveTextContent('Listing 1');

    await user.click(screen.getByRole('button', { name: 'toggle-pause' }));

    act(() => {
      apiMocks.streamHandlers?.onEvent(secondEvent);
    });

    expect(screen.getByTestId('queued-count')).toHaveTextContent('1');
    expect(screen.getByTestId('listings-count')).toHaveTextContent('1');

    await user.click(screen.getByRole('button', { name: 'toggle-pause' }));

    expect(screen.getByTestId('queued-count')).toHaveTextContent('0');
    expect(screen.getByTestId('listings-count')).toHaveTextContent('2');
    expect(screen.getByTestId('latest-listing')).toHaveTextContent('Listing 2');
  });

  it('shows API warnings from bootstrap failures and clears them on stream snapshot', async () => {
    apiMocks.fetchDashboardSnapshot.mockRejectedValueOnce(new Error('snapshot failed'));

    render(<App />);

    expect(await screen.findByText('API warning: snapshot failed')).toBeInTheDocument();
    expect(apiMocks.streamHandlers).not.toBeNull();

    act(() => {
      apiMocks.streamHandlers?.onSnapshot(makeSnapshot({
        listings: [makeEvent('listings', { id: 'listing-3', title: 'Recovered listing' })]
      }));
    });

    await waitFor(() => expect(screen.queryByText('API warning: snapshot failed')).not.toBeInTheDocument());
  });

  it('clears visible event data after the header action succeeds', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem('cryptoattack.dashboardAdminToken', 'admin-secret');
    apiMocks.fetchDashboardSnapshot.mockResolvedValue(makeSnapshot({
      listings: [makeEvent('listings', { id: 'listing-1', title: 'Listing 1' })]
    }));
    apiMocks.clearEventData.mockResolvedValue(makeClearEventDataResponse({
      snapshot: makeSnapshot(),
      status: makeStatus()
    }));

    render(<App />);

    await waitFor(() => expect(screen.getByTestId('listings-count')).toHaveTextContent('1'));
    await user.click(screen.getByRole('button', { name: 'clear-events' }));

    await waitFor(() => expect(screen.getByTestId('listings-count')).toHaveTextContent('0'));
    expect(apiMocks.clearEventData).toHaveBeenCalledWith(null, 'admin-secret');
  });

  it('resets visible event state after the full reset action succeeds', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem('cryptoattack.dashboardAdminToken', 'admin-secret');
    apiMocks.fetchDashboardSnapshot.mockResolvedValue(makeSnapshot({
      listings: [makeEvent('listings', { id: 'listing-2', title: 'Listing 2' })]
    }));
    apiMocks.resetAllStoredData.mockResolvedValue(makeResetAllStoredDataResponse({
      snapshot: makeSnapshot(),
      status: makeStatus()
    }));

    render(<App />);

    await waitFor(() => expect(screen.getByTestId('listings-count')).toHaveTextContent('1'));
    await user.click(screen.getByRole('button', { name: 'reset-all-data' }));

    await waitFor(() => expect(screen.getByTestId('listings-count')).toHaveTextContent('0'));
    expect(apiMocks.resetAllStoredData).toHaveBeenCalledWith(null, 'admin-secret');
  });

  it('runs the seven-day history cleanup with the stored admin token', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem('cryptoattack.dashboardAdminToken', 'admin-secret');

    render(<App />);

    await waitFor(() => expect(screen.getByTestId('listings-count')).toHaveTextContent('0'));
    await user.click(screen.getByRole('button', { name: 'delete-old-history' }));

    await waitFor(() => expect(apiMocks.deleteOldHistory).toHaveBeenCalledWith(null, 'admin-secret'));
  });

  it('keeps destructive header actions hidden until an admin token is saved locally', async () => {
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => expect(screen.getByTestId('listings-count')).toHaveTextContent('0'));
    expect(screen.queryByRole('button', { name: 'clear-events' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'delete-old-history' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'unlock-admin' }));

    expect(screen.getByRole('button', { name: 'clear-events' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'delete-old-history' })).toBeInTheDocument();
    expect(window.localStorage.getItem('cryptoattack.dashboardAdminToken')).toBe('admin-secret');
  });

  it('renders the dedicated coin history route through the manual router', async () => {
    window.history.pushState({}, '', '/history/BTC?market=spot&side=buy');

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'BTC History' })).toBeInTheDocument();
    await waitFor(() => expect(apiMocks.fetchTopSpotHistory).toHaveBeenCalledWith(null, 'BTC', expect.objectContaining({
      market: 'spot',
      side: 'buy'
    }), expect.any(AbortSignal)));
  });

  it('places History before Top Spot and opens the default history page', async () => {
    const user = userEvent.setup();

    render(<App />);

    const nav = screen.getByRole('navigation', { name: 'Dashboard pages' });
    const navButtons = within(nav).getAllByRole('button').map((button) => button.textContent);
    expect(navButtons.slice(0, 2)).toEqual(['History', 'Top Spot']);
    expect(navButtons).not.toContain('Scores');
    expect(navButtons).not.toContain('Funding');
    expect(navButtons).not.toContain('News');
    expect(navButtons).not.toContain('Debug');

    await user.click(within(nav).getByRole('button', { name: 'History' }));

    expect(window.location.pathname).toBe('/history');
    expect(within(nav).getByRole('button', { name: 'History' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('heading', { name: 'Top Spot History' })).toBeInTheDocument();
    await waitFor(() => expect(apiMocks.fetchTopSpotFeedHistory).toHaveBeenCalledWith(null, expect.objectContaining({
      from: expect.any(String),
      to: expect.any(String)
    }), expect.any(AbortSignal)));
    expect(apiMocks.fetchTopSpotHistory).not.toHaveBeenCalled();
  });
});

function makeTopSpotHistoryResponse() {
  return {
    generatedAt: '2026-01-01T00:00:00.000Z',
    enabled: true,
    coin: 'BTC',
    from: '2026-01-01T00:04:00.000Z',
    to: '2026-01-01T01:04:00.000Z',
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
  };
}

function makeTopSpotFeedHistoryResponse() {
  return {
    generatedAt: '2026-01-01T00:00:00.000Z',
    enabled: true,
    from: '2026-01-01T00:04:00.000Z',
    to: '2026-01-01T01:04:00.000Z',
    feeds: {
      all_spot_top_buy_5m: { events: [], latest: null },
      all_spot_top_sell_5m: { events: [], latest: null },
      all_derivatives_top_buy_5m: { events: [], latest: null },
      all_derivatives_top_sell_5m: { events: [], latest: null }
    },
    summary: { eventCount: 0, entryCount: 0 }
  };
}

function makeClearEventDataResponse(overrides: Partial<ReturnType<typeof makeClearEventDataResponseBase>> = {}) {
  return {
    ...makeClearEventDataResponseBase(),
    ...overrides
  };
}

function makeClearEventDataResponseBase() {
  return {
    generatedAt: '2026-01-01T00:00:00.000Z',
    clearedAt: '2026-01-01T00:00:00.000Z',
    inMemory: { cleared: true },
    database: null,
    snapshot: makeSnapshot(),
    status: makeStatus(),
    storageStatus: {
      generatedAt: '2026-01-01T00:00:00.000Z',
      storage: {
        enabled: false,
        connected: null,
        state: 'disabled',
        queueDepth: 0,
        maxQueueDepth: 0,
        inFlight: 0,
        accepted: 0,
        writtenJobs: 0,
        writtenEvents: 0,
        writtenEntries: 0,
        dropped: 0,
        failed: 0,
        retried: 0,
        lastAcceptedAt: null,
        lastWriteAt: null,
        lastFailureAt: null,
        lastDropAt: null,
        lastError: null,
        oldestQueuedAt: null,
        averageWriteMs: null
      }
    }
  };
}

function makeResetAllStoredDataResponse(overrides: Partial<ReturnType<typeof makeResetAllStoredDataResponseBase>> = {}) {
  return {
    ...makeResetAllStoredDataResponseBase(),
    ...overrides
  };
}

function makeResetAllStoredDataResponseBase() {
  const base = makeClearEventDataResponseBase();
  return {
    ...base,
    resetAt: base.clearedAt,
    rawLog: {
      path: '/tmp/raw-events.ndjson',
      cleared: true,
      missing: false,
      bytesBefore: 2048,
      reason: null
    }
  };
}

function makeDeleteOldHistoryResponse() {
  const base = makeClearEventDataResponseBase();
  return {
    generatedAt: base.generatedAt,
    prunedAt: base.clearedAt,
    retentionDays: 7,
    cutoff: '2025-12-25T00:00:00.000Z',
    database: {
      prunedAt: base.clearedAt,
      cutoff: '2025-12-25T00:00:00.000Z',
      retentionDays: 7,
      rowsDeleted: 42,
      tables: [{ table: 'raw_events', rowsDeleted: 12 }]
    },
    rawLog: {
      path: '/tmp/raw-events.ndjson',
      enabled: true,
      missing: false,
      bytesBefore: 2048,
      bytesAfter: 1024,
      linesBefore: 10,
      linesAfter: 5,
      deletedLines: 5,
      invalidLinesKept: 0,
      reason: null
    },
    status: base.status,
    storageStatus: base.storageStatus
  };
}
