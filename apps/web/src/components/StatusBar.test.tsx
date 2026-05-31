import { useState } from 'react';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { CoinClassificationFilter } from '../coinClassification';
import type { ExchangeFilter, MarketFilter } from '../exchangeFilters';
import { makeStatus } from '../test/builders';
import { StatusBar } from './StatusBar';

describe('StatusBar', () => {
  it('opens coin filters as a checklist and allows multiple selections', async () => {
    const user = userEvent.setup();
    render(<StatusBarHarness />);

    await user.click(screen.getByRole('button', { name: 'Coins: All' }));
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Halal only' }));
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Haram only' }));

    expect(screen.getByRole('button', { name: 'Coins: 2 coin filters' })).toBeInTheDocument();
    expect(screen.getByRole('menuitemcheckbox', { name: 'Halal only' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('menuitemcheckbox', { name: 'Haram only' })).toHaveAttribute('aria-checked', 'true');
  });

  it('allows multiple exchanges to be selected in the same menu', async () => {
    const user = userEvent.setup();
    render(<StatusBarHarness />);

    await user.click(screen.getByRole('button', { name: 'Coins: All' }));
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Binance' }));
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Bybit' }));

    expect(screen.getByRole('button', { name: 'Coins: 2 exchanges' })).toBeInTheDocument();
    expect(screen.getByRole('menuitemcheckbox', { name: 'Binance' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('menuitemcheckbox', { name: 'Bybit' })).toHaveAttribute('aria-checked', 'true');
  });

  it('allows spot and futures markets to be selected in the same menu', async () => {
    const user = userEvent.setup();
    render(<StatusBarHarness />);

    await user.click(screen.getByRole('button', { name: 'Coins: All' }));
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Spot' }));
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Futures' }));

    expect(screen.getByRole('button', { name: 'Coins: Spot + Futures' })).toBeInTheDocument();
    expect(screen.getByRole('menuitemcheckbox', { name: 'Spot' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('menuitemcheckbox', { name: 'Futures' })).toHaveAttribute('aria-checked', 'true');
  });

  it('closes the coin filter menu when clicking outside', async () => {
    const user = userEvent.setup();
    render(<StatusBarHarness />);

    await user.click(screen.getByRole('button', { name: 'Coins: All' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    await user.click(document.body);

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('shows degraded storage health from API status', () => {
    render(<StatusBarHarness status={makeStatus({ health: { state: 'degraded', reasons: ['writer_degraded'] } })} />);

    expect(screen.getByText('Storage: degraded')).toBeInTheDocument();
  });

  it('asks for confirmation before clearing event data', async () => {
    const user = userEvent.setup();
    const onClearEventData = vi.fn();
    render(<StatusBarHarness onClearEventData={onClearEventData} />);

    await user.click(screen.getByRole('button', { name: 'Clear events' }));
    expect(screen.getByRole('dialog', { name: 'Confirm clear event data' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear event data' }));

    expect(onClearEventData).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: 'Confirm clear event data' })).not.toBeInTheDocument();
  });

  it('asks for stronger confirmation before resetting all stored data', async () => {
    const user = userEvent.setup();
    const onResetAllStoredData = vi.fn();
    render(<StatusBarHarness onResetAllStoredData={onResetAllStoredData} />);

    await user.click(screen.getByRole('button', { name: 'Reset all data' }));
    expect(screen.getByRole('dialog', { name: 'Confirm reset all stored data' })).toBeInTheDocument();
    expect(screen.getByText('Deletes events, scores, popup evidence, market labels, and the raw event log. Fresh websocket data will start filling again.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Reset stored data' }));

    expect(onResetAllStoredData).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: 'Confirm reset all stored data' })).not.toBeInTheDocument();
  });
});

function StatusBarHarness({
  status = null,
  onClearEventData = vi.fn(),
  onResetAllStoredData = vi.fn()
}: {
  status?: ReturnType<typeof makeStatus> | null;
  onClearEventData?: () => void;
  onResetAllStoredData?: () => void;
}) {
  const [classificationFilter, setClassificationFilter] = useState<CoinClassificationFilter>([]);
  const [exchangeFilter, setExchangeFilter] = useState<ExchangeFilter>([]);
  const [marketFilter, setMarketFilter] = useState<MarketFilter>([]);

  return (
    <StatusBar
      status={status}
      lastEventTime={null}
      latency={{ latestMs: null, averageMs: null, samples: 0 }}
      streamState="open"
      paused={false}
      queuedCount={0}
      soundEnabled={false}
      notificationsEnabled={false}
      classificationFilter={classificationFilter}
      exchangeFilter={exchangeFilter}
      marketFilter={marketFilter}
      theme="dark"
      eventClearState="idle"
      eventClearMessage={null}
      dataResetState="idle"
      dataResetMessage={null}
      onTogglePause={vi.fn()}
      onToggleSound={vi.fn()}
      onToggleNotifications={vi.fn()}
      onClassificationFilterChange={setClassificationFilter}
      onExchangeFilterChange={setExchangeFilter}
      onMarketFilterChange={setMarketFilter}
      onToggleTheme={vi.fn()}
      onClearEventData={onClearEventData}
      onResetAllStoredData={onResetAllStoredData}
    />
  );
}
