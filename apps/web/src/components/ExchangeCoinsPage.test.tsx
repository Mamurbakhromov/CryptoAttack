import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ExchangeCoinsPage } from './ExchangeCoinsPage';
import type { ExchangeKey, ExchangeMarket, ExchangeSymbol, ExchangeSymbolsResponse } from '../types';

const apiMocks = vi.hoisted(() => ({
  fetchExchangeSymbols: vi.fn(),
  refreshExchangeSymbols: vi.fn()
}));

vi.mock('../api/sse', () => ({
  fetchExchangeSymbols: apiMocks.fetchExchangeSymbols,
  refreshExchangeSymbols: apiMocks.refreshExchangeSymbols
}));

describe('ExchangeCoinsPage', () => {
  beforeEach(() => {
    apiMocks.fetchExchangeSymbols.mockResolvedValue(makeExchangeSymbolsResponse([
      makeSymbol('binance', 'BTC'),
      makeSymbol('bybit', 'ETH'),
      makeSymbol('okx', 'SOL'),
      makeSymbol('binance', 'NOCLS999')
    ]));
    apiMocks.refreshExchangeSymbols.mockResolvedValue({});
  });

  it('allows multiple exchanges to be selected', async () => {
    const user = userEvent.setup();
    render(<ExchangeCoinsPage authToken={null} classificationFilter={[]} exchangeFilter={[]} marketFilter={[]} />);

    expect(await screen.findByText('BTC')).toBeInTheDocument();
    expect(screen.queryByText('ETH')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Bybit' }));

    expect(screen.getByText('ETH')).toBeInTheDocument();
  });

  it('filters symbols by unchecked classification mode', async () => {
    render(<ExchangeCoinsPage authToken={null} classificationFilter={['unchecked']} exchangeFilter={[]} marketFilter={[]} />);

    expect(await screen.findByText('NOCLS999')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('BTC')).not.toBeInTheDocument());
  });
});

function makeExchangeSymbolsResponse(symbols: ExchangeSymbol[]): ExchangeSymbolsResponse {
  return {
    generatedAt: '2026-05-04T00:00:00.000Z',
    enabled: true,
    refreshing: false,
    refreshUtcTime: '00:05',
    nextRefreshAt: null,
    lastRefreshStartedAt: null,
    lastRefreshCompletedAt: null,
    total: symbols.length,
    returned: symbols.length,
    offset: 0,
    limit: 10_000,
    exchanges: ['binance', 'bybit', 'okx', 'coinbase'],
    markets: ['spot', 'perpetual'],
    sources: [
      makeSource('binance', 'spot'),
      makeSource('bybit', 'spot'),
      makeSource('okx', 'spot'),
      makeSource('coinbase', 'spot')
    ],
    symbols
  };
}

function makeSource(exchange: ExchangeKey, market: ExchangeMarket): ExchangeSymbolsResponse['sources'][number] {
  return {
    source: `${exchange}_${market}`,
    exchange,
    exchangeLabel: exchangeLabel(exchange),
    market,
    marketLabel: market === 'spot' ? 'Spot' : 'Perpetual',
    status: 'ok',
    updatedAt: '2026-05-04T00:00:00.000Z',
    lastAttemptAt: null,
    errorMessage: null,
    symbolCount: 1
  };
}

function makeSymbol(exchange: ExchangeKey, baseAsset: string): ExchangeSymbol {
  return {
    source: `${exchange}_spot`,
    exchange,
    exchangeLabel: exchangeLabel(exchange),
    market: 'spot',
    marketLabel: 'Spot',
    symbol: `${baseAsset}USDT`,
    baseAsset,
    quoteAsset: 'USDT',
    status: 'active',
    rawStatus: 'TRADING'
  };
}

function exchangeLabel(exchange: ExchangeKey): string {
  const labels: Record<ExchangeKey, string> = {
    binance: 'Binance',
    bybit: 'Bybit',
    okx: 'OKX',
    coinbase: 'Coinbase'
  };
  return labels[exchange];
}
