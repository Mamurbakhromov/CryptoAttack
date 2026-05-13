import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchScoreDetail, fetchScoreEvidence, fetchScoreMarketRegime, fetchScoresCurrent, fetchScoresTop, fetchScoreTimeline } from './sse';
import { makeScoreDetailResponse, makeScoreEvidenceResponse, makeScoreMarketRegimeResponse, makeScoresListResponse, makeScoreTimelineResponse } from '../test/scoreBuilders';

describe('score API client functions', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => makeScoresListResponse() })));
  });

  it('serializes top score query filters', async () => {
    await fetchScoresTop('token', { side: 'bull', limit: 10, minConfidence: 70, halal: true, exchange: 'binance', market: 'spot', windowMinutes: 15 });

    expect(fetch).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: '/api/scores/top', search: '?side=bull&limit=10&minConfidence=70&halal=true&exchange=binance&market=spot&windowMinutes=15' }),
      expect.objectContaining({ headers: { Authorization: 'Bearer token' } })
    );
  });

  it('calls all score endpoints with encoded coins', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(response(makeScoresListResponse({ kind: 'current' })));
    await fetchScoresCurrent(null, { side: 'net', limit: 50 });
    fetchMock.mockResolvedValueOnce(response(makeScoreMarketRegimeResponse()));
    await fetchScoreMarketRegime(null, { limit: 500 });
    fetchMock.mockResolvedValueOnce(response(makeScoreDetailResponse()));
    await fetchScoreDetail(null, 'btc/usdt', { windowMinutes: 15 });
    fetchMock.mockResolvedValueOnce(response(makeScoreTimelineResponse()));
    await fetchScoreTimeline(null, 'BTC', { limit: 60 });
    fetchMock.mockResolvedValueOnce(response(makeScoreEvidenceResponse()));
    await fetchScoreEvidence(null, 'BTC', { side: 'net', limit: 80 });

    expect(fetchMock.mock.calls.map(([url]) => (url as URL).pathname)).toEqual([
      '/api/scores/current',
      '/api/scores/market-regime',
      '/api/scores/btc%2Fusdt',
      '/api/scores/BTC/timeline',
      '/api/scores/BTC/evidence'
    ]);
  });

  it('throws on non-ok score responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })));

    await expect(fetchScoresTop(null, { side: 'bear' })).rejects.toThrow('Request /api/scores/top?side=bear failed with 503');
  });
});

function response(value: unknown): Response {
  return { ok: true, json: async () => value } as Response;
}
