import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ScoresPage } from './ScoresPage';
import type { ExchangeAvailabilityByMarket } from './ExchangeChips';
import { makeEntry, makeEvent, makeSnapshot, makeStatus } from '../test/builders';
import { makeScoreDetailResponse, makeScoreEvidenceResponse, makeScoreMarketRegimeResponse, makeScoresListResponse, makeScoreSummary, makeScoreTimelineResponse, makeScoreUpdateSseEvent, makeScoreWorkerStatus, makeStorageStatusResponse } from '../test/scoreBuilders';

const apiMocks = vi.hoisted(() => ({
  fetchScoresTop: vi.fn(),
  fetchScoresCurrent: vi.fn(),
  fetchScoreMarketRegime: vi.fn(),
  fetchScoreDetail: vi.fn(),
  fetchScoreTimeline: vi.fn(),
  fetchScoreEvidence: vi.fn(),
  fetchScoringConfigCurrent: vi.fn()
}));

vi.mock('../api/sse', () => ({
  fetchScoresTop: apiMocks.fetchScoresTop,
  fetchScoresCurrent: apiMocks.fetchScoresCurrent,
  fetchScoreMarketRegime: apiMocks.fetchScoreMarketRegime,
  fetchScoreDetail: apiMocks.fetchScoreDetail,
  fetchScoreTimeline: apiMocks.fetchScoreTimeline,
  fetchScoreEvidence: apiMocks.fetchScoreEvidence,
  fetchScoringConfigCurrent: apiMocks.fetchScoringConfigCurrent
}));

describe('ScoresPage', () => {
  beforeEach(() => {
    apiMocks.fetchScoresTop.mockImplementation((_token, query: { side?: string }) => {
      if (query.side === 'bear') {
        return Promise.resolve(makeScoresListResponse({ kind: 'top', side: 'bear', scores: [makeScoreSummary({ coin: 'ETH', bullScore: 10, bearScore: 73, netScore: -63, confidenceScore: 86, marketRegime: 'bearish', primaryReason: 'Derivatives sell pressure', riskTags: [] })] }));
      }
      return Promise.resolve(makeScoresListResponse({ kind: 'top', side: 'bull', scores: [makeScoreSummary({ coin: 'BTC' })] }));
    });
    apiMocks.fetchScoresCurrent.mockResolvedValue(makeScoresListResponse({ kind: 'current', side: 'net', scores: [makeScoreSummary({ coin: 'SOL', bullScore: 45, bearScore: 17, netScore: 28, confidenceScore: 77, recentScoreDelta: 18.25, dominantSignal: 'oi_expansion', primaryReason: 'Open interest expansion' })] }));
    apiMocks.fetchScoreMarketRegime.mockResolvedValue(makeScoreMarketRegimeResponse());
    apiMocks.fetchScoreDetail.mockResolvedValue(makeScoreDetailResponse());
    apiMocks.fetchScoreTimeline.mockResolvedValue(makeScoreTimelineResponse());
    apiMocks.fetchScoreEvidence.mockResolvedValue(makeScoreEvidenceResponse());
    apiMocks.fetchScoringConfigCurrent.mockResolvedValue({
      generatedAt: '2026-01-01T00:00:00.000Z',
      storageBacked: true,
      config: {
        scoreConfigVersion: 'rule-v1',
        description: 'test config',
        active: true,
        activatedAt: '2026-01-01T00:00:00.000Z',
        retiredAt: null,
        windows: [5, 15, 60].map((minutes) => ({ minutes, halfLifeMinutes: minutes, maxAgeMinutes: minutes * 2 })),
        sideSaturation: 100,
        materialChange: {},
        confidence: {},
        burst: { threshold: 3, maxBonus: 8 },
        rules: []
      }
    });
  });

  it('renders decision-focused default score panels', async () => {
    render(<ScoresPage {...makeProps()} />);

    expect(await screen.findByRole('heading', { name: 'Scores', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Top 10 Bull' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Top 10 Bear' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Rising Fast' })).toBeInTheDocument();
    expect(await screen.findByText('BTC')).toBeInTheDocument();
    expect(screen.getByText('ETH')).toBeInTheDocument();
    expect(screen.getByText('SOL')).toBeInTheDocument();
    expect(screen.getByText('Upward price alert')).toBeInTheDocument();
    expect(screen.getAllByText('Overheated Funding').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Bullish').length).toBeGreaterThan(0);
    expect(screen.getByText('Queue')).toBeInTheDocument();
  });

  it('keeps opposite-edge coins out of bull and bear panels', async () => {
    apiMocks.fetchScoresTop.mockImplementation((_token, query: { side?: string }) => {
      if (query.side === 'bear') {
        return Promise.resolve(makeScoresListResponse({
          kind: 'top',
          side: 'bear',
          scores: [
            makeScoreSummary({ coin: 'WLD', bullScore: 12, bearScore: 4, netScore: 8, primaryReason: 'Positive edge should not appear in bear' }),
            makeScoreSummary({ coin: 'ETH', bullScore: 10, bearScore: 73, netScore: -63, primaryReason: 'Derivatives sell pressure' })
          ]
        }));
      }
      return Promise.resolve(makeScoresListResponse({
        kind: 'top',
        side: 'bull',
        scores: [
          makeScoreSummary({ coin: 'FET', bullScore: 4, bearScore: 12, netScore: -8, primaryReason: 'Negative edge should not appear in bull' }),
          makeScoreSummary({ coin: 'BTC', bullScore: 72, bearScore: 12, netScore: 60, primaryReason: 'Upward price alert' })
        ]
      }));
    });

    render(<ScoresPage {...makeProps()} />);

    expect(await screen.findByText('BTC')).toBeInTheDocument();
    expect(screen.getByText('ETH')).toBeInTheDocument();
    expect(screen.queryByText('FET')).not.toBeInTheDocument();
    expect(screen.queryByText('WLD')).not.toBeInTheDocument();
  });

  it('refetches with confidence and changed-last-15m filters', async () => {
    const user = userEvent.setup();
    render(<ScoresPage {...makeProps()} />);

    await screen.findByText('BTC');
    apiMocks.fetchScoresTop.mockClear();
    await user.click(screen.getByRole('button', { name: 'Conf 50+' }));
    await waitFor(() => expect(apiMocks.fetchScoresTop).toHaveBeenCalledWith(null, expect.objectContaining({ minConfidence: 50 }), expect.any(AbortSignal)));
    apiMocks.fetchScoresTop.mockClear();
    await user.click(screen.getByRole('button', { name: 'Changed last 15m' }));
    await waitFor(() => expect(apiMocks.fetchScoresTop).toHaveBeenCalledWith(null, expect.objectContaining({ updatedSince: expect.any(String) }), expect.any(AbortSignal)));
  });

  it('uses exchange filters by listing availability instead of score evidence exchange', async () => {
    apiMocks.fetchScoresTop.mockImplementation((_token, query: { side?: string }) => {
      if (query.side === 'bear') return Promise.resolve(makeScoresListResponse({ kind: 'top', side: 'bear', scores: [] }));
      return Promise.resolve(makeScoresListResponse({
        kind: 'top',
        side: 'bull',
        scores: [makeScoreSummary({ coin: 'LUMIA', bullScore: 53, bearScore: 0, netScore: 53, primaryReason: 'Derivatives buy pressure', evidenceSummary: { total: 1, topRuleKeys: ['derivatives_buy_pressure'], feedKeys: ['all_derivatives_top_buy_5m'], sides: ['bull'] } })]
      }));
    });

    render(<ScoresPage {...makeProps({ exchangeFilter: ['binance'], exchangeAvailability: makeAvailability([['LUMIA', [{ exchange: 'binance', label: 'Binance', shortLabel: 'BN' }]]]) })} />);

    expect(await screen.findByText('LUMIA')).toBeInTheDocument();
    await waitFor(() => expect(apiMocks.fetchScoresTop).toHaveBeenCalledWith(null, expect.not.objectContaining({ exchange: 'binance' }), expect.any(AbortSignal)));
  });

  it('opens coin detail with timeline, evidence, events, and placeholder context', async () => {
    const user = userEvent.setup();
    render(<ScoresPage {...makeProps()} />);

    await user.click(await screen.findByRole('button', { name: 'BTC' }));

    expect(await screen.findByRole('heading', { name: 'BTC Score Detail' })).toBeInTheDocument();
    expect(apiMocks.fetchScoreDetail).toHaveBeenCalledWith(null, 'BTC', expect.objectContaining({ side: 'net', limit: 1 }), expect.any(AbortSignal));
    expect(screen.getByRole('heading', { name: 'Bull Evidence' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Bear Evidence' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Risk Evidence' })).toBeInTheDocument();
    expect(screen.getByText('Forward return attribution placeholder. The storage worker can label returns, but this UI waits for a dedicated attribution API.')).toBeInTheDocument();
    expect(screen.getByText('BTC live price alert')).toBeInTheDocument();
  });

  it('patches displayed rows from live score updates', async () => {
    const props = makeProps();
    const { rerender } = render(<ScoresPage {...props} />);

    await screen.findByText('BTC');
    rerender(<ScoresPage {...props} liveScoreUpdate={makeScoreUpdateSseEvent()} />);

    await waitFor(() => expect(screen.getAllByText('+79').length).toBeGreaterThan(0));
    expect(screen.getAllByText('High 93').length).toBeGreaterThan(0);
  });

  it('handles disabled storage state gracefully', async () => {
    apiMocks.fetchScoresTop
      .mockReset()
      .mockResolvedValue(makeScoresListResponse({ enabled: false, state: 'disabled', reason: 'score_storage_unavailable', scores: [], total: 0 }));
    apiMocks.fetchScoresCurrent.mockResolvedValue(makeScoresListResponse({ enabled: false, kind: 'current', state: 'disabled', reason: 'score_storage_unavailable', scores: [], total: 0 }));
    render(<ScoresPage {...makeProps()} />);

    expect(await screen.findByText('Score storage is unavailable. Live events are still updating, but ranked scores cannot be shown.')).toBeInTheDocument();
  });
});

function makeProps(overrides: Partial<ComponentProps<typeof ScoresPage>> = {}): ComponentProps<typeof ScoresPage> {
  return {
    authToken: null,
    classificationFilter: [],
    exchangeFilter: [],
    marketFilter: [],
    exchangeAvailability: makeAvailability(),
    snapshot: makeSnapshot({
      pricealerts: [makeEvent('pricealerts', { title: 'BTC live price alert', coins: ['BTC'], entries: [makeEntry({ coin: 'BTC', exchange: 'Binance Spot' })] })]
    }),
    status: makeStatus({ workers: { priceCollection: makeWorkerStatus(), forwardReturns: makeWorkerStatus(), scores: makeScoreWorkerStatus() } }),
    liveScoreUpdate: null,
    liveScoreSnapshot: null,
    storageStatus: makeStorageStatusResponse(),
    ...overrides
  };
}

function makeAvailability(extraSpot: Array<[string, Array<{ exchange: 'binance' | 'bybit' | 'okx' | 'coinbase'; label: string; shortLabel: string }>]> = []): ExchangeAvailabilityByMarket {
  return {
    spot: new Map([
      ['BTC', [{ exchange: 'binance', label: 'Binance', shortLabel: 'BN' }]],
      ['ETH', [{ exchange: 'bybit', label: 'Bybit', shortLabel: 'BB' }]],
      ['SOL', [{ exchange: 'okx', label: 'OKX', shortLabel: 'OKX' }]],
      ...extraSpot
    ]),
    perpetual: new Map([
      ['BTC', [{ exchange: 'binance', label: 'Binance', shortLabel: 'BN' }]],
      ['ETH', [{ exchange: 'bybit', label: 'Bybit', shortLabel: 'BB' }]],
      ['SOL', [{ exchange: 'okx', label: 'OKX', shortLabel: 'OKX' }]]
    ])
  };
}

function makeWorkerStatus() {
  return {
    enabled: false,
    state: 'disabled' as const,
    running: false,
    activeCoinCount: 0,
    intervalMs: 60_000,
    lastRunStartedAt: null,
    lastRunCompletedAt: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastError: null,
    processed: 0,
    written: 0,
    skipped: 0,
    failed: 0,
    averageRunMs: null
  };
}
