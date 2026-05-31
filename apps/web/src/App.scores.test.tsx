import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import App from './App';
import { makeSnapshot, makeStatus } from './test/builders';
import { makeScoresListResponse, makeScoreMarketRegimeResponse } from './test/scoreBuilders';

interface MockStreamHandlers {
  onEvent: (event: unknown) => void;
  onSnapshot: (snapshot: unknown) => void;
  onStateChange: (state: unknown) => void;
  onScoreUpdate?: (event: unknown) => void;
  onScoreSnapshot?: (event: unknown) => void;
  onStorageStatus?: (event: unknown) => void;
}

const apiMocks = vi.hoisted(() => ({
  fetchDashboardSnapshot: vi.fn(),
  fetchDashboardStatus: vi.fn(),
  clearEventData: vi.fn(),
  resetAllStoredData: vi.fn(),
  fetchExchangeSymbols: vi.fn(),
  fetchScoresTop: vi.fn(),
  fetchScoresCurrent: vi.fn(),
  fetchScoreMarketRegime: vi.fn(),
  fetchScoreDetail: vi.fn(),
  fetchScoreTimeline: vi.fn(),
  fetchScoreEvidence: vi.fn(),
  fetchScoringConfigCurrent: vi.fn(),
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
  fetchExchangeSymbols: apiMocks.fetchExchangeSymbols,
  fetchScoresTop: apiMocks.fetchScoresTop,
  fetchScoresCurrent: apiMocks.fetchScoresCurrent,
  fetchScoreMarketRegime: apiMocks.fetchScoreMarketRegime,
  fetchScoreDetail: apiMocks.fetchScoreDetail,
  fetchScoreTimeline: apiMocks.fetchScoreTimeline,
  fetchScoreEvidence: apiMocks.fetchScoreEvidence,
  fetchScoringConfigCurrent: apiMocks.fetchScoringConfigCurrent,
  fetchTopSpotHistory: apiMocks.fetchTopSpotHistory,
  getEnvDashboardAuthToken: apiMocks.getEnvDashboardAuthToken
}));

vi.mock('./components/StatusBar', () => ({
  StatusBar: () => <div data-testid="status-bar" />
}));

vi.mock('./components/Dashboard', () => ({
  Dashboard: () => <div>Bull page</div>
}));

describe('App scores navigation', () => {
  beforeEach(() => {
    apiMocks.streamHandlers = null;
    apiMocks.closeStream.mockReset();
    apiMocks.fetchDashboardSnapshot.mockResolvedValue(makeSnapshot());
    apiMocks.fetchDashboardStatus.mockResolvedValue(makeStatus());
    apiMocks.fetchExchangeSymbols.mockResolvedValue({ symbols: [] });
    apiMocks.fetchScoresTop.mockResolvedValue(makeScoresListResponse());
    apiMocks.fetchScoresCurrent.mockResolvedValue(makeScoresListResponse({ kind: 'current' }));
    apiMocks.fetchScoreMarketRegime.mockResolvedValue(makeScoreMarketRegimeResponse());
    apiMocks.fetchScoringConfigCurrent.mockResolvedValue(makeScoringConfigResponse());
    apiMocks.getEnvDashboardAuthToken.mockReturnValue(null);
  });

  it('renders /scores and registers score SSE handlers', async () => {
    window.history.pushState({}, '', '/scores');
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Scores', level: 1 })).toBeInTheDocument();
    expect(apiMocks.streamHandlers?.onScoreUpdate).toBeTypeOf('function');
    expect(apiMocks.streamHandlers?.onScoreSnapshot).toBeTypeOf('function');
    expect(apiMocks.streamHandlers?.onStorageStatus).toBeTypeOf('function');
  });

  it('navigates to Scores from the page switcher', async () => {
    const user = userEvent.setup();
    window.history.pushState({}, '', '/bull');
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Scores' }));

    await waitFor(() => expect(window.location.pathname).toBe('/scores'));
    expect(await screen.findByRole('heading', { name: 'Scores', level: 1 })).toBeInTheDocument();
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
