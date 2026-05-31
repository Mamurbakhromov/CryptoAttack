import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react';

import type { CoinClassificationFilter } from '../coinClassification';
import { fetchAmountsFeedHistory, fetchAmountsHistory, fetchTopOiFeedHistory, fetchTopOiHistory, fetchTopSpotFeedHistory, fetchTopSpotHistory } from '../api/sse';
import type {
  AmountsFeedHistoryResponse,
  AmountsHistoryResponse,
  AmountsHistorySourceKey,
  NormalizedEvent,
  TopOiFeedHistoryResponse,
  TopOiHistoryFeedKey,
  TopOiHistoryResponse,
  TopOiHistorySide,
  TopSpotFeedHistoryResponse,
  TopSpotFeedHistorySnapshot,
  TopSpotHistoryFeedKey,
  TopSpotHistoryHit,
  TopSpotHistoryMarket,
  TopSpotHistoryResponse,
  TopSpotHistorySide
} from '../types';
import { BsHistoryChart, BsHistoryDetailsTable, buildRatioAverages, formatAverageRatio, type RatioHistoryHit } from './BsHistoryPanel';
import { emptyExchangeAvailability, type ExchangeAvailabilityByMarket } from './ExchangeChips';
import { OiHistoryChart, OiHistoryDetailsTable, OiTopTable, type OiHistoryHit } from './OiTopTable';
import type { PerformanceTrendByCoin } from './PerformanceTrendChips';
import { TopTable } from './TopTable';

const COIN_HISTORY_WINDOW_MS = 60 * 60 * 1_000;
const FEED_HISTORY_WINDOW_MS = 60 * 60 * 1_000;
const HISTORY_ANCHOR_MINUTE = 4;

const emptyPerformanceTrends: PerformanceTrendByCoin = new Map();
type HistoryMode = 'coin' | 'feeds';
type HistorySectionKey = 'top-spot' | 'top-oi' | 'amounts';
type FeedHistoryResponse = TopSpotFeedHistoryResponse | TopOiFeedHistoryResponse | AmountsFeedHistoryResponse;
type CoinHistoryResponse = TopSpotHistoryResponse | TopOiHistoryResponse | AmountsHistoryResponse;

interface RatioHistorySource {
  kind: 'ratio';
  label: string;
  sourceKey: TopSpotHistoryFeedKey | AmountsHistorySourceKey;
  comparisonSourceKey: TopSpotHistoryFeedKey | AmountsHistorySourceKey;
  title: string;
  subtitle: string;
  market: TopSpotHistoryMarket;
  side: TopSpotHistorySide;
}

interface OiHistorySource {
  kind: 'oi';
  label: string;
  sourceKey: TopOiHistoryFeedKey;
  title: string;
  subtitle: string;
  side: TopOiHistorySide;
}

type HistorySource = RatioHistorySource | OiHistorySource;

interface HistorySectionConfig {
  key: HistorySectionKey;
  label: string;
  title: string;
  sources: HistorySource[];
}

const historySections: HistorySectionConfig[] = [
  {
    key: 'top-spot',
    label: 'Top Spot',
    title: 'Top Spot History',
    sources: [
      {
        kind: 'ratio',
        label: 'Spot Buyers',
        sourceKey: 'all_spot_top_buy_5m',
        comparisonSourceKey: 'all_spot_top_sell_5m',
        title: 'Top 10 Spot Buyers 5m',
        subtitle: 'cex_alerts/all_spot_top, classified buy + 5m',
        market: 'spot',
        side: 'buy'
      },
      {
        kind: 'ratio',
        label: 'Spot Sellers',
        sourceKey: 'all_spot_top_sell_5m',
        comparisonSourceKey: 'all_spot_top_buy_5m',
        title: 'Top 10 Spot Sellers 5m',
        subtitle: 'cex_alerts/all_spot_top, classified sell + 5m',
        market: 'spot',
        side: 'sell'
      },
      {
        kind: 'ratio',
        label: 'Derivatives Buyers',
        sourceKey: 'all_derivatives_top_buy_5m',
        comparisonSourceKey: 'all_derivatives_top_sell_5m',
        title: 'Top 10 Derivatives Buyers 5m',
        subtitle: 'cex_alerts/all_derivatives_top, classified buy + 5m',
        market: 'perpetual',
        side: 'buy'
      },
      {
        kind: 'ratio',
        label: 'Derivatives Sellers',
        sourceKey: 'all_derivatives_top_sell_5m',
        comparisonSourceKey: 'all_derivatives_top_buy_5m',
        title: 'Top 10 Derivatives Sellers 5m',
        subtitle: 'cex_alerts/all_derivatives_top, classified sell + 5m',
        market: 'perpetual',
        side: 'sell'
      }
    ]
  },
  {
    key: 'top-oi',
    label: 'Top OI',
    title: 'Top OI History',
    sources: [
      {
        kind: 'oi',
        label: 'OI Gainers',
        sourceKey: 'top_oi_gainers_60m',
        title: 'Top 10 OI Gainers 60m',
        subtitle: 'market_data/top_oi, open interest gainers + 60m',
        side: 'gainer'
      },
      {
        kind: 'oi',
        label: 'OI Losers',
        sourceKey: 'top_oi_losers_60m',
        title: 'Top 10 OI Losers 60m',
        subtitle: 'market_data/top_oi, open interest losers + 60m',
        side: 'loser'
      }
    ]
  },
  {
    key: 'amounts',
    label: 'Bull/Bear %',
    title: 'Bull/Bear % History',
    sources: [
      {
        kind: 'ratio',
        label: 'Spot Buying %',
        sourceKey: 'spot_buy',
        comparisonSourceKey: 'spot_sell',
        title: 'Top 10 Spot Buying Percent',
        subtitle: 'cex_alerts/all_spot_per, classified buy + 5m',
        market: 'spot',
        side: 'buy'
      },
      {
        kind: 'ratio',
        label: 'Spot Selling %',
        sourceKey: 'spot_sell',
        comparisonSourceKey: 'spot_buy',
        title: 'Top 10 Spot Selling Percent',
        subtitle: 'cex_alerts/all_spot_per, classified sell + 5m',
        market: 'spot',
        side: 'sell'
      },
      {
        kind: 'ratio',
        label: 'Derivatives Buying %',
        sourceKey: 'derivatives_buy',
        comparisonSourceKey: 'derivatives_sell',
        title: 'Top 10 Derivatives Buying Percent',
        subtitle: 'cex_alerts/all_derivatives_per, classified buy + 5m',
        market: 'perpetual',
        side: 'buy'
      },
      {
        kind: 'ratio',
        label: 'Derivatives Selling %',
        sourceKey: 'derivatives_sell',
        comparisonSourceKey: 'derivatives_buy',
        title: 'Top 10 Derivatives Selling Percent',
        subtitle: 'cex_alerts/all_derivatives_per, classified sell + 5m',
        market: 'perpetual',
        side: 'sell'
      }
    ]
  }
];

interface CoinHistoryPageProps {
  authToken: string | null;
  coin: string;
  storageStateLabel?: string;
  exchangeAvailability?: ExchangeAvailabilityByMarket;
  classificationFilter?: CoinClassificationFilter;
  performanceTrends?: PerformanceTrendByCoin;
}

export function CoinHistoryPage({
  authToken,
  coin,
  storageStateLabel = 'Storage unknown',
  exchangeAvailability,
  classificationFilter = [],
  performanceTrends = emptyPerformanceTrends
}: CoinHistoryPageProps) {
  const initialSection = getInitialSectionFromUrl();
  const [sectionKey, setSectionKey] = useState<HistorySectionKey>(initialSection);
  const [selectedSourceKey, setSelectedSourceKey] = useState<string>(() => getInitialSourceKeyFromUrl(initialSection));
  const [activeCoin, setActiveCoin] = useState<string | null>(() => normalizeCoin(coin));
  const [historyMode, setHistoryMode] = useState<HistoryMode>(() => normalizeCoin(coin) ? 'coin' : 'feeds');
  const [searchDraft, setSearchDraft] = useState('');
  const [searchError, setSearchError] = useState<string | null>(null);
  const [coinWindowStart, setCoinWindowStart] = useState<Date>(() => getCurrentHistoryWindow().from);
  const [feedWindowStart, setFeedWindowStart] = useState<Date>(() => getCurrentFeedHistoryWindow().from);
  const [view, setView] = useState<'graph' | 'details'>('graph');
  const [coinResponse, setCoinResponse] = useState<CoinHistoryResponse | null>(null);
  const [feedResponse, setFeedResponse] = useState<FeedHistoryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [feedLoading, setFeedLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resolvedExchangeAvailability = exchangeAvailability ?? emptyExchangeAvailability();
  const section = getHistorySection(sectionKey);
  const selectedSource = getSelectedSource(section, selectedSourceKey);
  const coinWindowEnd = useMemo(() => new Date(coinWindowStart.getTime() + COIN_HISTORY_WINDOW_MS), [coinWindowStart]);
  const feedWindowEnd = useMemo(() => new Date(feedWindowStart.getTime() + FEED_HISTORY_WINDOW_MS), [feedWindowStart]);
  const currentActiveCoinWindow = getCurrentHistoryWindow();
  const currentActiveFeedWindow = getCurrentFeedHistoryWindow();
  const isCoinNextDisabled = coinWindowStart.getTime() >= currentActiveCoinWindow.from.getTime();
  const isFeedNextDisabled = feedWindowStart.getTime() >= currentActiveFeedWindow.from.getTime();

  useEffect(() => {
    const nextCoin = normalizeCoin(coin);
    const nextSection = getInitialSectionFromUrl();
    setSectionKey(nextSection);
    setSelectedSourceKey(getInitialSourceKeyFromUrl(nextSection));
    setActiveCoin(nextCoin);
    setHistoryMode(nextCoin ? 'coin' : 'feeds');
    setCoinResponse(null);
    setFeedResponse(null);
    setError(null);
  }, [coin]);

  useEffect(() => {
    if (!activeCoin) return;
    const abortController = new AbortController();
    setLoading(true);
    setError(null);
    setCoinResponse(null);

    const query = {
      from: coinWindowStart.toISOString(),
      to: coinWindowEnd.toISOString()
    };
    const request = fetchCoinHistory(authToken, section.key, selectedSource, activeCoin, query, abortController.signal);

    void request
      .then((nextResponse) => setCoinResponse(nextResponse))
      .catch((fetchError: unknown) => {
        if (!abortController.signal.aborted) setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
      })
      .finally(() => {
        if (!abortController.signal.aborted) setLoading(false);
      });

    return () => abortController.abort();
  }, [activeCoin, authToken, coinWindowEnd, coinWindowStart, section.key, selectedSource]);

  useEffect(() => {
    if (activeCoin || historyMode !== 'feeds') return;
    const abortController = new AbortController();
    setFeedLoading(true);
    setError(null);
    setFeedResponse(null);

    void fetchFeedHistory(authToken, section.key, {
      from: feedWindowStart.toISOString(),
      to: feedWindowEnd.toISOString()
    }, abortController.signal)
      .then((nextResponse) => setFeedResponse(nextResponse))
      .catch((fetchError: unknown) => {
        if (!abortController.signal.aborted) setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
      })
      .finally(() => {
        if (!abortController.signal.aborted) setFeedLoading(false);
      });

    return () => abortController.abort();
  }, [activeCoin, authToken, historyMode, feedWindowEnd, feedWindowStart, section.key]);

  const selectSection = (nextSectionKey: HistorySectionKey) => {
    const nextSection = getHistorySection(nextSectionKey);
    const nextSource = nextSection.sources[0]!;
    setSectionKey(nextSectionKey);
    setSelectedSourceKey(nextSource.sourceKey);
    setCoinResponse(null);
    setFeedResponse(null);
    setSearchError(null);
    setView('graph');
    const nextUrl = activeCoin ? buildCoinHistoryPath(activeCoin, nextSectionKey, nextSource) : buildFeedHistoryPath(nextSectionKey);
    window.history.replaceState({}, '', nextUrl);
  };

  const setSource = (nextSource: HistorySource) => {
    setSelectedSourceKey(nextSource.sourceKey);
    setCoinResponse(null);
    setView('graph');
    if (activeCoin) window.history.replaceState({}, '', buildCoinHistoryPath(activeCoin, section.key, nextSource));
  };

  const openSearchedCoin = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextCoin = normalizeCoin(searchDraft);
    if (!nextCoin) {
      setSearchError('Enter a valid coin symbol.');
      return;
    }
    setSearchError(null);
    setActiveCoin(nextCoin);
    setCoinResponse(null);
    setView('graph');
    window.history.pushState({}, '', buildCoinHistoryPath(nextCoin, section.key, selectedSource));
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  const showFeedHistory = () => {
    setHistoryMode('feeds');
    setActiveCoin(null);
    setCoinResponse(null);
    setSearchError(null);
    window.history.pushState({}, '', buildFeedHistoryPath(section.key));
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  const showCoinSearch = () => {
    setHistoryMode('coin');
    if (activeCoin) return;
    setActiveCoin(null);
    setCoinResponse(null);
    setSearchError(null);
  };

  const moveCoinWindow = (direction: -1 | 1) => {
    setCoinWindowStart((current) => {
      const next = new Date(current.getTime() + direction * COIN_HISTORY_WINDOW_MS);
      const activeStart = getCurrentHistoryWindow().from;
      return next.getTime() > activeStart.getTime() ? activeStart : next;
    });
    setView('graph');
  };

  const moveFeedWindow = (direction: -1 | 1) => {
    setFeedWindowStart((current) => {
      const next = new Date(current.getTime() + direction * FEED_HISTORY_WINDOW_MS);
      const activeStart = getCurrentFeedHistoryWindow().from;
      return next.getTime() > activeStart.getTime() ? activeStart : next;
    });
  };

  const selectCoinDate = (dateValue: string) => {
    setCoinWindowStart((current) => moveWindowToLocalDate(current, dateValue, getCurrentHistoryWindow().from));
    setView('graph');
  };

  const selectFeedDate = (dateValue: string) => {
    setFeedWindowStart((current) => moveWindowToLocalDate(current, dateValue, getCurrentFeedHistoryWindow().from));
  };

  const sectionTabs = (
    <div className="history-section-tabs" role="group" aria-label="History section">
      {historySections.map((item) => (
        <button
          className={item.key === section.key ? 'active' : ''}
          key={item.key}
          type="button"
          aria-pressed={item.key === section.key}
          onClick={() => selectSection(item.key)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );

  const historyModeTabs = (
    <div className="history-mode-tabs" role="group" aria-label="History mode">
      <button className={historyMode === 'feeds' ? 'active' : ''} type="button" aria-pressed={historyMode === 'feeds'} onClick={showFeedHistory}>By feeds</button>
      <button className={historyMode === 'coin' ? 'active' : ''} type="button" aria-pressed={historyMode === 'coin'} onClick={showCoinSearch}>By coin</button>
    </div>
  );

  if (!activeCoin && historyMode === 'coin') {
    return (
      <main className="dashboard-main history-page">
        <section className="page-hero history">
          <h1>Search a coin</h1>
          <span>{section.title} / {storageStateLabel}</span>
        </section>
        <section className="history-toolbar" aria-label="History controls">
          {sectionTabs}
          {historyModeTabs}
        </section>
        <section className="panel history-search-panel">
          <form className="history-search-form" onSubmit={openSearchedCoin}>
            <input
              aria-label="Search a coin"
              autoFocus
              placeholder="Search a coin"
              type="text"
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
            />
            <button type="submit">Search</button>
          </form>
          {searchError ? <div className="history-search-error">{searchError}</div> : null}
        </section>
      </main>
    );
  }

  if (!activeCoin) {
    const feeds = getFeedSnapshots(feedResponse, section);
    const selectedSnapshot = feeds[selectedSource.sourceKey] ?? emptySnapshot();
    const selectedFeedEvent = buildHourlyFeedEvent(selectedSnapshot.events, selectedSource);
    const comparisonSnapshot = selectedSource.kind === 'ratio' ? feeds[selectedSource.comparisonSourceKey] ?? emptySnapshot() : emptySnapshot();

    return (
      <main className="dashboard-main history-page">
        <section className="page-hero history">
          <h1>{section.title}</h1>
          <span>{formatWindowLabel(feedWindowStart, feedWindowEnd)} / {storageStateLabel}</span>
        </section>
        <section className="history-toolbar" aria-label="History controls">
          {sectionTabs}
          {historyModeTabs}
          <div className="history-source-tabs" aria-label={`${section.label} feed history source`}>
            {section.sources.map((tab) => (
              <button
                className={tab.sourceKey === selectedSource.sourceKey ? 'active' : ''}
                key={tab.sourceKey}
                type="button"
                aria-pressed={tab.sourceKey === selectedSource.sourceKey}
                onClick={() => setSource(tab)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="history-window-pager">
            <button type="button" aria-label="Previous hour" onClick={() => moveFeedWindow(-1)}>{'<'}</button>
            <span>{formatWindowLabel(feedWindowStart, feedWindowEnd)}</span>
            <input
              aria-label="History date"
              max={formatDateInput(currentActiveFeedWindow.from)}
              type="date"
              value={formatDateInput(feedWindowStart)}
              onChange={(event) => selectFeedDate(event.target.value)}
            />
            <button type="button" aria-label="Next hour" disabled={isFeedNextDisabled} onClick={() => moveFeedWindow(1)}>{'>'}</button>
          </div>
        </section>

        {searchError ? <div className="history-search-error">{searchError}</div> : null}
        {error ? <div className="warning-banner">History warning: {error}</div> : null}
        {feedResponse && !feedResponse.enabled ? <div className="warning-banner">History storage is unavailable. New persisted data will appear here when database storage is enabled.</div> : null}

        <section>
          {selectedSource.kind === 'oi' ? (
            <OiTopTable
              title={selectedSource.title}
              subtitle={selectedSource.subtitle}
              event={selectedFeedEvent}
              historyEvents={selectedSnapshot.events}
              exchangeAvailability={resolvedExchangeAvailability}
              classificationFilter={classificationFilter}
              performanceTrends={performanceTrends}
              highlighted={false}
              maxRows={null}
              historyWindowStart={feedWindowStart}
              historyWindowEnd={feedWindowEnd}
            />
          ) : (
            <TopTable
              title={selectedSource.title}
              subtitle={selectedSource.subtitle}
              event={selectedFeedEvent}
              historyEvents={selectedSnapshot.events}
              comparisonHistoryEvents={comparisonSnapshot.events}
              market={selectedSource.market}
              exchangeAvailability={resolvedExchangeAvailability}
              classificationFilter={classificationFilter}
              performanceTrends={performanceTrends}
              highlighted={false}
              maxRows={null}
              historyWindowStart={feedWindowStart}
              historyWindowEnd={feedWindowEnd}
            />
          )}
        </section>

        {feedLoading && !feedResponse ? <div className="history-empty-state">Loading {section.label} history...</div> : null}
      </main>
    );
  }

  if (selectedSource.kind === 'oi') {
    return renderOiCoinHistory({
      activeCoin,
      coinResponse: coinResponse as TopOiHistoryResponse | null,
      coinWindowStart,
      coinWindowEnd,
      currentActiveCoinWindow,
      error,
      historyModeTabs,
      isCoinNextDisabled,
      loading,
      moveCoinWindow,
      openSearchedCoin,
      searchDraft,
      searchError,
      section,
      sectionTabs,
      selectCoinDate,
      selectedSource,
      setSearchDraft,
      setSource,
      setView,
      storageStateLabel,
      view
    });
  }

  const ratioResponse = coinResponse as TopSpotHistoryResponse | AmountsHistoryResponse | null;
  const ratioMode = selectedSource.side === 'sell' ? 'sell-buy' : 'buy-sell';
  const comparisonRatioMode = selectedSource.side === 'sell' ? 'buy-sell' : 'sell-buy';
  const ratioLabel = selectedSource.side === 'sell' ? 'S/B' : 'B/S';
  const comparisonRatioLabel = selectedSource.side === 'sell' ? 'B/S' : 'S/B';
  const primaryHits = mapHistoryHits(ratioResponse?.hits ?? [], ratioMode);
  const comparisonHits = mapHistoryHits(ratioResponse?.comparisonHits ?? [], comparisonRatioMode);
  const latestAverage = buildRatioAverages(new Map([[activeCoin, primaryHits]])).get(activeCoin) ?? null;

  return (
    <main className="dashboard-main history-page">
      <section className="page-hero history">
        <h1>{activeCoin} History</h1>
        <span>{section.title} / {selectedSource.label} / {formatWindowLabel(coinWindowStart, coinWindowEnd)} / {storageStateLabel}</span>
      </section>

      <section className="history-toolbar" aria-label="History controls">
        {sectionTabs}
        {historyModeTabs}
        <div className="history-source-tabs" aria-label={`${section.label} history source`}>
          {section.sources.map((tab) => (
            <button
              className={tab.sourceKey === selectedSource.sourceKey ? 'active' : ''}
              key={tab.sourceKey}
              type="button"
              aria-pressed={tab.sourceKey === selectedSource.sourceKey}
              onClick={() => setSource(tab)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <form className="history-search-form compact" onSubmit={openSearchedCoin}>
          <input
            aria-label="Search a coin"
            placeholder="Search a coin"
            type="text"
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
          />
          <button type="submit">Search</button>
        </form>
        <div className="history-window-pager">
          <button type="button" aria-label="Previous hour" onClick={() => moveCoinWindow(-1)}>{'<'}</button>
          <span>{formatWindowLabel(coinWindowStart, coinWindowEnd)}</span>
          <input
            aria-label="History date"
            max={formatDateInput(currentActiveCoinWindow.from)}
            type="date"
            value={formatDateInput(coinWindowStart)}
            onChange={(event) => selectCoinDate(event.target.value)}
          />
          <button type="button" aria-label="Next hour" disabled={isCoinNextDisabled} onClick={() => moveCoinWindow(1)}>{'>'}</button>
        </div>
      </section>

      {error ? <div className="warning-banner">History warning: {error}</div> : null}
      {ratioResponse && !ratioResponse.enabled ? <div className="warning-banner">History storage is unavailable. New persisted data will appear here when database storage is enabled.</div> : null}

      <section className="panel history-panel">
        <div className="history-panel-topline">
          <div className="history-panel-title">
            <h2>{activeCoin} {ratioLabel} History</h2>
            <p>{selectedSource.label} from {formatWindowLabel(coinWindowStart, coinWindowEnd)}</p>
          </div>
          <div className="history-panel-inline-controls">
            <div className="bs-history-summary">
              <span>{primaryHits.length} hit{primaryHits.length === 1 ? '' : 's'} in 1h</span>
              <strong>{ratioLabel} 3 Avg {formatAverageRatio(latestAverage)}</strong>
            </div>

            <div className="bs-history-view-tabs" role="tablist" aria-label="B/S history view">
              <button className={view === 'graph' ? 'active' : ''} type="button" role="tab" aria-selected={view === 'graph'} onClick={() => setView('graph')}>Graph</button>
              <button className={view === 'details' ? 'active' : ''} type="button" role="tab" aria-selected={view === 'details'} onClick={() => setView('details')}>Details</button>
            </div>
          </div>
          <span className="count-pill">{loading ? 'Loading' : ratioResponse?.enabled === false ? 'Storage off' : 'Ready'}</span>
        </div>

        {primaryHits.length ? (
          <div className={`bs-history-content ${view}`} role="tabpanel" aria-label={view === 'graph' ? 'Graph' : 'Details'}>
            {view === 'graph' ? (
              <BsHistoryChart
                coin={activeCoin}
                hits={primaryHits}
                comparisonHits={comparisonHits}
                ratioLabel={ratioLabel}
                comparisonRatioLabel={comparisonRatioLabel}
                windowStart={coinWindowStart}
                windowEnd={coinWindowEnd}
              />
            ) : (
              <BsHistoryDetailsTable hits={primaryHits} ratioLabel={ratioLabel} />
            )}
          </div>
        ) : (
          <div className="history-empty-state" role="tabpanel" aria-label={view === 'graph' ? 'Graph' : 'Details'}>
            {loading ? 'Loading history...' : `No ${ratioLabel} hits found for ${activeCoin} in this hour.`}
          </div>
        )}
      </section>
    </main>
  );
}

export function getCurrentHistoryWindow(now = new Date()): { from: Date; to: Date } {
  const from = new Date(now);
  from.setSeconds(0, 0);
  from.setMinutes(HISTORY_ANCHOR_MINUTE);
  if (from.getTime() > now.getTime()) from.setHours(from.getHours() - 1);
  return { from, to: new Date(from.getTime() + COIN_HISTORY_WINDOW_MS) };
}

export function getCurrentFeedHistoryWindow(now = new Date()): { from: Date; to: Date } {
  const from = new Date(now);
  from.setSeconds(0, 0);
  from.setMinutes(HISTORY_ANCHOR_MINUTE);
  if (from.getTime() > now.getTime()) from.setHours(from.getHours() - 1);
  return { from, to: new Date(from.getTime() + FEED_HISTORY_WINDOW_MS) };
}

function renderOiCoinHistory(props: {
  activeCoin: string;
  coinResponse: TopOiHistoryResponse | null;
  coinWindowStart: Date;
  coinWindowEnd: Date;
  currentActiveCoinWindow: { from: Date; to: Date };
  error: string | null;
  historyModeTabs: ReactNode;
  isCoinNextDisabled: boolean;
  loading: boolean;
  moveCoinWindow: (direction: -1 | 1) => void;
  openSearchedCoin: (event: FormEvent<HTMLFormElement>) => void;
  searchDraft: string;
  searchError: string | null;
  section: HistorySectionConfig;
  sectionTabs: ReactNode;
  selectCoinDate: (dateValue: string) => void;
  selectedSource: OiHistorySource;
  setSearchDraft: (value: string) => void;
  setSource: (source: HistorySource) => void;
  setView: (view: 'graph' | 'details') => void;
  storageStateLabel: string;
  view: 'graph' | 'details';
}) {
  const hits = mapOiHistoryHits(props.coinResponse?.hits ?? []);
  return (
    <main className="dashboard-main history-page">
      <section className="page-hero history">
        <h1>{props.activeCoin} OI History</h1>
        <span>{props.section.title} / {props.selectedSource.label} / {formatWindowLabel(props.coinWindowStart, props.coinWindowEnd)} / {props.storageStateLabel}</span>
      </section>

      <section className="history-toolbar" aria-label="History controls">
        {props.sectionTabs}
        {props.historyModeTabs}
        <div className="history-source-tabs" aria-label={`${props.section.label} history source`}>
          {props.section.sources.map((tab) => (
            <button
              className={tab.sourceKey === props.selectedSource.sourceKey ? 'active' : ''}
              key={tab.sourceKey}
              type="button"
              aria-pressed={tab.sourceKey === props.selectedSource.sourceKey}
              onClick={() => props.setSource(tab)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <form className="history-search-form compact" onSubmit={props.openSearchedCoin}>
          <input
            aria-label="Search a coin"
            placeholder="Search a coin"
            type="text"
            value={props.searchDraft}
            onChange={(event) => props.setSearchDraft(event.target.value)}
          />
          <button type="submit">Search</button>
        </form>
        <div className="history-window-pager">
          <button type="button" aria-label="Previous hour" onClick={() => props.moveCoinWindow(-1)}>{'<'}</button>
          <span>{formatWindowLabel(props.coinWindowStart, props.coinWindowEnd)}</span>
          <input
            aria-label="History date"
            max={formatDateInput(props.currentActiveCoinWindow.from)}
            type="date"
            value={formatDateInput(props.coinWindowStart)}
            onChange={(event) => props.selectCoinDate(event.target.value)}
          />
          <button type="button" aria-label="Next hour" disabled={props.isCoinNextDisabled} onClick={() => props.moveCoinWindow(1)}>{'>'}</button>
        </div>
      </section>

      {props.error ? <div className="warning-banner">History warning: {props.error}</div> : null}
      {props.searchError ? <div className="history-search-error">{props.searchError}</div> : null}
      {props.coinResponse && !props.coinResponse.enabled ? <div className="warning-banner">History storage is unavailable. New persisted data will appear here when database storage is enabled.</div> : null}

      <section className="panel history-panel">
        <div className="history-panel-topline">
          <div className="history-panel-title">
            <h2>{props.activeCoin} OI History</h2>
            <p>{props.selectedSource.label} from {formatWindowLabel(props.coinWindowStart, props.coinWindowEnd)}</p>
          </div>
          <div className="history-panel-inline-controls">
            <div className="bs-history-summary">
              <span>{hits.length} hit{hits.length === 1 ? '' : 's'} in 1h</span>
            </div>

            <div className="bs-history-view-tabs" role="tablist" aria-label="OI history view">
              <button className={props.view === 'graph' ? 'active' : ''} type="button" role="tab" aria-selected={props.view === 'graph'} onClick={() => props.setView('graph')}>Graph</button>
              <button className={props.view === 'details' ? 'active' : ''} type="button" role="tab" aria-selected={props.view === 'details'} onClick={() => props.setView('details')}>Details</button>
            </div>
          </div>
          <span className="count-pill">{props.loading ? 'Loading' : props.coinResponse?.enabled === false ? 'Storage off' : 'Ready'}</span>
        </div>

        {hits.length ? (
          <div className={`bs-history-content ${props.view}`} role="tabpanel" aria-label={props.view === 'graph' ? 'Graph' : 'Details'}>
            {props.view === 'graph' ? (
              <OiHistoryChart coin={props.activeCoin} hits={hits} windowStart={props.coinWindowStart} windowEnd={props.coinWindowEnd} />
            ) : (
              <OiHistoryDetailsTable hits={hits} />
            )}
          </div>
        ) : (
          <div className="history-empty-state" role="tabpanel" aria-label={props.view === 'graph' ? 'Graph' : 'Details'}>
            {props.loading ? 'Loading history...' : `No OI hits found for ${props.activeCoin} in this hour.`}
          </div>
        )}
      </section>
    </main>
  );
}

function fetchFeedHistory(token: string | null, section: HistorySectionKey, query: { from: string; to: string }, signal?: AbortSignal): Promise<FeedHistoryResponse> {
  if (section === 'top-oi') return fetchTopOiFeedHistory(token, query, signal);
  if (section === 'amounts') return fetchAmountsFeedHistory(token, query, signal);
  return fetchTopSpotFeedHistory(token, query, signal);
}

function fetchCoinHistory(
  token: string | null,
  section: HistorySectionKey,
  source: HistorySource,
  coin: string,
  query: { from: string; to: string },
  signal?: AbortSignal
): Promise<CoinHistoryResponse> {
  if (source.kind === 'oi') return fetchTopOiHistory(token, coin, { ...query, side: source.side }, signal);
  if (section === 'amounts') return fetchAmountsHistory(token, coin, { ...query, market: source.market, side: source.side }, signal);
  return fetchTopSpotHistory(token, coin, { ...query, market: source.market, side: source.side }, signal);
}

function getInitialSectionFromUrl(): HistorySectionKey {
  const section = new URLSearchParams(window.location.search).get('section');
  if (section === 'top-oi' || section === 'amounts') return section;
  return 'top-spot';
}

function getInitialSourceKeyFromUrl(sectionKey: HistorySectionKey): string {
  const params = new URLSearchParams(window.location.search);
  const section = getHistorySection(sectionKey);
  if (sectionKey === 'top-oi') {
    const side = params.get('side');
    return side === 'loser' ? 'top_oi_losers_60m' : 'top_oi_gainers_60m';
  }
  const market = params.get('market') === 'perpetual' ? 'perpetual' : 'spot';
  const side = params.get('side') === 'sell' ? 'sell' : 'buy';
  return section.sources.find((source) => source.kind === 'ratio' && source.market === market && source.side === side)?.sourceKey ?? section.sources[0]!.sourceKey;
}

function getHistorySection(sectionKey: HistorySectionKey): HistorySectionConfig {
  return historySections.find((section) => section.key === sectionKey) ?? historySections[0]!;
}

function getSelectedSource(section: HistorySectionConfig, sourceKey: string): HistorySource {
  return section.sources.find((source) => source.sourceKey === sourceKey) ?? section.sources[0]!;
}

function buildCoinHistoryPath(coin: string, section: HistorySectionKey, source: HistorySource): string {
  const params = new URLSearchParams();
  if (section !== 'top-spot') params.set('section', section);
  if (source.kind === 'oi') {
    params.set('side', source.side);
  } else {
    params.set('market', source.market);
    params.set('side', source.side);
  }
  return `/history/${encodeURIComponent(coin)}?${params.toString()}`;
}

function buildFeedHistoryPath(section: HistorySectionKey): string {
  if (section === 'top-spot') return '/history';
  const params = new URLSearchParams({ section });
  return `/history?${params.toString()}`;
}

function getFeedSnapshots(response: FeedHistoryResponse | null, section: HistorySectionConfig): Record<string, TopSpotFeedHistorySnapshot> {
  return response ? response.feeds as Record<string, TopSpotFeedHistorySnapshot> : emptyFeedSnapshots(section.sources);
}

function emptyFeedSnapshots(sources: HistorySource[]): Record<string, TopSpotFeedHistorySnapshot> {
  return Object.fromEntries(sources.map((source) => [source.sourceKey, emptySnapshot()]));
}

function emptySnapshot(): TopSpotFeedHistorySnapshot {
  return { events: [], latest: null };
}

function mapHistoryHits(hits: TopSpotHistoryHit[], ratioMode: 'buy-sell' | 'sell-buy'): RatioHistoryHit[] {
  return hits
    .map((hit) => ({
      ...hit,
      displayRatio: historyDisplayRatio(hit, ratioMode)
    }))
    .filter((hit): hit is RatioHistoryHit => Number.isFinite(hit.displayRatio))
    .sort((left, right) => Date.parse(right.receivedAt) - Date.parse(left.receivedAt));
}

function mapOiHistoryHits(hits: TopSpotHistoryHit[]): OiHistoryHit[] {
  return hits
    .map((hit) => ({
      eventId: hit.eventId,
      receivedAt: hit.receivedAt,
      title: hit.feedKey,
      rank: hit.rank,
      coin: hit.coin,
      exchange: hit.exchange,
      oiChangePercent: finiteNumber(hit.percent),
      priceUsd: finiteNumber(hit.priceUsd),
      priceChangePercent: finiteNumber(hit.priceChangePercent),
      rawLine: hit.rawLine
    }))
    .sort((left, right) => Date.parse(right.receivedAt) - Date.parse(left.receivedAt));
}

function historyDisplayRatio(hit: TopSpotHistoryHit, ratioMode: 'buy-sell' | 'sell-buy'): number {
  if (Number.isFinite(hit.buySellRatio) && hit.buySellRatio !== 0) {
    const ratio = hit.buySellRatio as number;
    return ratioMode === 'sell-buy' ? 1 / ratio : ratio;
  }
  if (!Number.isFinite(hit.buyUsd) || !Number.isFinite(hit.sellUsd) || hit.buyUsd === null || hit.sellUsd === null) return Number.NEGATIVE_INFINITY;
  if (hit.buyUsd <= 0 || hit.sellUsd <= 0) return Number.NEGATIVE_INFINITY;
  return ratioMode === 'sell-buy' ? hit.sellUsd / hit.buyUsd : hit.buyUsd / hit.sellUsd;
}

function formatWindowLabel(from: Date, to: Date): string {
  return `${formatShortDate(from)} · ${formatShortTime(from)} -> ${formatShortTime(to)}`;
}

function formatDateInput(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function moveWindowToLocalDate(current: Date, dateValue: string, activeStart: Date): Date {
  const selectedDate = parseDateInput(dateValue);
  if (!selectedDate) return current;
  const next = new Date(
    selectedDate.year,
    selectedDate.monthIndex,
    selectedDate.day,
    current.getHours(),
    HISTORY_ANCHOR_MINUTE,
    0,
    0
  );
  return next.getTime() > activeStart.getTime() ? activeStart : next;
}

function parseDateInput(value: string): { year: number; monthIndex: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(year, month - 1, day);
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) return null;
  return { year, monthIndex: month - 1, day };
}

function buildHourlyFeedEvent(events: NormalizedEvent[], source: HistorySource): NormalizedEvent | null {
  const sortedEvents = [...events].sort((left, right) => Date.parse(right.receivedAt) - Date.parse(left.receivedAt));
  const latestEvent = sortedEvents[0];
  if (!latestEvent) return null;

  const entriesByCoin = new Map<string, NormalizedEvent['entries'][number]>();
  for (const event of sortedEvents) {
    for (const entry of event.entries) {
      if (!entry.coin || entriesByCoin.has(entry.coin)) continue;
      entriesByCoin.set(entry.coin, entry);
    }
  }

  return {
    ...latestEvent,
    id: `${latestEvent.id}-hourly-${source.sourceKey}`,
    title: source.title,
    plainText: latestEvent.plainText || source.title,
    htmlText: latestEvent.htmlText || source.title,
    coins: Array.from(entriesByCoin.keys()),
    entries: Array.from(entriesByCoin.values())
  };
}

function formatShortTime(value: Date): string {
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(value);
}

function formatShortDate(value: Date): string {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: '2-digit', year: 'numeric' }).format(value);
}

function normalizeCoin(value: string): string | null {
  const normalized = value.trim().toUpperCase();
  return /^[A-Z0-9]{1,30}$/u.test(normalized) ? normalized : null;
}

function finiteNumber(value: number | null | undefined): number | null {
  return Number.isFinite(value) ? value as number : null;
}
