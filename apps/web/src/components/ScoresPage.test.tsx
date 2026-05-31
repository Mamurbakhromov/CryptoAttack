import { readFileSync } from 'node:fs';

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ScoresPage } from './ScoresPage';
import type { ExchangeAvailabilityByMarket } from './ExchangeChips';
import { makeEntry, makeEvent, makeSnapshot, makeStatus } from '../test/builders';
import { makeScoreDetailResponse, makeScoreMarketRegimeResponse, makeScoresListResponse, makeScoreSummary, makeScoreUpdateSseEvent, makeScoreWorkerStatus, makeStorageStatusResponse } from '../test/scoreBuilders';

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
    apiMocks.fetchScoringConfigCurrent.mockResolvedValue({
      generatedAt: '2026-01-01T00:00:00.000Z',
      storageBacked: true,
      config: {
        scoreConfigVersion: 'flow-v2',
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
    expect(screen.getByRole('button', { name: '5m' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '15m' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '1h' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '4h' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '24h' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Conf 0+' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Conf 25+' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Conf 50+' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Conf 75+' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Changed last 15m' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '5m' })).toHaveClass('active');
    expect(screen.getByRole('button', { name: 'Conf 50+' })).toHaveClass('active');
    expect(screen.getByRole('button', { name: 'Changed last 15m' })).toHaveClass('active');
    expect(screen.getByRole('heading', { name: 'Top 5 Bull' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Top 5 Bear' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Top 10 Bull' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Top 10 Bear' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Rising Fast' })).toBeInTheDocument();
    expect(await screen.findByText('BTC')).toBeInTheDocument();
    expect(screen.getByText('ETH')).toBeInTheDocument();
    expect(screen.getByText('SOL')).toBeInTheDocument();
    expect(screen.getByText('Upward price alert')).toBeInTheDocument();
    expect(screen.getAllByText('Overheated Funding').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Bullish').length).toBeGreaterThan(0);
    expect(screen.getByText('Queue')).toBeInTheDocument();
    await waitFor(() => expect(apiMocks.fetchScoresTop).toHaveBeenCalledWith(null, expect.objectContaining({ limit: 5, minConfidence: 50, windowMinutes: 5, updatedSince: expect.any(String) }), expect.any(AbortSignal)));
  });

  it('limits score leaderboards to the top five rows', async () => {
    const bullScores = Array.from({ length: 6 }, (_, index) => makeScoreSummary({ coin: `BULL${index + 1}`, bullScore: 90 - index, bearScore: 5, netScore: 85 - index, confidenceScore: 90 }));
    const bearScores = Array.from({ length: 6 }, (_, index) => makeScoreSummary({ coin: `BEAR${index + 1}`, bullScore: 5, bearScore: 90 - index, netScore: -85 + index, confidenceScore: 90 }));
    const risingScores = Array.from({ length: 6 }, (_, index) => makeScoreSummary({ coin: `RISE${index + 1}`, bullScore: 50, bearScore: 5, netScore: 45, confidenceScore: 90, recentScoreDelta: 20 - index }));
    apiMocks.fetchScoresTop.mockImplementation((_token, query: { side?: string }) => {
      if (query.side === 'bear') return Promise.resolve(makeScoresListResponse({ kind: 'top', side: 'bear', scores: bearScores }));
      return Promise.resolve(makeScoresListResponse({ kind: 'top', side: 'bull', scores: bullScores }));
    });
    apiMocks.fetchScoresCurrent.mockResolvedValue(makeScoresListResponse({ kind: 'current', side: 'net', scores: risingScores }));

    render(<ScoresPage {...makeProps()} />);

    expect(await screen.findByText('BULL1')).toBeInTheDocument();
    expect(screen.getByText('BULL5')).toBeInTheDocument();
    expect(screen.queryByText('BULL6')).not.toBeInTheDocument();
    expect(screen.getByText('BEAR5')).toBeInTheDocument();
    expect(screen.queryByText('BEAR6')).not.toBeInTheDocument();
    expect(screen.getByText('RISE5')).toBeInTheDocument();
    expect(screen.queryByText('RISE6')).not.toBeInTheDocument();
    await waitFor(() => expect(apiMocks.fetchScoresTop).toHaveBeenCalledWith(null, expect.objectContaining({ side: 'bull', limit: 5 }), expect.any(AbortSignal)));
    await waitFor(() => expect(apiMocks.fetchScoresTop).toHaveBeenCalledWith(null, expect.objectContaining({ side: 'bear', limit: 5 }), expect.any(AbortSignal)));
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

  it('refetches with confidence and changed-last-15m filter toggles', async () => {
    const user = userEvent.setup();
    render(<ScoresPage {...makeProps()} />);

    await screen.findByText('BTC');
    apiMocks.fetchScoresTop.mockClear();
    await user.click(screen.getByRole('button', { name: 'Conf 75+' }));
    await waitFor(() => expect(apiMocks.fetchScoresTop).toHaveBeenCalledWith(null, expect.objectContaining({ minConfidence: 75 }), expect.any(AbortSignal)));
    apiMocks.fetchScoresTop.mockClear();
    await user.click(screen.getByRole('button', { name: 'Changed last 15m' }));
    await waitFor(() => expect(apiMocks.fetchScoresTop).toHaveBeenCalledWith(null, expect.not.objectContaining({ updatedSince: expect.any(String) }), expect.any(AbortSignal)));
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

  it('opens coin detail with flow-v2 summary and component context', async () => {
    const user = userEvent.setup();
    const flowScore = makeFlowScoreSummary({ coin: 'BTC' });
    apiMocks.fetchScoreDetail.mockResolvedValue(makeScoreDetailResponse({ scoreConfigVersion: 'flow-v2', coin: 'BTC', score: flowScore }));

    render(<ScoresPage {...makeProps()} />);

    await user.click(await screen.findByRole('button', { name: 'BTC' }));

    const dialog = await screen.findByRole('dialog', { name: /BTC score detail/i });
    expect(within(dialog).queryByText('Live score detail')).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('heading', { name: 'BTC Score Detail' })).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/Evidence is ordered by latest score time/)).not.toBeInTheDocument();
    expect(within(dialog).queryByText('Exchanges')).not.toBeInTheDocument();
    expect(within(dialog).queryByText('Markets')).not.toBeInTheDocument();
    expect(within(dialog).queryByText('Window')).not.toBeInTheDocument();
    expect(within(dialog).queryByText('Evidence')).not.toBeInTheDocument();
    expect(apiMocks.fetchScoreDetail).toHaveBeenCalledWith(null, 'BTC', expect.objectContaining({ side: 'net', limit: 1 }), expect.any(AbortSignal));
    expect(screen.getByRole('heading', { name: 'Flow Components' })).toBeInTheDocument();
    expect(screen.getByText('Flow State')).toBeInTheDocument();
    expect(screen.getAllByText('Clean Bull').length).toBeGreaterThan(0);
    expect(screen.getByText('Action')).toBeInTheDocument();
    expect(screen.getAllByText('Bullish').length).toBeGreaterThan(0);
    expect(screen.queryByText('Long Watch')).not.toBeInTheDocument();
    expect(screen.getByText('Spot')).toBeInTheDocument();
    expect(screen.getByText('Derivatives')).toBeInTheDocument();
    expect(screen.getByText('Top OI')).toBeInTheDocument();
    expect(screen.getByText('Big Activity')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Score Timeline' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Bull Evidence' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Latest Normalized Events' })).not.toBeInTheDocument();
  });

  it('keeps the score detail popup and internals compact on desktop', () => {
    const css = readFileSync('src/styles.css', 'utf8');
    const modalRule = css.match(/\.score-detail-modal\s*\{[^}]+\}/u)?.[0] ?? '';

    expect(modalRule).toContain('max-width: min(100%, 420px)');
    expect(modalRule).toContain('max-height: min(86dvh, 760px)');
    expect(css).toContain('.score-detail-modal .score-hero-metric strong');
    expect(css).toContain('font-size: clamp(0.72rem, 4vw, 0.95rem)');
    expect(css).toContain('.score-detail-modal .flow-component-row.quiet');
    expect(css).toContain('.score-detail-modal .flow-lane-metrics');
    expect(css).toContain('grid-template-columns: repeat(4, minmax(0, 1fr))');
  });

  it('keeps the score detail window focused on flow-v2 only', async () => {
    const user = userEvent.setup();
    const flowScore = makeFlowScoreSummary({ coin: 'HYPE' });
    apiMocks.fetchScoresTop.mockImplementation((_token, query: { side?: string }) => {
      if (query.side === 'bear') return Promise.resolve(makeScoresListResponse({ kind: 'top', side: 'bear', scoreConfigVersion: 'flow-v2', scores: [] }));
      return Promise.resolve(makeScoresListResponse({ kind: 'top', side: 'bull', scoreConfigVersion: 'flow-v2', scores: [flowScore] }));
    });
    apiMocks.fetchScoreDetail.mockResolvedValue(makeScoreDetailResponse({ scoreConfigVersion: 'flow-v2', coin: 'HYPE', score: flowScore }));
    apiMocks.fetchScoreTimeline.mockClear();
    apiMocks.fetchScoreEvidence.mockClear();

    render(<ScoresPage {...makeProps({ snapshot: makeSnapshot() })} />);

    await user.click(await screen.findByRole('button', { name: 'HYPE' }));

    expect(await screen.findByRole('heading', { name: 'Flow Components' })).toBeInTheDocument();
    expect(screen.getByText('Spot')).toBeInTheDocument();
    expect(screen.getByText('Derivatives')).toBeInTheDocument();
    expect(screen.getByText('Top OI')).toBeInTheDocument();
    expect(screen.getByText('Big Activity')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Score Timeline' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Bull Evidence' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Bear Evidence' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Risk Evidence' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Forward Returns' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Latest Normalized Events' })).not.toBeInTheDocument();
    expect(apiMocks.fetchScoreTimeline).not.toHaveBeenCalled();
    expect(apiMocks.fetchScoreEvidence).not.toHaveBeenCalled();
  });

  it('does not render raw normalized top events in the score detail window', async () => {
    const user = userEvent.setup();
    render(<ScoresPage {...makeProps({
      snapshot: makeSnapshot({
        pricealerts: [makeEvent('pricealerts', { title: 'BTC live price alert', coins: ['BTC'], entries: [makeEntry({ coin: 'BTC', exchange: 'Binance Spot' })] })],
        all_spot_top_buy_5m: [makeEvent('all_spot_top_buy_5m', { title: 'BTC 5m spot top buy', coins: ['BTC'], filters: ['5_min', 'buy'] })],
        raw_unclassified: [
          makeEvent('raw_unclassified', {
            id: 'raw-spot-30m',
            title: 'Unclassified all_spot_top event',
            chapter: 'cex_alerts',
            category: 'all_spot_top',
            coins: ['BTC'],
            filters: ['30_min', 'buy'],
            plainText: 'Top 10 Buying coins on all spot in the last 30 minutes'
          }),
          makeEvent('raw_unclassified', {
            id: 'raw-derivatives-60m',
            title: 'Unclassified all_derivatives_top event',
            chapter: 'cex_alerts',
            category: 'all_derivatives_top',
            coins: ['BTC'],
            filters: ['60_min', 'sell'],
            plainText: 'Top 10 Selling coins on all derivatives in the last 60 minutes'
          })
        ]
      })
    })} />);

    await user.click(await screen.findByRole('button', { name: 'BTC' }));

    expect(await screen.findByRole('heading', { name: 'Flow Components' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Latest Normalized Events' })).not.toBeInTheDocument();
    expect(screen.queryByText('BTC 5m spot top buy')).not.toBeInTheDocument();
    expect(screen.queryByText('BTC live price alert')).not.toBeInTheDocument();
    expect(screen.queryByText('Unclassified all_spot_top event')).not.toBeInTheDocument();
    expect(screen.queryByText('Unclassified all_derivatives_top event')).not.toBeInTheDocument();
  });

  it('shows flow-v2 state, action, and component breakdown in score detail', async () => {
    const user = userEvent.setup();
    const flowScore = makeFlowScoreSummary({
      coin: 'HYPE',
      tradeAction: 'WATCH',
      primaryReason: 'Spot buy pressure',
      componentScores: {
        spot: { bull: 32.05, bear: 3.4 },
        derivatives: { bull: 15.8, bear: 2.25 },
        topOi: { bull: 8.05, bear: 1.5 },
        bigActivity: { bull: 10.5, bear: 0 }
      },
      flowBreakdown: [
        { family: 'spot', side: 'bull', score: 32.05, rawScore: 34.2, maxScore: 35, multiplier: 0.94, effectiveHits: 4, thinLiquidity: false, newestReceivedAt: '2026-01-01T00:14:00.000Z' },
        { family: 'spot', side: 'bear', score: 3.4, rawScore: 4, maxScore: 35, multiplier: 0.85, effectiveHits: 1, thinLiquidity: true, newestReceivedAt: '2026-01-01T00:13:00.000Z' },
        { family: 'derivatives', side: 'bull', score: 15.8, rawScore: 20, maxScore: 25, multiplier: 0.79, effectiveHits: 2, thinLiquidity: false },
        { family: 'derivatives', side: 'bear', score: 2.25, rawScore: 7.5, maxScore: 25, multiplier: 0.3, effectiveHits: 1, thinLiquidity: false },
        { family: 'topOi', side: 'bull', score: 8.05, rawScore: 8.05, maxScore: 10, multiplier: 1, effectiveHits: 1, thinLiquidity: false },
        { family: 'topOi', side: 'bear', score: 1.5, rawScore: 1.5, maxScore: 10, multiplier: 1, effectiveHits: 1, thinLiquidity: false },
        { family: 'bigActivity', side: 'bull', score: 10.5, rawScore: 10.5, maxScore: 15, multiplier: 1, effectiveHits: 2, thinLiquidity: false },
        { family: 'bigActivity', side: 'bear', score: 0, rawScore: 0, maxScore: 15, multiplier: 1, effectiveHits: 0, thinLiquidity: false }
      ]
    });
    apiMocks.fetchScoresTop.mockImplementation((_token, query: { side?: string }) => {
      if (query.side === 'bear') return Promise.resolve(makeScoresListResponse({ kind: 'top', side: 'bear', scores: [] }));
      return Promise.resolve(makeScoresListResponse({ kind: 'top', side: 'bull', scoreConfigVersion: 'flow-v2', scores: [flowScore] }));
    });
    apiMocks.fetchScoreDetail.mockResolvedValue(makeScoreDetailResponse({ scoreConfigVersion: 'flow-v2', coin: 'HYPE', score: flowScore }));

    render(<ScoresPage {...makeProps({ snapshot: makeSnapshot() })} />);

    await user.click(await screen.findByRole('button', { name: 'HYPE' }));

    expect(await screen.findByRole('heading', { name: 'Flow Components' })).toBeInTheDocument();
    expect(screen.getByText('Flow State')).toBeInTheDocument();
    expect(screen.getAllByText('Clean Bull').length).toBeGreaterThan(0);
    expect(screen.getByText('Action')).toBeInTheDocument();
    expect(screen.getAllByText('Watch').length).toBeGreaterThan(0);
    expect(screen.getByText('Spot')).toBeInTheDocument();
    expect(screen.getByText('32.1 / 3.4')).toBeInTheDocument();
    expect(screen.getByText('Derivatives')).toBeInTheDocument();
    expect(screen.getByText('15.8 / 2.3')).toBeInTheDocument();
  });

  it('shows clear per-family flow breakdown lanes in the score detail popup', async () => {
    const user = userEvent.setup();
    const flowScore = makeFlowScoreSummary({
      coin: 'HYPE',
      componentScores: {
        spot: { bull: 32.05, bear: 3.4 },
        derivatives: { bull: 15.8, bear: 2.25 },
        topOi: { bull: 8.05, bear: 1.5 },
        bigActivity: { bull: 10.5, bear: 0 }
      },
      flowBreakdown: [
        { family: 'spot', side: 'bull', score: 32.05, rawScore: 34.2, maxScore: 35, multiplier: 0.94, effectiveHits: 4, thinLiquidity: false },
        { family: 'spot', side: 'bear', score: 3.4, rawScore: 4, maxScore: 35, multiplier: 0.85, effectiveHits: 1, thinLiquidity: true },
        { family: 'derivatives', side: 'bull', score: 15.8, rawScore: 20, maxScore: 25, multiplier: 0.79, effectiveHits: 2, thinLiquidity: false },
        { family: 'derivatives', side: 'bear', score: 2.25, rawScore: 7.5, maxScore: 25, multiplier: 0.3, effectiveHits: 1, thinLiquidity: false },
        { family: 'topOi', side: 'bull', score: 8.05, rawScore: 8.05, maxScore: 10, multiplier: 1, effectiveHits: 1, thinLiquidity: false },
        { family: 'topOi', side: 'bear', score: 1.5, rawScore: 1.5, maxScore: 10, multiplier: 1, effectiveHits: 1, thinLiquidity: false },
        { family: 'bigActivity', side: 'bull', score: 10.5, rawScore: 10.5, maxScore: 15, multiplier: 1, effectiveHits: 2, thinLiquidity: false },
        { family: 'bigActivity', side: 'bear', score: 0, rawScore: 0, maxScore: 15, multiplier: 1, effectiveHits: 0, thinLiquidity: false }
      ]
    });
    apiMocks.fetchScoresTop.mockImplementation((_token, query: { side?: string }) => {
      if (query.side === 'bear') return Promise.resolve(makeScoresListResponse({ kind: 'top', side: 'bear', scores: [] }));
      return Promise.resolve(makeScoresListResponse({ kind: 'top', side: 'bull', scoreConfigVersion: 'flow-v2', scores: [flowScore] }));
    });
    apiMocks.fetchScoreDetail.mockResolvedValue(makeScoreDetailResponse({ scoreConfigVersion: 'flow-v2', coin: 'HYPE', score: flowScore }));

    render(<ScoresPage {...makeProps({ snapshot: makeSnapshot() })} />);

    await user.click(await screen.findByRole('button', { name: 'HYPE' }));

    const spot = await screen.findByLabelText('Spot breakdown');
    expect(within(spot).getByText('Bull Pressure')).toBeInTheDocument();
    expect(within(spot).getByText('Bear Pressure')).toBeInTheDocument();
    expect(within(spot).getByText('32.05')).toBeInTheDocument();
    expect(within(spot).getByLabelText('Spot Bull pressure bar')).toBeInTheDocument();
    expect(within(spot).getAllByText('Raw').length).toBeGreaterThan(0);
    expect(within(spot).getByText('34.2')).toBeInTheDocument();
    expect(within(spot).getAllByText('Capacity').length).toBeGreaterThan(0);
    expect(within(spot).getAllByText('35').length).toBeGreaterThan(0);
    expect(within(spot).getAllByText('Hits').length).toBeGreaterThan(0);
    expect(within(spot).getAllByText('4').length).toBeGreaterThan(0);
    expect(within(spot).getAllByText('Multiplier').length).toBeGreaterThan(0);
    expect(within(spot).getByText('0.94x')).toBeInTheDocument();
    expect(within(spot).getByText('Thin cap')).toBeInTheDocument();

    const derivatives = screen.getByLabelText('Derivatives breakdown');
    expect(within(derivatives).getByText('Bear Pressure')).toBeInTheDocument();
    expect(within(derivatives).getByText('2.25')).toBeInTheDocument();
    expect(within(derivatives).getByText('0.3x')).toBeInTheDocument();

    expect(screen.getByLabelText('Top OI breakdown')).toBeInTheDocument();
    expect(screen.getByLabelText('Big Activity breakdown')).toBeInTheDocument();
  });

  it('shows formula subpoints and caps in the score detail popup', async () => {
    const user = userEvent.setup();
    const flowScore = makeFlowScoreSummary({
      coin: 'HYPE',
      componentScores: {
        spot: { bull: 37.52, bear: 0 },
        derivatives: { bull: 0, bear: 0 },
        topOi: { bull: 0, bear: 0 },
        bigActivity: { bull: 0, bear: 0 }
      },
      flowBreakdown: [
        {
          family: 'spot',
          side: 'bull',
          score: 37.52,
          rawScore: 37.52,
          maxScore: 41,
          multiplier: 1,
          effectiveHits: 4,
          rawBeforeCap: 37.52,
          volumeCap: 41,
          activityCap: 41,
          hitPoints: 4.8,
          thinLiquidity: false,
          subpoints: {
            dominance: 4,
            dominancePoints: 19.43,
            relativeImpact: 3,
            relativeImpactPoints: 7.54,
            deltaPoints: 3.5,
            rankPoints: 2.25,
            hitPoints: 4.8
          }
        },
        { family: 'spot', side: 'bear', score: 0, rawScore: 0, maxScore: 41, multiplier: 1, effectiveHits: 0, thinLiquidity: false }
      ]
    });
    apiMocks.fetchScoresTop.mockImplementation((_token, query: { side?: string }) => {
      if (query.side === 'bear') return Promise.resolve(makeScoresListResponse({ kind: 'top', side: 'bear', scores: [] }));
      return Promise.resolve(makeScoresListResponse({ kind: 'top', side: 'bull', scoreConfigVersion: 'flow-v2', scores: [flowScore] }));
    });
    apiMocks.fetchScoreDetail.mockResolvedValue(makeScoreDetailResponse({ scoreConfigVersion: 'flow-v2', coin: 'HYPE', score: flowScore }));

    render(<ScoresPage {...makeProps({ snapshot: makeSnapshot() })} />);

    await user.click(await screen.findByRole('button', { name: 'HYPE' }));

    const spot = await screen.findByLabelText('Spot breakdown');
    expect(within(spot).getByText('Math')).toBeInTheDocument();
    expect(within(spot).getByText('Dominance')).toBeInTheDocument();
    expect(within(spot).getByText('19.43')).toBeInTheDocument();
    expect(within(spot).getByText('Rel impact')).toBeInTheDocument();
    expect(within(spot).getByText('7.54')).toBeInTheDocument();
    expect(within(spot).getByText('Delta')).toBeInTheDocument();
    expect(within(spot).getByText('3.5')).toBeInTheDocument();
    expect(within(spot).getByText('Rank')).toBeInTheDocument();
    expect(within(spot).getByText('2.25')).toBeInTheDocument();
    expect(within(spot).getByText('1h hits')).toBeInTheDocument();
    expect(within(spot).getByText('4.8')).toBeInTheDocument();
    expect(within(spot).getByText('Caps')).toBeInTheDocument();
    expect(within(spot).getByText('Volume cap')).toBeInTheDocument();
    expect(within(spot).getByText('Activity cap')).toBeInTheDocument();
    expect(within(spot).getByText('min(37.52, 41, 41, 41) = 37.52')).toBeInTheDocument();
  });

  it('collapses empty component details in the compact score detail popup', async () => {
    const user = userEvent.setup();
    const flowScore = makeFlowScoreSummary({
      coin: 'PHA',
      componentScores: {
        spot: { bull: 20.58, bear: 0 },
        derivatives: { bull: 0, bear: 0 },
        topOi: { bull: 0, bear: 0 },
        bigActivity: { bull: 0, bear: 0 }
      },
      flowBreakdown: [
        { family: 'spot', side: 'bull', score: 20.58, rawScore: 20.58, maxScore: 41, multiplier: 1, effectiveHits: 0, thinLiquidity: false },
        { family: 'spot', side: 'bear', score: 0, rawScore: 0, maxScore: 41, multiplier: 1, effectiveHits: 1, thinLiquidity: false },
        { family: 'derivatives', side: 'bull', score: 0, rawScore: 0, maxScore: 29, multiplier: 1, effectiveHits: 0, thinLiquidity: false },
        { family: 'derivatives', side: 'bear', score: 0, rawScore: 0, maxScore: 29, multiplier: 1, effectiveHits: 0, thinLiquidity: false },
        { family: 'topOi', side: 'bull', score: 0, rawScore: 0, maxScore: 12, multiplier: 1, effectiveHits: 0, thinLiquidity: false },
        { family: 'bigActivity', side: 'bull', score: 0, rawScore: 0, maxScore: 18, multiplier: 1, effectiveHits: 0, thinLiquidity: false }
      ]
    });
    apiMocks.fetchScoresTop.mockImplementation((_token, query: { side?: string }) => {
      if (query.side === 'bear') return Promise.resolve(makeScoresListResponse({ kind: 'top', side: 'bear', scores: [] }));
      return Promise.resolve(makeScoresListResponse({ kind: 'top', side: 'bull', scoreConfigVersion: 'flow-v2', scores: [flowScore] }));
    });
    apiMocks.fetchScoreDetail.mockResolvedValue(makeScoreDetailResponse({ scoreConfigVersion: 'flow-v2', coin: 'PHA', score: flowScore }));

    render(<ScoresPage {...makeProps({ snapshot: makeSnapshot() })} />);

    await user.click(await screen.findByRole('button', { name: 'PHA' }));

    expect(await screen.findByLabelText('Spot breakdown')).toBeInTheDocument();
    expect(screen.getByText('Derivatives')).toBeInTheDocument();
    expect(screen.queryByLabelText('Derivatives bull bear balance')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Derivatives breakdown')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Top OI breakdown')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Big Activity breakdown')).not.toBeInTheDocument();
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

function makeFlowScoreSummary(overrides: Partial<ReturnType<typeof makeScoreSummary>> = {}) {
  return makeScoreSummary({
    scoreConfigVersion: 'flow-v2',
    scoreState: 'clean_bull',
    tradeAction: 'LONG_WATCH',
    componentScores: {
      spot: { bull: 32.05, bear: 0 },
      derivatives: { bull: 15.8, bear: 0 },
      topOi: { bull: 8.05, bear: 0 },
      bigActivity: { bull: 10.5, bear: 0 }
    },
    flowBreakdown: [
      { family: 'spot', side: 'bull', score: 32.05, rawScore: 32.05, maxScore: 35, multiplier: 1, effectiveHits: 4 },
      { family: 'derivatives', side: 'bull', score: 15.8, rawScore: 15.8, maxScore: 25, multiplier: 1, effectiveHits: 1 },
      { family: 'topOi', side: 'bull', score: 8.05, rawScore: 8.05, maxScore: 10, multiplier: 1, effectiveHits: 1 },
      { family: 'bigActivity', side: 'bull', score: 10.5, rawScore: 10.5, maxScore: 15, multiplier: 1, effectiveHits: 2 }
    ],
    primaryReason: 'Spot flow confirmation',
    ...overrides
  });
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
