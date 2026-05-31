import { useEffect, useMemo, useRef, useState } from 'react';

import { clearEventData, connectDashboardStream, fetchDashboardSnapshot, fetchDashboardStatus, fetchExchangeSymbols, getEnvDashboardAuthToken, resetAllStoredData } from './api/sse';
import type { CoinClassificationFilter } from './coinClassification';
import { AmountsPage } from './components/AmountsPage';
import { BigActivitiesPage } from './components/BigActivitiesPage';
import { CoinHistoryPage } from './components/CoinHistoryPage';
import { Dashboard } from './components/Dashboard';
import { DebugPage } from './components/DebugPage';
import { buildExchangeAvailability, emptyExchangeAvailability, type ExchangeAvailabilityByMarket } from './components/ExchangeChips';
import { ExchangeCoinsPage } from './components/ExchangeCoinsPage';
import { FlowsPage } from './components/FlowsPage';
import { MarketDataPage } from './components/MarketDataPage';
import { normalizePerformanceCoin, type PerformanceTrendByCoin } from './components/PerformanceTrendChips';
import { OnchainAlphaPage } from './components/OnchainAlphaPage';
import { PerformancePage } from './components/PerformancePage';
import { PlaceholderPage } from './components/PlaceholderPage';
import { OpenInterestAlertsPage } from './components/OpenInterestAlertsPage';
import { ScoresPage } from './components/ScoresPage';
import { SignalsPage } from './components/SignalsPage';
import { StatusBar } from './components/StatusBar';
import { isExchangeFilterActive, isMarketFilterActive, marketFilterAllows, matchesExchangeFilterByCoin, matchesExchangeFilterByExchange, type ExchangeFilter, type MarketFilter } from './exchangeFilters';
import { feedKeys, type ApiStatus, type DashboardSnapshot, type ExchangeKey, type FeedKey, type NormalizedEvent, type ScoreSnapshotSseEvent, type ScoreUpdateSseEvent, type SpotPerformanceResponse, type StorageStatusResponse, type StreamState } from './types';

const alertFeedKeys = new Set<FeedKey>(['listings', 'delistings']);
type ThemeMode = 'dark' | 'light';
type DashboardPage =
  | 'bull'
  | 'bear'
  | 'scores'
  | 'amounts-bull'
  | 'amounts-sell'
  | 'price-alerts'
  | 'volume-alerts'
  | 'big-buying'
  | 'big-selling'
  | 'big-activities'
  | 'oi-alerts'
  | 'market-data'
  | 'flows'
  | 'onchain-alpha'
  | 'news'
  | 'coins'
  | 'performance'
  | 'history'
  | 'debug';

type NavigableDashboardPage = DashboardPage;

const pageNavItems: Array<{ page: NavigableDashboardPage; label: string; path: string }> = [
  { page: 'history', label: 'History', path: '/history' },
  { page: 'bull', label: 'Top Spot', path: '/bull' },
  { page: 'bear', label: 'OI and Listings', path: '/bear' },
  { page: 'scores', label: 'Scores', path: '/scores' },
  { page: 'amounts-bull', label: 'Bull %', path: '/amounts-bull' },
  { page: 'amounts-sell', label: 'Bear %', path: '/amounts-sell' },
  { page: 'price-alerts', label: 'Price Alerts', path: '/price-alerts' },
  { page: 'volume-alerts', label: 'Volume Alerts', path: '/volume-alerts' },
  { page: 'big-buying', label: 'Big Buying', path: '/big-buying' },
  { page: 'big-selling', label: 'Big Selling', path: '/big-selling' },
  { page: 'big-activities', label: 'Big activities', path: '/big-activities' },
  { page: 'oi-alerts', label: 'OI Alerts', path: '/oi-alerts' },
  { page: 'market-data', label: 'Funding', path: '/funding' },
  { page: 'flows', label: 'Flows', path: '/flows' },
  { page: 'onchain-alpha', label: 'On chain/alpha', path: '/onchain-alpha' },
  { page: 'news', label: 'News', path: '/news' },
  { page: 'coins', label: 'Coins', path: '/coins' },
  { page: 'performance', label: 'Performance', path: '/performance' },
  { page: 'debug', label: 'Debug', path: '/debug' }
];

const pagePathByKey = Object.fromEntries(pageNavItems.map((item) => [item.page, item.path])) as Record<NavigableDashboardPage, string>;

export default function App() {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot>(() => createEmptySnapshot());
  const [status, setStatus] = useState<ApiStatus | null>(null);
  const [streamState, setStreamState] = useState<StreamState>('connecting');
  const [paused, setPaused] = useState(false);
  const [queuedCount, setQueuedCount] = useState(0);
  const [highlightedIds, setHighlightedIds] = useState<Set<string>>(() => new Set());
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [authToken] = useState(() => getDashboardToken());
  const [adminToken, setAdminToken] = useState(() => getDashboardAdminToken());
  const [apiError, setApiError] = useState<string | null>(null);
  const [page, setPage] = useState<DashboardPage>(() => getDashboardPage());
  const [routeLocation, setRouteLocation] = useState(() => `${window.location.pathname}${window.location.search}`);
  const [theme, setTheme] = useState<ThemeMode>(() => getInitialTheme());
  const [exchangeAvailability, setExchangeAvailability] = useState<ExchangeAvailabilityByMarket>(() => emptyExchangeAvailability());
  const [classificationFilter, setClassificationFilter] = useState<CoinClassificationFilter>(() => ['halal']);
  const [exchangeFilter, setExchangeFilter] = useState<ExchangeFilter>([]);
  const [marketFilter, setMarketFilter] = useState<MarketFilter>([]);
  const [spotPerformanceByExchange, setSpotPerformanceByExchange] = useState<Partial<Record<ExchangeKey, SpotPerformanceResponse>>>({});
  const [liveScoreUpdate, setLiveScoreUpdate] = useState<ScoreUpdateSseEvent | null>(null);
  const [liveScoreSnapshot, setLiveScoreSnapshot] = useState<ScoreSnapshotSseEvent | null>(null);
  const [storageStatus, setStorageStatus] = useState<StorageStatusResponse | null>(null);
  const [eventClearState, setEventClearState] = useState<'idle' | 'clearing' | 'success' | 'error'>('idle');
  const [eventClearMessage, setEventClearMessage] = useState<string | null>(null);
  const [dataResetState, setDataResetState] = useState<'idle' | 'resetting' | 'success' | 'error'>('idle');
  const [dataResetMessage, setDataResetMessage] = useState<string | null>(null);

  const pausedRef = useRef(paused);
  const queuedEventsRef = useRef<NormalizedEvent[]>([]);
  const soundEnabledRef = useRef(soundEnabled);
  const notificationsEnabledRef = useRef(notificationsEnabled);
  const visibleSnapshot = useMemo(() => filterSnapshotByExchange(snapshot, exchangeAvailability, exchangeFilter, marketFilter), [exchangeAvailability, exchangeFilter, marketFilter, snapshot]);
  const performanceTrends = useMemo(() => buildPerformanceTrends(spotPerformanceByExchange), [spotPerformanceByExchange]);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);

  useEffect(() => {
    notificationsEnabledRef.current = notificationsEnabled;
  }, [notificationsEnabled]);

  useEffect(() => {
    const syncPage = () => {
      setPage(getDashboardPage());
      setRouteLocation(`${window.location.pathname}${window.location.search}`);
    };
    window.addEventListener('popstate', syncPage);
    return () => window.removeEventListener('popstate', syncPage);
  }, []);

  useEffect(() => {
    window.localStorage.setItem('cryptoattack.theme', theme);
    document.documentElement.dataset.theme = theme;
    document.body.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    const abortController = new AbortController();

    void fetchDashboardSnapshot(authToken, abortController.signal)
      .then((nextSnapshot) => {
        setSnapshot(nextSnapshot);
        setApiError(null);
      })
      .catch((error: unknown) => {
        if (!abortController.signal.aborted) setApiError(error instanceof Error ? error.message : String(error));
      });

    void fetchDashboardStatus(authToken, abortController.signal)
      .then((nextStatus) => {
        setStatus(nextStatus);
        setApiError(null);
      })
      .catch((error: unknown) => {
        if (!abortController.signal.aborted) setApiError(error instanceof Error ? error.message : String(error));
      });

    const source = connectDashboardStream({
      token: authToken,
      onSnapshot: (nextSnapshot) => {
        setSnapshot(nextSnapshot);
        setApiError(null);
      },
      onStatus: (nextStatus) => {
        setStatus(nextStatus);
        setApiError(null);
      },
      onSpotPerformance: (performance) => {
        if (performance.exchange === 'all') return;
        setSpotPerformanceByExchange((current) => ({
          ...current,
          [performance.exchange]: performance
        }));
      },
      onScoreUpdate: (event) => setLiveScoreUpdate(event),
      onScoreSnapshot: (event) => {
        setLiveScoreSnapshot(event);
        setStatus((current) => current?.workers ? { ...current, workers: { ...current.workers, scores: event.health } } : current);
      },
      onStorageStatus: (event) => {
        setStorageStatus(event);
        setStatus((current) => current ? { ...current, storage: event.storage, workers: event.workers } : current);
      },
      onStateChange: (nextState) => setStreamState(nextState),
      onEvent: (event) => {
        if (pausedRef.current) {
          queuedEventsRef.current.push(event);
          setQueuedCount(queuedEventsRef.current.length);
          return;
        }
        applyLiveEvent(event);
      }
    });

    return () => {
      abortController.abort();
      source.close();
      setStreamState('closed');
    };
  }, [authToken]);

  useEffect(() => {
    const abortController = new AbortController();
    void fetchExchangeSymbols(authToken, { status: 'active', limit: 10_000 }, abortController.signal)
      .then((response) => setExchangeAvailability(buildExchangeAvailability(response.symbols)))
      .catch(() => undefined);

    return () => abortController.abort();
  }, [authToken]);

  const applyLiveEvent = (event: NormalizedEvent) => {
    setSnapshot((current) => addEventToSnapshot(current, event));
    flashEvent(event.id);

    if (alertFeedKeys.has(event.feedKey)) {
      if (soundEnabledRef.current) playAlertSound(event.feedKey);
      if (notificationsEnabledRef.current) showNotification(event);
    }
  };

  const togglePause = () => {
    if (!paused) {
      setPaused(true);
      return;
    }

    const queued = queuedEventsRef.current.splice(0);
    setQueuedCount(0);
    setPaused(false);
    for (const event of queued) applyLiveEvent(event);
  };

  const toggleNotifications = async () => {
    if (!('Notification' in window)) return;
    if (!notificationsEnabled && Notification.permission === 'default') {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return;
    }
    if (Notification.permission === 'granted') setNotificationsEnabled((value) => !value);
  };

  const navigatePage = (nextPage: NavigableDashboardPage) => {
    const path = pagePathByKey[nextPage];
    if (window.location.pathname !== path) window.history.pushState({}, '', path);
    setPage(nextPage);
    setRouteLocation(`${window.location.pathname}${window.location.search}`);
  };

  const handleClearEventData = async () => {
    if (!adminToken) {
      setEventClearState('error');
      setEventClearMessage('Admin token required');
      return;
    }
    setEventClearState('clearing');
    setEventClearMessage(null);
    try {
      const response = await clearEventData(authToken, adminToken);
      queuedEventsRef.current = [];
      setQueuedCount(0);
      setHighlightedIds(new Set());
      setSnapshot(response.snapshot);
      setStatus(response.status);
      setStorageStatus(response.storageStatus);
      setApiError(null);
      setEventClearState('success');
      setEventClearMessage(response.database ? `Cleared ${response.database.tables.length} event tables` : 'Cleared live event data');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setEventClearState('error');
      setEventClearMessage(message);
      setApiError(message);
    }
  };

  const handleResetAllStoredData = async () => {
    if (!adminToken) {
      setDataResetState('error');
      setDataResetMessage('Admin token required');
      return;
    }
    setDataResetState('resetting');
    setDataResetMessage(null);
    try {
      const response = await resetAllStoredData(authToken, adminToken);
      queuedEventsRef.current = [];
      setQueuedCount(0);
      setHighlightedIds(new Set());
      setSnapshot(response.snapshot);
      setStatus(response.status);
      setStorageStatus(response.storageStatus);
      setLiveScoreUpdate(null);
      setLiveScoreSnapshot(response.scoreSnapshot);
      setApiError(null);
      setDataResetState('success');
      setDataResetMessage(formatResetAllDataMessage(response.database?.tables.length ?? 0, response.rawLog.bytesBefore));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setDataResetState('error');
      setDataResetMessage(message);
      setApiError(message);
    }
  };

  const flashEvent = (id: string) => {
    setHighlightedIds((current) => new Set(current).add(id));
    window.setTimeout(() => {
      setHighlightedIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }, 1_100);
  };

  const saveAdminToken = (token: string) => {
    const trimmed = token.trim();
    if (!trimmed) return;
    window.localStorage.setItem('cryptoattack.dashboardAdminToken', trimmed);
    setAdminToken(trimmed);
    setEventClearMessage(null);
    setDataResetMessage(null);
  };

  const clearAdminToken = () => {
    window.localStorage.removeItem('cryptoattack.dashboardAdminToken');
    setAdminToken(null);
  };

  return (
    <div className={`app-shell theme-${theme}`}>
      <StatusBar
        status={status}
        lastEventTime={snapshot.lastEventTime}
        latency={snapshot.latency}
        streamState={streamState}
        paused={paused}
        queuedCount={queuedCount}
        soundEnabled={soundEnabled}
        notificationsEnabled={notificationsEnabled}
        classificationFilter={classificationFilter}
        exchangeFilter={exchangeFilter}
        marketFilter={marketFilter}
        theme={theme}
        eventClearState={eventClearState}
        eventClearMessage={eventClearMessage}
        dataResetState={dataResetState}
        dataResetMessage={dataResetMessage}
        adminUnlocked={Boolean(adminToken)}
        onTogglePause={togglePause}
        onToggleSound={() => setSoundEnabled((value) => !value)}
        onToggleNotifications={() => void toggleNotifications()}
        onClassificationFilterChange={setClassificationFilter}
        onExchangeFilterChange={setExchangeFilter}
        onMarketFilterChange={setMarketFilter}
        onToggleTheme={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
        onAdminTokenSave={saveAdminToken}
        onAdminTokenClear={clearAdminToken}
        onClearEventData={() => void handleClearEventData()}
        onResetAllStoredData={() => void handleResetAllStoredData()}
      />
      {apiError ? (
        <div className="mx-auto mt-3 max-w-[1800px] px-4 md:px-6">
          <div className="warning-banner">
            API warning: {apiError}
          </div>
        </div>
      ) : null}
      <PageSwitcher page={page} onNavigate={navigatePage} />
      {page === 'history' ? (
        <CoinHistoryPage
          authToken={authToken}
          coin={getHistoryCoinFromPath(routeLocation) ?? ''}
          storageStateLabel={formatHistoryStorageLabel(storageStatus, status)}
          exchangeAvailability={exchangeAvailability}
          classificationFilter={classificationFilter}
          performanceTrends={performanceTrends}
        />
      ) : page === 'coins' ? (
        <ExchangeCoinsPage authToken={authToken} classificationFilter={classificationFilter} exchangeFilter={exchangeFilter} marketFilter={[]} />
      ) : page === 'scores' ? (
        <ScoresPage
          authToken={authToken}
          classificationFilter={classificationFilter}
          exchangeFilter={exchangeFilter}
          marketFilter={marketFilter}
          exchangeAvailability={exchangeAvailability}
          snapshot={visibleSnapshot}
          status={status}
          liveScoreUpdate={liveScoreUpdate}
          liveScoreSnapshot={liveScoreSnapshot}
          storageStatus={storageStatus}
        />
      ) : page === 'performance' ? (
        <PerformancePage authToken={authToken} classificationFilter={classificationFilter} exchangeFilter={exchangeFilter} marketFilter={[]} livePerformanceByExchange={spotPerformanceByExchange} />
      ) : page === 'price-alerts' ? (
        <SignalsPage snapshot={visibleSnapshot} highlightedIds={highlightedIds} classificationFilter={classificationFilter} performanceTrends={performanceTrends} alertKind="price" />
      ) : page === 'volume-alerts' ? (
        <SignalsPage snapshot={visibleSnapshot} highlightedIds={highlightedIds} classificationFilter={classificationFilter} performanceTrends={performanceTrends} alertKind="volume" />
      ) : page === 'oi-alerts' ? (
        <OpenInterestAlertsPage
          snapshot={visibleSnapshot}
          highlightedIds={highlightedIds}
          exchangeAvailability={exchangeAvailability}
          classificationFilter={classificationFilter}
          performanceTrends={performanceTrends}
        />
      ) : page === 'debug' ? (
        <DebugPage snapshot={snapshot} status={status} streamState={streamState} />
      ) : page === 'amounts-bull' ? (
        <AmountsPage snapshot={visibleSnapshot} highlightedIds={highlightedIds} exchangeAvailability={exchangeAvailability} classificationFilter={classificationFilter} performanceTrends={performanceTrends} mode="bull" />
      ) : page === 'amounts-sell' ? (
        <AmountsPage snapshot={visibleSnapshot} highlightedIds={highlightedIds} exchangeAvailability={exchangeAvailability} classificationFilter={classificationFilter} performanceTrends={performanceTrends} mode="sell" />
      ) : page === 'big-buying' ? (
        <BigActivitiesPage snapshot={visibleSnapshot} highlightedIds={highlightedIds} classificationFilter={classificationFilter} performanceTrends={performanceTrends} mode="buying" />
      ) : page === 'big-selling' ? (
        <BigActivitiesPage snapshot={visibleSnapshot} highlightedIds={highlightedIds} classificationFilter={classificationFilter} performanceTrends={performanceTrends} mode="selling" />
      ) : page === 'big-activities' ? (
        <BigActivitiesPage snapshot={visibleSnapshot} highlightedIds={highlightedIds} classificationFilter={classificationFilter} performanceTrends={performanceTrends} mode="activity" />
      ) : page === 'news' ? (
        <PlaceholderPage title="News" subtitle="Announcements and news chapter feeds" tone="news" />
      ) : page === 'flows' ? (
        <FlowsPage snapshot={visibleSnapshot} highlightedIds={highlightedIds} classificationFilter={classificationFilter} performanceTrends={performanceTrends} />
      ) : page === 'market-data' ? (
        <MarketDataPage snapshot={visibleSnapshot} highlightedIds={highlightedIds} classificationFilter={classificationFilter} performanceTrends={performanceTrends} />
      ) : page === 'onchain-alpha' ? (
        <OnchainAlphaPage snapshot={visibleSnapshot} highlightedIds={highlightedIds} classificationFilter={classificationFilter} performanceTrends={performanceTrends} />
      ) : (
        <Dashboard snapshot={visibleSnapshot} highlightedIds={highlightedIds} page={page} exchangeAvailability={exchangeAvailability} classificationFilter={classificationFilter} performanceTrends={performanceTrends} />
      )}
    </div>
  );
}

function buildPerformanceTrends(performanceByExchange: Partial<Record<ExchangeKey, SpotPerformanceResponse>>): PerformanceTrendByCoin {
  const trends = new Map<string, Set<'gainer' | 'loser'>>();

  for (const response of Object.values(performanceByExchange)) {
    for (const row of response?.gainers.slice(0, 10) ?? []) addPerformanceTrend(trends, row.baseAsset, 'gainer');
    for (const row of response?.losers.slice(0, 10) ?? []) addPerformanceTrend(trends, row.baseAsset, 'loser');
  }

  return trends;
}

function formatResetAllDataMessage(tableCount: number, rawLogBytesBefore: number | null): string {
  const rawLogPart = rawLogBytesBefore && rawLogBytesBefore > 0 ? `, raw log ${formatBytes(rawLogBytesBefore)}` : '';
  return `Reset ${tableCount} tables${rawLogPart}`;
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let amount = value;
  let unitIndex = 0;
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }
  return `${amount.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatHistoryStorageLabel(storageStatus: StorageStatusResponse | null, status: ApiStatus | null): string {
  const state = storageStatus?.health?.state ?? status?.health?.state ?? null;
  if (state) return `Storage ${state}`;
  if (status?.database?.enabled === false) return 'Storage disabled';
  return 'Storage unknown';
}

export function filterSnapshotByExchange(snapshot: DashboardSnapshot, exchangeAvailability: ExchangeAvailabilityByMarket, exchangeFilter: ExchangeFilter, marketFilter: MarketFilter): DashboardSnapshot {
  if (!isExchangeFilterActive(exchangeFilter) && !isMarketFilterActive(marketFilter)) return snapshot;

  const feeds = {} as DashboardSnapshot['feeds'];
  const byFeed = {} as DashboardSnapshot['counters']['byFeed'];

  for (const feedKey of feedKeys) {
    const market = getFeedMarket(feedKey);
    const effectiveMarketFilter = isMarketFilterScopedFeed(feedKey) ? marketFilter : [];
    const events = snapshot.feeds[feedKey].events
      .map((event) => filterEventByExchange(event, market, exchangeAvailability, exchangeFilter, effectiveMarketFilter))
      .filter((event): event is NormalizedEvent => event !== null);
    feeds[feedKey] = { events, latest: events[0] ?? null };
    byFeed[feedKey] = events.length;
  }

  return {
    ...snapshot,
    feeds,
    counters: {
      ...snapshot.counters,
      byFeed
    }
  };
}

function filterEventByExchange(
  event: NormalizedEvent,
  market: ExchangeKeyedMarket,
  exchangeAvailability: ExchangeAvailabilityByMarket,
  exchangeFilter: ExchangeFilter,
  marketFilter: MarketFilter
): NormalizedEvent | null {
  const candidateMarkets = getCandidateMarkets(market, marketFilter);
  if (!candidateMarkets.length) return null;

  const entries = event.entries.filter((entry) => {
    if (matchesExchangeFilterByExchange(entry.exchange, exchangeFilter) && matchesEntryMarket(entry.exchange, candidateMarkets)) return true;
    return candidateMarkets.some((candidateMarket) => matchesExchangeFilterByCoin(entry.coin, candidateMarket, exchangeAvailability, exchangeFilter));
  });

  if (event.entries.length) return entries.length ? { ...event, entries, coins: [...new Set(entries.flatMap((entry) => entry.coin ? [entry.coin] : []))] } : null;

  const coins = event.coins.filter((coin) => {
    return candidateMarkets.some((candidateMarket) => matchesExchangeFilterByCoin(coin, candidateMarket, exchangeAvailability, exchangeFilter));
  });

  return coins.length ? { ...event, coins } : null;
}

type ExchangeKeyedMarket = 'spot' | 'perpetual' | 'both';

function getCandidateMarkets(market: ExchangeKeyedMarket, marketFilter: MarketFilter): Array<'spot' | 'perpetual'> {
  if (market === 'both') return (marketFilter.length ? marketFilter : ['spot', 'perpetual']);
  return marketFilterAllows(market, marketFilter) ? [market] : [];
}

function matchesEntryMarket(exchange: string | null | undefined, candidateMarkets: Array<'spot' | 'perpetual'>): boolean {
  const normalized = exchange?.toLowerCase() ?? '';
  if (/future|futures|perp|perpetual|swap|linear/.test(normalized)) return candidateMarkets.includes('perpetual');
  if (/spot/.test(normalized)) return candidateMarkets.includes('spot');
  return candidateMarkets.length > 0;
}

function getFeedMarket(feedKey: FeedKey): ExchangeKeyedMarket {
  if (feedKey.includes('derivatives') || feedKey.includes('oi') || feedKey === 'top_funding') return 'perpetual';
  if (feedKey === 'pricealerts' || feedKey === 'volalerts') return 'both';
  return 'spot';
}

function isMarketFilterScopedFeed(feedKey: FeedKey): boolean {
  return feedKey === 'pricealerts' || feedKey === 'volalerts';
}

function addPerformanceTrend(trends: Map<string, Set<'gainer' | 'loser'>>, coin: string | null | undefined, trend: 'gainer' | 'loser'): void {
  const normalized = normalizePerformanceCoin(coin);
  if (!normalized) return;
  const coinTrends = trends.get(normalized) ?? new Set<'gainer' | 'loser'>();
  coinTrends.add(trend);
  trends.set(normalized, coinTrends);
}

function PageSwitcher({ page, onNavigate }: { page: DashboardPage; onNavigate: (page: NavigableDashboardPage) => void }) {
  return (
    <nav className="page-switcher" aria-label="Dashboard pages">
      {pageNavItems.map((item) => (
        <button
          aria-current={page === item.page ? 'page' : undefined}
          className={page === item.page ? `active ${item.page}` : item.page}
          type="button"
          onClick={() => onNavigate(item.page)}
          key={item.page}
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}

function createEmptySnapshot(): DashboardSnapshot {
  const feeds = {} as DashboardSnapshot['feeds'];
  const byFeed = {} as DashboardSnapshot['counters']['byFeed'];
  for (const feedKey of feedKeys) {
    feeds[feedKey] = { events: [], latest: null };
    byFeed[feedKey] = 0;
  }

  return {
    generatedAt: new Date().toISOString(),
    feeds,
    counters: {
      received: 0,
      stored: 0,
      deduplicated: 0,
      byFeed
    },
    lastEventTime: null,
    latency: {
      latestMs: null,
      averageMs: null,
      samples: 0
    }
  };
}

function addEventToSnapshot(snapshot: DashboardSnapshot, event: NormalizedEvent): DashboardSnapshot {
  const currentFeed = snapshot.feeds[event.feedKey];
  if (currentFeed.events.some((existing) => existing.id === event.id)) return snapshot;

  const events = [event, ...currentFeed.events].slice(0, 100);
  const byFeed = {
    ...snapshot.counters.byFeed,
    [event.feedKey]: snapshot.counters.byFeed[event.feedKey] + 1
  };

  return {
    ...snapshot,
    generatedAt: new Date().toISOString(),
    feeds: {
      ...snapshot.feeds,
      [event.feedKey]: {
        events,
        latest: events[0] ?? null
      }
    },
    counters: {
      received: snapshot.counters.received + 1,
      stored: snapshot.counters.stored + 1,
      deduplicated: snapshot.counters.deduplicated,
      byFeed
    },
    lastEventTime: event.receivedAt,
    latency: updateLatency(snapshot.latency, event.latencyMs)
  };
}

function updateLatency(current: DashboardSnapshot['latency'], latencyMs: number | null): DashboardSnapshot['latency'] {
  if (latencyMs === null) return current;
  const samples = current.samples + 1;
  const previousAverage = current.averageMs ?? latencyMs;
  return {
    latestMs: latencyMs,
    averageMs: Math.round((previousAverage * current.samples + latencyMs) / samples),
    samples
  };
}

function getDashboardToken(): string | null {
  const params = new URLSearchParams(window.location.search);
  const tokenFromUrl = params.get('token');
  if (tokenFromUrl) {
    window.localStorage.setItem('cryptoattack.dashboardToken', tokenFromUrl);
    return tokenFromUrl;
  }
  const tokenFromEnv = getEnvDashboardAuthToken();
  if (tokenFromEnv) return tokenFromEnv;
  return window.localStorage.getItem('cryptoattack.dashboardToken');
}

function getDashboardAdminToken(): string | null {
  return window.localStorage.getItem('cryptoattack.dashboardAdminToken');
}

function getDashboardPage(): DashboardPage {
  if (window.location.pathname === '/history' || window.location.pathname.startsWith('/history/')) return 'history';
  if (window.location.pathname.startsWith('/exchanges')) return 'coins';
  if (window.location.pathname.startsWith('/binance-oi')) return 'oi-alerts';
  if (window.location.pathname.startsWith('/signals')) return 'price-alerts';
  if (window.location.pathname.startsWith('/price-volume-alerts')) return 'price-alerts';
  if (window.location.pathname.startsWith('/market-data')) return 'market-data';
  const item = pageNavItems.find((candidate) => window.location.pathname.startsWith(candidate.path));
  return item?.page ?? 'bull';
}

function getHistoryCoinFromPath(pathname: string): string | null {
  const match = /^\/history\/([^/?#]+)/u.exec(pathname);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function getInitialTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'dark';
  const stored = window.localStorage.getItem('cryptoattack.theme');
  return stored === 'light' ? 'light' : 'dark';
}

function playAlertSound(feedKey: FeedKey): void {
  const audioContextConstructor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!audioContextConstructor) return;

  const context = new audioContextConstructor();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.value = feedKey === 'delistings' ? 720 : 920;
  gain.gain.value = 0.025;
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.14);
}

function showNotification(event: NormalizedEvent): void {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  new Notification(event.title, {
    body: event.plainText.slice(0, 160),
    tag: event.id
  });
}
