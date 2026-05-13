import { useEffect, useState } from 'react';

import { fetchSpotPerformance } from '../api/sse';
import { getCoinClassificationClasses, getCoinClassificationFilterLabel, isCoinClassificationFilterActive, matchesCoinClassificationFilter, type CoinClassificationFilter } from '../coinClassification';
import { isExchangeFilterActive, marketFilterAllows, type ExchangeFilter, type MarketFilter } from '../exchangeFilters';
import type { ExchangeKey, SpotPerformanceResponse, SpotPerformanceTicker } from '../types';
import { formatDateTime } from './format';

interface PerformancePageProps {
  authToken: string | null;
  classificationFilter: CoinClassificationFilter;
  exchangeFilter: ExchangeFilter;
  marketFilter: MarketFilter;
  livePerformanceByExchange: Partial<Record<ExchangeKey, SpotPerformanceResponse>>;
}

const exchangeLabels: Record<ExchangeKey, string> = {
  binance: 'Binance',
  bybit: 'Bybit',
  okx: 'OKX',
  coinbase: 'Coinbase'
};
const exchanges: ExchangeKey[] = ['binance', 'bybit', 'okx'];

export function PerformancePage({ authToken, classificationFilter, exchangeFilter, marketFilter, livePerformanceByExchange }: PerformancePageProps) {
  const [selectedExchange, setSelectedExchange] = useState<ExchangeKey>('binance');
  const [response, setResponse] = useState<SpotPerformanceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const visibleExchangeButtons = isExchangeFilterActive(exchangeFilter) ? exchanges.filter((exchange) => exchangeFilter.includes(exchange)) : exchanges;
  const selectedExchangeAllowed = !isExchangeFilterActive(exchangeFilter) || exchangeFilter.includes(selectedExchange);

  useEffect(() => {
    if (selectedExchangeAllowed || !visibleExchangeButtons.length) return;
    setSelectedExchange(visibleExchangeButtons[0] as ExchangeKey);
  }, [selectedExchangeAllowed, visibleExchangeButtons]);

  useEffect(() => {
    const liveResponse = livePerformanceByExchange[selectedExchange];
    if (liveResponse) {
      setResponse(liveResponse);
      setLoading(false);
    }
  }, [livePerformanceByExchange, selectedExchange]);

  useEffect(() => {
    const abortController = new AbortController();
    setLoading(true);
    void fetchSpotPerformance(authToken, {
      exchange: selectedExchange,
      limit: 100
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
  }, [authToken, reloadKey, selectedExchange]);

  const responseAllowed = response ? marketFilterAllows('spot', marketFilter) && (!isExchangeFilterActive(exchangeFilter) || exchangeFilter.includes(response.exchange as ExchangeKey)) : true;
  const gainers = filterPerformanceRows(responseAllowed ? response?.gainers ?? [] : [], classificationFilter);
  const losers = filterPerformanceRows(responseAllowed ? response?.losers ?? [] : [], classificationFilter);
  const liveGainers = filterPerformanceRows(responseAllowed ? response?.liveGainers ?? [] : [], classificationFilter);
  const liveLosers = filterPerformanceRows(responseAllowed ? response?.liveLosers ?? [] : [], classificationFilter);

  return (
    <main className="mx-auto grid max-w-[1800px] gap-3 px-4 py-3 md:px-6">
      <section className="page-hero performance">
        <h1>Performance</h1>
        <span>USDT spot daily gainers and losers from public exchange tickers</span>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Spot Market Performance</h2>
            <p>Choose an exchange to show that exchange's USDT spot gainers and losers.</p>
          </div>
          <span className="count-pill">{loading ? 'Loading' : formatDateTime(response?.generatedAt)}</span>
        </div>

        <div className="exchange-controls">
          <div className="performance-exchange-buttons" role="group" aria-label="Performance exchange">
            {visibleExchangeButtons.map((exchange) => (
              <button
                className={`control-button ${selectedExchange === exchange ? 'active' : ''}`}
                type="button"
                onClick={() => setSelectedExchange(exchange)}
                key={exchange}
              >
                {exchangeLabels[exchange]}
              </button>
            ))}
          </div>
          <button className="control-button" type="button" disabled={loading} onClick={() => setReloadKey((value) => value + 1)}>
            {loading ? 'Refreshing' : 'Refresh'}
          </button>
        </div>

        {error ? <div className="warning-banner mt-3">Performance warning: {error}</div> : null}

        {response ? <PerformanceSourceGrid response={response} /> : null}
      </section>

      <section className="page-hero performance">
        <h1>Live Performance</h1>
        <span>Top movers since the UTC 00:00 daily open</span>
      </section>

      <section className="grid gap-3 xl:grid-cols-2">
        <PerformanceTable title="UTC 0 Gainers" tone="positive" rows={liveGainers} loading={loading} classificationFilter={classificationFilter} percentMode="utcDay" />
        <PerformanceTable title="UTC 0 Losers" tone="negative" rows={liveLosers} loading={loading} classificationFilter={classificationFilter} percentMode="utcDay" />
      </section>

      <section className="grid gap-3 xl:grid-cols-2">
        <PerformanceTable title="Rolling 24h Gainers" tone="positive" rows={gainers} loading={loading} classificationFilter={classificationFilter} percentMode="rolling24h" />
        <PerformanceTable title="Rolling 24h Losers" tone="negative" rows={losers} loading={loading} classificationFilter={classificationFilter} percentMode="rolling24h" />
      </section>
    </main>
  );
}

function PerformanceSourceGrid({ response }: { response: SpotPerformanceResponse }) {
  return (
    <div className="exchange-source-grid">
      {response.sources.map((source) => (
        <div className={`exchange-source-card ${source.status}`} key={source.exchange}>
          <strong>{source.exchangeLabel} Spot</strong>
          <span>{source.itemCount} tickers</span>
          <small>{source.status === 'error' ? source.errorMessage : `Updated ${formatDateTime(source.updatedAt)}`}</small>
        </div>
      ))}
    </div>
  );
}

function filterPerformanceRows(rows: SpotPerformanceTicker[], classificationFilter: CoinClassificationFilter): SpotPerformanceTicker[] {
  const visibleRows = rows.filter((row) => matchesCoinClassificationFilter(row.baseAsset, classificationFilter));
  return visibleRows.slice(0, 10);
}

function PerformanceTable({ title, tone, rows, loading, classificationFilter, percentMode }: { title: string; tone: 'positive' | 'negative'; rows: SpotPerformanceTicker[]; loading: boolean; classificationFilter: CoinClassificationFilter; percentMode: 'rolling24h' | 'utcDay' }) {
  const percentLabel = percentMode === 'utcDay' ? 'UTC 0 %' : '24h %';
  const description = percentMode === 'utcDay'
    ? 'Top 10 USDT spot pairs by change since 00:00 UTC.'
    : 'Top 10 USDT spot pairs by rolling 24h price change.';

  return (
    <section className="panel min-h-[420px]">
      <div className="panel-header">
          <div>
            <h2>{title}</h2>
            <p>{description}</p>
          </div>
        <span className="count-pill">{rows.length ? `${rows.length} rows` : loading ? 'Loading' : 'Empty'}</span>
      </div>

      {rows.length ? (
        <div className="overflow-hidden rounded-2xl border border-slate-800/80">
          <table className="w-full table-fixed text-left text-[11px] xl:text-xs 2xl:text-sm">
            <thead className="bg-slate-950/70 text-[9px] uppercase tracking-[0.12em] text-slate-500 xl:text-[10px]">
              <tr>
                <th className="w-[7%] px-1.5 py-2">#</th>
                <th className="w-[16%] px-1.5 py-2">Coin</th>
                <th className="w-[22%] px-1.5 py-2">Pair</th>
                <th className="w-[16%] px-1.5 py-2">Exchange</th>
                <th className="w-[14%] px-1.5 py-2">Price</th>
                <th className="w-[12%] px-1.5 py-2">{percentLabel}</th>
                <th className="w-[13%] px-1.5 py-2">Vol24</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr className={`classification-row border-t border-slate-800/70 ${getCoinClassificationClasses(row.baseAsset)}`} key={`${row.exchange}-${row.symbol}`}>
                  <td className="px-1.5 py-2 font-black text-slate-500">{index + 1}</td>
                  <td className="px-1.5 py-2">
                    <button className="coin-button" type="button" onClick={() => copyText(row.baseAsset)}>{row.baseAsset}</button>
                  </td>
                  <td className="px-1.5 py-2 font-bold text-cyan-100">{row.symbol}</td>
                  <td className="px-1.5 py-2 font-bold text-slate-200">{row.exchangeLabel}</td>
                  <td className="px-1.5 py-2 font-bold text-slate-200">{formatPrice(row.lastPrice, row.quoteAsset)}</td>
                    <td className={`px-1.5 py-2 font-bold performance-change ${tone}`}>{formatPercent(getPerformancePercent(row, percentMode))}</td>
                  <td className="px-1.5 py-2 font-bold text-slate-300">{formatVolume(row.volume24hQuote, row.quoteAsset)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-state">{getPerformanceEmptyState(loading, classificationFilter)}</div>
      )}
    </section>
  );
}

function getPerformanceEmptyState(loading: boolean, classificationFilter: CoinClassificationFilter): string {
  if (loading) return 'Loading performance data';
  if (!isCoinClassificationFilterActive(classificationFilter)) return 'No performance rows available';
  return `No performance rows match ${getCoinClassificationFilterLabel(classificationFilter)}`;
}

function formatPrice(value: number | null, quoteAsset: string): string {
  if (!Number.isFinite(value)) return '-';
  const finiteValue = value as number;
  const maximumFractionDigits = finiteValue >= 100 ? 2 : finiteValue >= 1 ? 4 : 8;
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits }).format(finiteValue)} ${quoteAsset}`;
}

function formatVolume(value: number | null, quoteAsset: string): string {
  if (!Number.isFinite(value)) return '-';
  return `${new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 2 }).format(value as number)} ${quoteAsset}`;
}

function formatPercent(value: number): string {
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function getPerformancePercent(row: SpotPerformanceTicker, mode: 'rolling24h' | 'utcDay'): number {
  if (mode === 'utcDay') return row.priceChangePercentUtcDay ?? row.priceChangePercent24h;
  return row.priceChangePercent24h;
}

function copyText(value: string): void {
  void navigator.clipboard?.writeText(value);
}
