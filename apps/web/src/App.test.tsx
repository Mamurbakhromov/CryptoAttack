import { act, render, screen, waitFor } from '@testing-library/react';
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
  fetchExchangeSymbols: vi.fn(),
  fetchScoresTop: vi.fn(),
  fetchScoresCurrent: vi.fn(),
  fetchScoreMarketRegime: vi.fn(),
  fetchScoreDetail: vi.fn(),
  fetchScoreTimeline: vi.fn(),
  fetchScoreEvidence: vi.fn(),
  fetchScoringConfigCurrent: vi.fn(),
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
  fetchExchangeSymbols: apiMocks.fetchExchangeSymbols,
  fetchScoresTop: apiMocks.fetchScoresTop,
  fetchScoresCurrent: apiMocks.fetchScoresCurrent,
  fetchScoreMarketRegime: apiMocks.fetchScoreMarketRegime,
  fetchScoreDetail: apiMocks.fetchScoreDetail,
  fetchScoreTimeline: apiMocks.fetchScoreTimeline,
  fetchScoreEvidence: apiMocks.fetchScoreEvidence,
  fetchScoringConfigCurrent: apiMocks.fetchScoringConfigCurrent,
  getEnvDashboardAuthToken: apiMocks.getEnvDashboardAuthToken
}));

vi.mock('./components/StatusBar', () => ({
  StatusBar: (props: {
    queuedCount: number;
    streamState: string;
    onTogglePause: () => void;
  }) => (
    <div>
      <button type="button" onClick={props.onTogglePause}>toggle-pause</button>
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
    apiMocks.fetchExchangeSymbols.mockResolvedValue({ symbols: [] });
    apiMocks.fetchScoringConfigCurrent.mockResolvedValue(makeScoringConfigResponse());
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
});

function makeScoringConfigResponse() {
  return {
    generatedAt: '2026-01-01T00:00:00.000Z',
    storageBacked: true,
    config: {
      scoreConfigVersion: 'rule-v1',
      description: 'test config',
      active: true,
      activatedAt: null,
      retiredAt: null,
      windows: [5, 15, 60].map((minutes) => ({ minutes, halfLifeMinutes: minutes, maxAgeMinutes: minutes * 2 })),
      sideSaturation: 100,
      materialChange: {},
      confidence: {},
      burst: { threshold: 3, maxBonus: 8 },
      rules: []
    }
  };
}
