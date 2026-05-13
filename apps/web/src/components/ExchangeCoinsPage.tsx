import { useDeferredValue, useEffect, useState } from 'react';

import { fetchExchangeSymbols, refreshExchangeSymbols } from '../api/sse';
import {
  getCoinClassification,
  getCoinClassificationClasses,
  getCoinClassificationFilterLabel,
  getCryptoIslamClassification,
  isCoinClassificationFilterActive,
  matchesCoinClassificationFilter,
  type CoinClassification,
  type CoinClassificationFilter
} from '../coinClassification';
import { isExchangeFilterActive, isMarketFilterActive, type ExchangeFilter, type MarketFilter } from '../exchangeFilters';
import type { ExchangeKey, ExchangeMarket, ExchangeSymbol, ExchangeSymbolsResponse, ExchangeSymbolStatus } from '../types';
import { formatDateTime } from './format';

interface ExchangeCoinsPageProps {
  authToken: string | null;
  classificationFilter: CoinClassificationFilter;
  exchangeFilter: ExchangeFilter;
  marketFilter: MarketFilter;
}

const exchangeLabels: Record<ExchangeKey, string> = {
  binance: 'Binance',
  bybit: 'Bybit',
  okx: 'OKX',
  coinbase: 'Coinbase'
};

const marketLabels: Record<ExchangeMarket, string> = {
  spot: 'Spot',
  perpetual: 'Perpetual'
};
const exchangeButtons: ExchangeKey[] = ['binance', 'bybit', 'okx', 'coinbase'];
const marketButtons: ExchangeMarket[] = ['spot', 'perpetual'];

export function ExchangeCoinsPage({ authToken, classificationFilter, exchangeFilter, marketFilter }: ExchangeCoinsPageProps) {
  const [response, setResponse] = useState<ExchangeSymbolsResponse | null>(null);
  const [selectedExchanges, setSelectedExchanges] = useState<ExchangeKey[]>(['binance']);
  const [selectedMarket, setSelectedMarket] = useState<ExchangeMarket>('spot');
  const [selectedStatus, setSelectedStatus] = useState<ExchangeSymbolStatus | 'all'>('active');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deferredSearch = useDeferredValue(search);

  useEffect(() => {
    const abortController = new AbortController();
    setLoading(true);
    void fetchExchangeSymbols(authToken, {
      status: selectedStatus,
      search: deferredSearch,
      quoteAsset: 'USDT',
      limit: 10_000
    }, abortController.signal)
      .then((nextResponse) => {
        setResponse(nextResponse);
        setError(null);
      })
      .catch((fetchError: unknown) => {
        if (!abortController.signal.aborted) setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
      })
      .finally(() => {
        if (!abortController.signal.aborted) setLoading(false);
      });

    return () => abortController.abort();
  }, [authToken, deferredSearch, selectedStatus]);

  const triggerRefresh = async () => {
    const abortController = new AbortController();
    setRefreshing(true);
    try {
      await refreshExchangeSymbols(authToken, abortController.signal);
      const nextResponse = await fetchExchangeSymbols(authToken, {
        status: selectedStatus,
        search: deferredSearch,
        quoteAsset: 'USDT',
        limit: 10_000
      }, abortController.signal);
      setResponse(nextResponse);
      setError(null);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
    } finally {
      setRefreshing(false);
    }
  };

  const rawSymbols = response?.symbols ?? [];
  const effectiveSelectedExchanges = isExchangeFilterActive(exchangeFilter) ? exchangeFilter : selectedExchanges;
  const effectiveSelectedMarkets = isMarketFilterActive(marketFilter) ? marketFilter : [selectedMarket];
  const selectedExchangeSet = new Set(effectiveSelectedExchanges);
  const selectedMarketSet = new Set(effectiveSelectedMarkets);
  const exchangeSymbols = rawSymbols.filter((symbol) => selectedExchangeSet.has(symbol.exchange) && selectedMarketSet.has(symbol.market));
  const symbols = exchangeSymbols.filter((symbol) => matchesCoinClassificationFilter(symbol.baseAsset, classificationFilter));
  const classificationActive = isCoinClassificationFilterActive(classificationFilter);

  return (
    <main className="mx-auto grid max-w-[1800px] gap-3 px-4 py-3 md:px-6">
      <section className="page-hero coins">
        <h1>Exchange Coins</h1>
        <span>Daily public exchange symbol lists, refreshed at {response?.refreshUtcTime ?? '00:05'} UTC</span>
      </section>

      <section className="panel min-h-[520px]">
        <div className="panel-header">
          <div>
            <h2>Available Coins By Exchange</h2>
            <p>Browse listed USDT spot and perpetual symbols from public exchange APIs.</p>
          </div>
          <span className="count-pill">{loading ? 'Loading' : `${symbols.length}${classificationActive ? ` / ${exchangeSymbols.length}` : ''} symbols`}</span>
        </div>

        <div className="exchange-controls">
          <div className="performance-exchange-buttons" role="group" aria-label="Exchange">
            <button
              className={`control-button ${effectiveSelectedExchanges.length === exchangeButtons.length ? 'active' : ''}`}
              type="button"
              aria-pressed={effectiveSelectedExchanges.length === exchangeButtons.length}
              onClick={() => setSelectedExchanges(exchangeButtons)}
            >
              All
            </button>
            {exchangeButtons.map((exchange) => (
              <button
                className={`control-button ${selectedExchangeSet.has(exchange) ? 'active' : ''}`}
                type="button"
                aria-pressed={selectedExchangeSet.has(exchange)}
                onClick={() => setSelectedExchanges((current) => toggleExchange(current, exchange))}
                key={exchange}
              >
                {exchangeLabels[exchange]}
              </button>
            ))}
          </div>
          <div className="performance-exchange-buttons" role="group" aria-label="Market">
            {marketButtons.map((market) => (
              <button
                className={`control-button ${selectedMarket === market ? 'active' : ''}`}
                type="button"
                onClick={() => setSelectedMarket(market)}
                key={market}
              >
                {marketLabels[market]}
              </button>
            ))}
          </div>
          <input
            className="exchange-control exchange-search"
            type="search"
            placeholder="Search BTC, ETH, BTCUSDT..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <select className="exchange-control" value={selectedStatus} onChange={(event) => setSelectedStatus(event.target.value as ExchangeSymbolStatus | 'all')}>
            <option value="active">Active only</option>
            <option value="inactive">Inactive only</option>
            <option value="unknown">Unknown status</option>
            <option value="all">All statuses</option>
          </select>
          <button className="control-button" type="button" disabled={refreshing} onClick={() => void triggerRefresh()}>
            {refreshing ? 'Refreshing' : 'Refresh now'}
          </button>
        </div>

        {error ? <div className="warning-banner mt-3">Exchange symbols warning: {error}</div> : null}

        {response ? <SourceStatusGrid response={response} selectedExchanges={effectiveSelectedExchanges} selectedMarkets={effectiveSelectedMarkets} /> : null}

        {symbols.length ? (
          <ExchangeSymbolsTable symbols={symbols} />
        ) : (
          <div className="empty-state">{getExchangeSymbolsEmptyState(loading, effectiveSelectedExchanges, classificationFilter)}</div>
        )}
      </section>
    </main>
  );
}

function SourceStatusGrid({ response, selectedExchanges, selectedMarkets }: { response: ExchangeSymbolsResponse; selectedExchanges: ExchangeKey[]; selectedMarkets: ExchangeMarket[] }) {
  const selectedExchangeSet = new Set(selectedExchanges);
  const selectedMarketSet = new Set(selectedMarkets);
  const sources = response.sources.filter((source) => selectedMarketSet.has(source.market) && selectedExchangeSet.has(source.exchange));

  return (
    <div className="exchange-source-grid">
      {sources.map((source) => (
        <div className={`exchange-source-card ${source.status}`} key={source.source}>
          <strong>{source.exchangeLabel} {source.marketLabel}</strong>
          <span>{source.symbolCount} symbols</span>
          <small>{source.status === 'error' ? source.errorMessage : `Updated ${formatDateTime(source.updatedAt)}`}</small>
        </div>
      ))}
    </div>
  );
}

function ExchangeSymbolsTable({ symbols }: { symbols: ExchangeSymbol[] }) {
  return (
    <div className="mt-4 overflow-hidden rounded-2xl border border-slate-800/80">
      <table className="w-full table-fixed text-left text-[11px] xl:text-xs 2xl:text-sm">
        <thead className="bg-slate-950/70 text-[9px] uppercase tracking-[0.12em] text-slate-500 xl:text-[10px]">
          <tr>
            <th className="w-[24%] px-4 py-2">Coin</th>
            <th className="w-[18%] px-4 py-2">Exchange</th>
            <th className="w-[22%] px-4 py-2">CryptoHalal</th>
            <th className="w-[22%] px-4 py-2">Crypto Islam</th>
            <th className="w-[14%] px-4 py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {symbols.map((symbol) => {
            const cryptoHalalStatus = getCoinClassification(symbol.baseAsset);
            const cryptoIslamStatus = getCryptoIslamClassification(symbol.baseAsset);
            return (
              <tr className={`classification-row border-t border-slate-800/70 ${getCoinClassificationClasses(symbol.baseAsset)}`} key={`${symbol.source}-${symbol.symbol}`}>
                <td className="px-4 py-3">
                  <button className="coin-button coin-button-large" type="button" onClick={() => copyText(symbol.baseAsset)}>{symbol.baseAsset}</button>
                </td>
                <td className="px-4 py-3 font-bold text-slate-200">{symbol.exchangeLabel}</td>
                <td className="px-4 py-3"><ClassificationBadge status={cryptoHalalStatus} /></td>
                <td className="px-4 py-3"><ClassificationBadge status={cryptoIslamStatus} /></td>
                <td className="px-4 py-3"><span className={`exchange-status ${symbol.status}`}>{symbol.status}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function toggleExchange(current: ExchangeKey[], exchange: ExchangeKey): ExchangeKey[] {
  if (current.includes(exchange)) return current.filter((item) => item !== exchange);
  return exchangeButtons.filter((item) => current.includes(item) || item === exchange);
}

function getExchangeSymbolsEmptyState(loading: boolean, selectedExchanges: ExchangeKey[], classificationFilter: CoinClassificationFilter): string {
  if (loading) return 'Loading exchange symbols';
  if (selectedExchanges.length === 0) return 'Select at least one exchange';
  if (isCoinClassificationFilterActive(classificationFilter)) return `No USDT symbols match ${getCoinClassificationFilterLabel(classificationFilter)}`;
  return 'No symbols match the current filters';
}

function ClassificationBadge({ status }: { status: CoinClassification }) {
  return <span className={`classification-status ${status}`}>{status}</span>;
}

function copyText(value: string): void {
  void navigator.clipboard?.writeText(value);
}
