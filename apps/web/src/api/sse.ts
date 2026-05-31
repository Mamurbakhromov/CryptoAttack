import type { AmountsFeedHistoryResponse, AmountsHistoryResponse, ApiStatus, ClearEventDataResponse, DashboardSnapshot, ExchangeKey, ExchangeSymbolsQuery, ExchangeSymbolsRefreshResult, ExchangeSymbolsResponse, NormalizedEvent, ResetAllStoredDataResponse, ScoreDetailResponse, ScoreEvidenceResponse, ScoreListQuery, ScoreMarketRegimeResponse, ScoreSnapshotSseEvent, ScoreTimelineResponse, ScoreUpdateSseEvent, ScoresListResponse, ScoringConfigCurrentResponse, SpotPerformanceResponse, StorageStatusResponse, StreamState, TopOiFeedHistoryResponse, TopOiHistoryResponse, TopOiHistorySide, TopSpotFeedHistoryResponse, TopSpotHistoryMarket, TopSpotHistoryResponse, TopSpotHistorySide } from '../types';

interface StreamHandlers {
  token: string | null;
  onSnapshot: (snapshot: DashboardSnapshot) => void;
  onEvent: (event: NormalizedEvent) => void;
  onStatus: (status: ApiStatus) => void;
  onSpotPerformance?: (response: SpotPerformanceResponse) => void;
  onScoreUpdate?: (event: ScoreUpdateSseEvent) => void;
  onScoreSnapshot?: (event: ScoreSnapshotSseEvent) => void;
  onStorageStatus?: (status: StorageStatusResponse) => void;
  onStateChange: (state: StreamState) => void;
}

export function connectDashboardStream(handlers: StreamHandlers): EventSource {
  const url = buildApiUrl('/api/stream');
  if (handlers.token) url.searchParams.set('token', handlers.token);

  const source = new EventSource(url);
  handlers.onStateChange('connecting');

  source.onopen = () => handlers.onStateChange('open');
  source.onerror = () => handlers.onStateChange('error');

  source.addEventListener('snapshot', (message) => {
    handlers.onSnapshot(JSON.parse(message.data) as DashboardSnapshot);
  });

  source.addEventListener('event', (message) => {
    handlers.onEvent(JSON.parse(message.data) as NormalizedEvent);
  });

  source.addEventListener('status', (message) => {
    handlers.onStatus(JSON.parse(message.data) as ApiStatus);
  });

  source.addEventListener('spot-performance', (message) => {
    handlers.onSpotPerformance?.(JSON.parse(message.data) as SpotPerformanceResponse);
  });

  source.addEventListener('score-update', (message) => {
    handlers.onScoreUpdate?.(JSON.parse(message.data) as ScoreUpdateSseEvent);
  });

  source.addEventListener('score-snapshot', (message) => {
    handlers.onScoreSnapshot?.(JSON.parse(message.data) as ScoreSnapshotSseEvent);
  });

  source.addEventListener('storage-status', (message) => {
    handlers.onStorageStatus?.(JSON.parse(message.data) as StorageStatusResponse);
  });

  return source;
}

export async function fetchDashboardSnapshot(token: string | null, signal?: AbortSignal): Promise<DashboardSnapshot> {
  return fetchJson<DashboardSnapshot>('/api/snapshot', token, signal);
}

export async function fetchDashboardStatus(token: string | null, signal?: AbortSignal): Promise<ApiStatus> {
  return fetchJson<ApiStatus>('/api/status', token, signal);
}

export async function clearEventData(token: string | null, adminToken: string | null, signal?: AbortSignal): Promise<ClearEventDataResponse> {
  return fetchJson<ClearEventDataResponse>('/api/storage/events', token, signal, {
    method: 'DELETE',
    headers: adminHeaders(adminToken)
  });
}

export async function resetAllStoredData(token: string | null, adminToken: string | null, signal?: AbortSignal): Promise<ResetAllStoredDataResponse> {
  return fetchJson<ResetAllStoredDataResponse>('/api/storage/all-data', token, signal, {
    method: 'DELETE',
    headers: adminHeaders(adminToken)
  });
}

export async function fetchExchangeSymbols(token: string | null, query: ExchangeSymbolsQuery, signal?: AbortSignal): Promise<ExchangeSymbolsResponse> {
  const params = new URLSearchParams();
  if (query.exchange) params.set('exchange', query.exchange);
  if (query.market) params.set('market', query.market);
  if (query.search) params.set('search', query.search);
  if (query.quoteAsset) params.set('quoteAsset', query.quoteAsset);
  if (query.status) params.set('status', query.status);
  if (query.limit) params.set('limit', String(query.limit));
  if (query.offset) params.set('offset', String(query.offset));
  const suffix = params.size ? `?${params.toString()}` : '';
  return fetchJson<ExchangeSymbolsResponse>(`/api/exchange-symbols${suffix}`, token, signal);
}

export async function refreshExchangeSymbols(token: string | null, signal?: AbortSignal): Promise<ExchangeSymbolsRefreshResult> {
  return fetchJson<ExchangeSymbolsRefreshResult>('/api/exchange-symbols/refresh', token, signal, { method: 'POST' });
}

export async function fetchSpotPerformance(token: string | null, query: { exchange?: ExchangeKey; limit?: number }, signal?: AbortSignal): Promise<SpotPerformanceResponse> {
  const params = new URLSearchParams();
  if (query.exchange) params.set('exchange', query.exchange);
  if (query.limit) params.set('limit', String(query.limit));
  const suffix = params.size ? `?${params.toString()}` : '';
  return fetchJson<SpotPerformanceResponse>(`/api/spot-performance${suffix}`, token, signal);
}

export async function fetchScoresTop(token: string | null, query: ScoreListQuery, signal?: AbortSignal): Promise<ScoresListResponse> {
  return fetchJson<ScoresListResponse>(`/api/scores/top${scoreQuerySuffix(query)}`, token, signal);
}

export async function fetchScoresCurrent(token: string | null, query: ScoreListQuery, signal?: AbortSignal): Promise<ScoresListResponse> {
  return fetchJson<ScoresListResponse>(`/api/scores/current${scoreQuerySuffix(query)}`, token, signal);
}

export async function fetchScoreDetail(token: string | null, coin: string, query: ScoreListQuery, signal?: AbortSignal): Promise<ScoreDetailResponse> {
  return fetchJson<ScoreDetailResponse>(`/api/scores/${encodeURIComponent(coin)}${scoreQuerySuffix(query)}`, token, signal);
}

export async function fetchScoreTimeline(token: string | null, coin: string, query: ScoreListQuery, signal?: AbortSignal): Promise<ScoreTimelineResponse> {
  return fetchJson<ScoreTimelineResponse>(`/api/scores/${encodeURIComponent(coin)}/timeline${scoreQuerySuffix(query)}`, token, signal);
}

export async function fetchScoreEvidence(token: string | null, coin: string, query: ScoreListQuery, signal?: AbortSignal): Promise<ScoreEvidenceResponse> {
  return fetchJson<ScoreEvidenceResponse>(`/api/scores/${encodeURIComponent(coin)}/evidence${scoreQuerySuffix(query)}`, token, signal);
}

export async function fetchScoreMarketRegime(token: string | null, query: ScoreListQuery, signal?: AbortSignal): Promise<ScoreMarketRegimeResponse> {
  return fetchJson<ScoreMarketRegimeResponse>(`/api/scores/market-regime${scoreQuerySuffix(query)}`, token, signal);
}

export async function fetchScoringConfigCurrent(token: string | null, query: { includeRules?: boolean } = {}, signal?: AbortSignal): Promise<ScoringConfigCurrentResponse> {
  const params = new URLSearchParams();
  if (query.includeRules !== undefined) params.set('includeRules', String(query.includeRules));
  const suffix = params.size ? `?${params.toString()}` : '';
  return fetchJson<ScoringConfigCurrentResponse>(`/api/scoring/config/current${suffix}`, token, signal);
}

export async function fetchTopSpotFeedHistory(token: string | null, query: { from: string; to: string }, signal?: AbortSignal): Promise<TopSpotFeedHistoryResponse> {
  const params = new URLSearchParams();
  params.set('from', query.from);
  params.set('to', query.to);
  return fetchJson<TopSpotFeedHistoryResponse>(`/api/history/top-spot?${params.toString()}`, token, signal);
}

export async function fetchTopSpotHistory(token: string | null, coin: string, query: { from: string; to: string; market: TopSpotHistoryMarket; side: TopSpotHistorySide }, signal?: AbortSignal): Promise<TopSpotHistoryResponse> {
  const params = new URLSearchParams();
  params.set('from', query.from);
  params.set('to', query.to);
  params.set('market', query.market);
  params.set('side', query.side);
  return fetchJson<TopSpotHistoryResponse>(`/api/history/top-spot/${encodeURIComponent(coin)}?${params.toString()}`, token, signal);
}

export async function fetchTopOiFeedHistory(token: string | null, query: { from: string; to: string }, signal?: AbortSignal): Promise<TopOiFeedHistoryResponse> {
  const params = new URLSearchParams();
  params.set('from', query.from);
  params.set('to', query.to);
  return fetchJson<TopOiFeedHistoryResponse>(`/api/history/top-oi?${params.toString()}`, token, signal);
}

export async function fetchTopOiHistory(token: string | null, coin: string, query: { from: string; to: string; side: TopOiHistorySide }, signal?: AbortSignal): Promise<TopOiHistoryResponse> {
  const params = new URLSearchParams();
  params.set('from', query.from);
  params.set('to', query.to);
  params.set('side', query.side);
  return fetchJson<TopOiHistoryResponse>(`/api/history/top-oi/${encodeURIComponent(coin)}?${params.toString()}`, token, signal);
}

export async function fetchAmountsFeedHistory(token: string | null, query: { from: string; to: string }, signal?: AbortSignal): Promise<AmountsFeedHistoryResponse> {
  const params = new URLSearchParams();
  params.set('from', query.from);
  params.set('to', query.to);
  return fetchJson<AmountsFeedHistoryResponse>(`/api/history/amounts?${params.toString()}`, token, signal);
}

export async function fetchAmountsHistory(token: string | null, coin: string, query: { from: string; to: string; market: TopSpotHistoryMarket; side: TopSpotHistorySide }, signal?: AbortSignal): Promise<AmountsHistoryResponse> {
  const params = new URLSearchParams();
  params.set('from', query.from);
  params.set('to', query.to);
  params.set('market', query.market);
  params.set('side', query.side);
  return fetchJson<AmountsHistoryResponse>(`/api/history/amounts/${encodeURIComponent(coin)}?${params.toString()}`, token, signal);
}

export function getEnvDashboardAuthToken(): string | null {
  const token = import.meta.env.VITE_DASHBOARD_AUTH_TOKEN as string | undefined;
  return token?.trim() || null;
}

function getApiBaseUrl(): string {
  const value = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();
  return value ? value.replace(/\/+$/, '') : window.location.origin;
}

function buildApiUrl(path: string): URL {
  return new URL(path, getApiBaseUrl());
}

function scoreQuerySuffix(query: ScoreListQuery): string {
  const params = new URLSearchParams();
  if (query.side) params.set('side', query.side);
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  if (query.minConfidence !== undefined) params.set('minConfidence', String(query.minConfidence));
  if (query.halal !== undefined && query.halal !== null) params.set('halal', String(query.halal));
  if (query.exchange) params.set('exchange', query.exchange);
  if (query.market) params.set('market', query.market);
  if (query.updatedSince) params.set('updatedSince', query.updatedSince);
  if (query.windowMinutes !== undefined) params.set('windowMinutes', String(query.windowMinutes));
  if (query.scoreConfigVersion) params.set('scoreConfigVersion', query.scoreConfigVersion);
  return params.size ? `?${params.toString()}` : '';
}

async function fetchJson<T>(path: string, token: string | null, signal?: AbortSignal, init: RequestInit = {}): Promise<T> {
  if (signal) init.signal = signal;
  if (token) {
    init.headers = {
      ...headersToRecord(init.headers),
      Authorization: `Bearer ${token}`
    };
  }

  const response = await fetch(buildApiUrl(path), init);

  if (!response.ok) {
    let message = `Request ${path} failed with ${response.status}`;
    try {
      const body = await response.json() as { error?: unknown; reason?: unknown };
      const detail = typeof body.error === 'string' ? body.error : typeof body.reason === 'string' ? body.reason : null;
      if (detail) message = `${message}: ${detail}`;
    } catch {
      // Keep the status-only message when the response body is not JSON.
    }
    throw new Error(message);
  }

  return (await response.json()) as T;
}

function adminHeaders(adminToken: string | null): Record<string, string> {
  return adminToken ? { 'x-dashboard-admin-token': adminToken } : {};
}

function headersToRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  return headers;
}
