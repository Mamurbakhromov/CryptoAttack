import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { FlowsPage } from './FlowsPage';
import { BigActivitiesPage } from './BigActivitiesPage';
import { Dashboard } from './Dashboard';
import { emptyExchangeAvailability } from './ExchangeChips';
import { MarketDataPage } from './MarketDataPage';
import { OiTopTable } from './OiTopTable';
import { OnchainAlphaPage } from './OnchainAlphaPage';
import { SignalsPage } from './SignalsPage';
import { TopTable } from './TopTable';
import { makeEntry, makeEvent, makeSnapshot } from '../test/builders';

describe('structured feed pages', () => {
  it('renders price alert rows from structured entries', () => {
    const snapshot = makeSnapshot({
      pricealerts: [makeEvent('pricealerts', {
        title: 'Price Alert',
        entries: [makeEntry({
          coin: 'BTC',
          exchange: 'Binance Futures',
          href: 'https://example.com/btc',
          priceUsd: 42_000,
          priceChangePercent: 2.4,
          percent: 2.4,
          interval: '1m',
          threshold: 'change2',
          volume24hUsd: 1_200_000,
          amountUsd: 120_000
        })]
      })]
    });

    render(<SignalsPage snapshot={snapshot} highlightedIds={new Set()} classificationFilter={[]} performanceTrends={new Map()} alertKind="price" />);

    expect(screen.getByText('BTC')).toBeInTheDocument();
    expect(screen.getByText('Binance Futures')).toBeInTheDocument();
    expect(screen.getByText('change2')).toBeInTheDocument();
  });

  it('renders flow alerts from structured entries', () => {
    const snapshot = makeSnapshot({
      flows_alert: [makeEvent('flows_alert', {
        title: 'Flow Alert',
        entries: [makeEntry({
          coin: 'LINK',
          exchange: 'Coinbase',
          direction: 'inflow',
          amountUsd: 2_300_000,
          href: 'https://etherscan.io/tx/0x123'
        })]
      })]
    });

    render(<FlowsPage snapshot={snapshot} highlightedIds={new Set()} classificationFilter={[]} performanceTrends={new Map()} />);

    expect(screen.getByText('LINK')).toBeInTheDocument();
    expect(screen.getByText('Coinbase')).toBeInTheDocument();
    expect(screen.getByText('HashTx')).toBeInTheDocument();
  });

  it('renders cex track activity rows from structured entries', () => {
    const snapshot = makeSnapshot({
      cex_track: [makeEvent('cex_track', {
        title: 'CEX Track',
        entries: [makeEntry({
          coin: 'SOL',
          exchange: 'Bitget',
          direction: 'buy',
          href: 'https://example.com/sol',
          amountUsd: 1_250_000,
          amountAsset: 'USDT',
          interval: '8 min',
          percent: 18,
          priceUsd: 174.25,
          priceChangePercent: 3.2,
          volume24hUsd: 9_400_000,
          volume24hAsset: 'USDT',
          lastSeen: '2 h ago'
        })]
      })]
    });

    render(<BigActivitiesPage snapshot={snapshot} highlightedIds={new Set()} classificationFilter={[]} performanceTrends={new Map()} mode="buying" />);

    expect(screen.getByText('SOL')).toBeInTheDocument();
    expect(screen.getByText('Bitget')).toBeInTheDocument();
    expect(screen.getByText('2 h ago')).toBeInTheDocument();
  });

  it('shows B/S 3 average and opens exact 1h ratio history from bull tables', async () => {
    const user = userEvent.setup();
    const snapshot = makeSnapshot({
      all_spot_top_buy_5m: [
        makeEvent('all_spot_top_buy_5m', { id: 'spot-buy-3', receivedAt: '2026-01-01T00:30:00.000Z', entries: [makeEntry({ coin: 'BTC', direction: 'buy', buyUsd: 3_000_000, sellUsd: 1_000_000, deltaUsd: 2_000_000, buySellRatio: 3, volume24hUsd: 100_000_000, rawLine: '#BTC buy 3' })] }),
        makeEvent('all_spot_top_buy_5m', { id: 'spot-buy-2', receivedAt: '2026-01-01T00:20:00.000Z', entries: [makeEntry({ coin: 'BTC', direction: 'buy', buyUsd: 2_000_000, sellUsd: 1_000_000, deltaUsd: 1_000_000, buySellRatio: 2, volume24hUsd: 100_000_000, rawLine: '#BTC buy 2' })] }),
        makeEvent('all_spot_top_buy_5m', { id: 'spot-buy-1', receivedAt: '2026-01-01T00:10:00.000Z', entries: [makeEntry({ coin: 'BTC', direction: 'buy', buyUsd: 1_000_000, sellUsd: 1_000_000, deltaUsd: 0, buySellRatio: 1, volume24hUsd: 100_000_000, rawLine: '#BTC buy 1' })] })
      ],
      all_spot_top_sell_5m: [
        makeEvent('all_spot_top_sell_5m', { id: 'spot-sell-1', receivedAt: '2026-01-01T00:25:00.000Z', entries: [makeEntry({ coin: 'BTC', direction: 'sell', buyUsd: 1_000_000, sellUsd: 2_500_000, deltaUsd: -1_500_000, buySellRatio: 0.4, volume24hUsd: 100_000_000, rawLine: '#BTC sell 2.5' })] })
      ]
    });

    render(<Dashboard snapshot={snapshot} highlightedIds={new Set()} page="bull" exchangeAvailability={emptyExchangeAvailability()} classificationFilter={[]} performanceTrends={new Map()} />);

    expect(screen.getByRole('heading', { name: 'Top Spot' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sort by B\/S 3 Avg/i })).toBeInTheDocument();
    expect(screen.getByText('2.00x')).toBeInTheDocument();

    const btcCell = screen.getAllByText('BTC')[0];
    expect(btcCell).toBeDefined();
    const btcRow = btcCell?.closest('tr');
    expect(btcRow).not.toBeNull();
    await user.click(btcRow!);

    expect(screen.getByRole('heading', { name: 'BTC B/S History' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close B/S history' })).toHaveTextContent('×');
    expect(screen.getByText('3 hits in 1h')).toBeInTheDocument();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('tab', { name: 'Graph' })).toHaveAttribute('aria-selected', 'true');
    expect(within(dialog).getByRole('tab', { name: 'Details' })).toHaveAttribute('aria-selected', 'false');
    expect(within(dialog).getByRole('img', { name: 'BTC B/S and S/B ratio history bar chart from -3 to 3' })).toBeInTheDocument();
    expect(within(dialog).getByText('B/S positive, S/B negative')).toBeInTheDocument();
    expect(within(dialog).getByText('Rolling 3 avg')).toBeInTheDocument();
    expect(within(dialog).getByText('1.5')).toBeInTheDocument();
    expect(within(dialog).getByText('-1.5')).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/S\/B -2\.50x/)).toBeInTheDocument();
    await user.hover(within(dialog).getByLabelText(/B\/S 1\.00x/));
    expect(within(dialog).getByText('B/S 1.00x')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('tab', { name: 'Details' }));
    expect(within(dialog).getByRole('tab', { name: 'Details' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByText(/2026/).length).toBeGreaterThan(0);
    expect(within(dialog).queryByRole('img', { name: /ratio history bar chart/i })).not.toBeInTheDocument();
    expect(within(dialog).queryByText('Source')).not.toBeInTheDocument();
    expect(within(dialog).queryByText('Delta')).not.toBeInTheDocument();
    expect(within(dialog).queryByText('#')).not.toBeInTheDocument();
    expect(within(dialog).queryByText('Exchange')).not.toBeInTheDocument();
  });

  it('groups OI and listing panels together', () => {
    render(<Dashboard snapshot={makeSnapshot()} highlightedIds={new Set()} page="bear" exchangeAvailability={emptyExchangeAvailability()} classificationFilter={[]} performanceTrends={new Map()} />);

    expect(screen.getByRole('heading', { name: 'OI and Listings' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Top 10 OI Gainers 60m' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Listings' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Top 10 OI Losers 60m' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Delistings' })).toBeInTheDocument();
  });

  it('opens OI history modal with graph and details from OI rows', async () => {
    const user = userEvent.setup();
    const events = [
      makeEvent('top_oi_gainers_60m', { id: 'oi-3', receivedAt: '2026-01-01T00:30:00.000Z', entries: [makeEntry({ coin: 'KAIA', direction: 'gainer', exchange: 'Binance', percent: 10.99, priceUsd: 0.0492, priceChangePercent: 1.64, rawLine: '#KAIA oi 3' })] }),
      makeEvent('top_oi_gainers_60m', { id: 'oi-2', receivedAt: '2026-01-01T00:20:00.000Z', entries: [makeEntry({ coin: 'KAIA', direction: 'gainer', exchange: 'Bybit', percent: 8.2, priceUsd: 0.047, priceChangePercent: -0.4, rawLine: '#KAIA oi 2' })] }),
      makeEvent('top_oi_gainers_60m', { id: 'oi-1', receivedAt: '2026-01-01T00:10:00.000Z', entries: [makeEntry({ coin: 'KAIA', direction: 'gainer', exchange: 'Binance', percent: 6.4, priceUsd: 0.045, priceChangePercent: 0.9, rawLine: '#KAIA oi 1' })] })
    ];

    render(<OiTopTable title="Top 10 OI Gainers 60m" subtitle="test" event={events[0] ?? null} historyEvents={events} exchangeAvailability={emptyExchangeAvailability()} classificationFilter={[]} performanceTrends={new Map()} highlighted={false} />);

    const kaiaRow = screen.getByText('KAIA').closest('tr');
    expect(kaiaRow).not.toBeNull();
    await user.click(kaiaRow!);

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'KAIA OI History' })).toBeInTheDocument();
    expect(within(dialog).getByText('3 hits in 1h')).toBeInTheDocument();
    expect(within(dialog).getByText('Rolling price 3')).toBeInTheDocument();
    expect(within(dialog).getByRole('img', { name: 'KAIA OI and price percent history chart from -11 to 11' })).toBeInTheDocument();
    await user.click(within(dialog).getByRole('tab', { name: 'Details' }));
    expect(within(dialog).getByText('OI hits by time')).toBeInTheDocument();
    expect(within(dialog).getAllByText('Binance').length).toBeGreaterThan(0);
  });

  it('plots a single B/S history hit on the right side of the chart', async () => {
    const user = userEvent.setup();
    const event = makeEvent('all_spot_top_buy_5m', {
      id: 'single-spot-buy',
      receivedAt: '2026-01-01T00:30:00.000Z',
      entries: [makeEntry({ coin: 'BTC', direction: 'buy', buyUsd: 2_000_000, sellUsd: 1_000_000, buySellRatio: 2, rawLine: '#BTC single buy' })]
    });

    render(<TopTable title="Top 10 Spot Buyers 5m" subtitle="test" event={event} historyEvents={[event]} market="spot" exchangeAvailability={emptyExchangeAvailability()} classificationFilter={[]} performanceTrends={new Map()} highlighted={false} />);

    const btcRow = screen.getByText('BTC').closest('tr');
    expect(btcRow).not.toBeNull();
    await user.click(btcRow!);

    expect(within(screen.getByRole('dialog')).getByLabelText(/B\/S 2\.00x/)).toHaveAttribute('x', '587');
  });

  it('renders funding rows from structured entries', () => {
    const snapshot = makeSnapshot({
      top_funding: [makeEvent('top_funding', {
        title: 'Funding Snapshot',
        filters: ['highest', '30_min'],
        entries: [makeEntry({
          rank: 1,
          coin: 'BARD',
          exchange: 'Coinbase',
          percent: 1.07,
          interval: '30_min'
        })]
      })]
    });

    render(<MarketDataPage snapshot={snapshot} highlightedIds={new Set()} classificationFilter={[]} performanceTrends={new Map()} />);

    expect(screen.getByText('BARD')).toBeInTheDocument();
    expect(screen.getByText('Coinbase')).toBeInTheDocument();
    expect(screen.getByText('+1.07%')).toBeInTheDocument();
  });

  it('renders onchain snapshots from structured entries', () => {
    const snapshot = makeSnapshot({
      onchain_24_all_flows: [makeEvent('onchain_24_all_flows', {
        title: '📊🔴 CEX Inflows in the past 24 hours #CEXFlows24',
        entries: [makeEntry({ coin: 'PEPE', direction: 'inflow', amountUsd: 8_200_000, interval: '24h' })]
      })],
      onchain_1_all_flows: [makeEvent('onchain_1_all_flows', {
        title: '📊🟢 CEX Outflows in the past 1 hour #CEXFlows1',
        entries: [makeEntry({ coin: 'LINK', direction: 'outflow', amountUsd: 255_000, interval: '1h' })]
      })]
    });

    render(<OnchainAlphaPage snapshot={snapshot} highlightedIds={new Set()} classificationFilter={[]} performanceTrends={new Map()} />);

    expect(screen.getByText('PEPE')).toBeInTheDocument();
    expect(screen.getByText('LINK')).toBeInTheDocument();
    expect(screen.getAllByText(/CEX (Inflows|Outflows) in the past/i).length).toBeGreaterThan(0);
  });
});
