import { useEffect, useRef, useState } from 'react';

import { coinClassificationFilterOptions, getCoinClassificationFilterLabel, type CoinClassificationFilter, type CoinClassificationFilterMode } from '../coinClassification';
import {
  exchangeFilterOptions,
  getExchangeFilterLabel,
  getMarketFilterLabel,
  marketFilterOptions,
  toggleExchangeFilter,
  toggleMarketFilter,
  type ExchangeFilter,
  type MarketFilter
} from '../exchangeFilters';
import type { ApiStatus, LatencyStats, StreamState } from '../types';
import { formatLatency, formatTime } from './format';

interface StatusBarProps {
  status: ApiStatus | null;
  lastEventTime: string | null;
  latency: LatencyStats;
  streamState: StreamState;
  paused: boolean;
  queuedCount: number;
  soundEnabled: boolean;
  notificationsEnabled: boolean;
  classificationFilter: CoinClassificationFilter;
  exchangeFilter: ExchangeFilter;
  marketFilter: MarketFilter;
  theme: 'dark' | 'light';
  onTogglePause: () => void;
  onToggleSound: () => void;
  onToggleNotifications: () => void;
  onClassificationFilterChange: (filter: CoinClassificationFilter) => void;
  onExchangeFilterChange: (filter: ExchangeFilter) => void;
  onMarketFilterChange: (filter: MarketFilter) => void;
  onToggleTheme: () => void;
}

export function StatusBar(props: StatusBarProps) {
  const [classificationMenuOpen, setClassificationMenuOpen] = useState(false);
  const classificationMenuRef = useRef<HTMLDivElement | null>(null);
  const main = props.status?.sockets.main;
  const fast = props.status?.sockets.fast;

  useEffect(() => {
    if (!classificationMenuOpen) return;

    const closeOnOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && classificationMenuRef.current?.contains(target)) return;
      setClassificationMenuOpen(false);
    };

    document.addEventListener('pointerdown', closeOnOutsidePointerDown);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointerDown);
  }, [classificationMenuOpen]);

  return (
    <header className="status-bar sticky top-0 z-20 px-4 py-2 md:px-6">
      <div className="mx-auto max-w-[1800px] overflow-x-auto">
        <div className="flex min-w-max items-center gap-2 text-xs font-bold">
          <StatusPill label={`Stream: ${props.streamState}`} tone={props.streamState === 'open' ? 'ok' : 'warn'} />
          <StatusPill label={formatSocketStatus('Main', main)} tone={socketTone(main)} />
          <StatusPill label={formatSocketStatus('Fast', fast)} tone={socketTone(fast)} />
          <StatusPill label={`Last event: ${formatTime(props.lastEventTime)}`} tone="neutral" />
          <StatusPill label={`Latency: ${formatLatency(props.latency.latestMs ?? props.latency.averageMs)}`} tone="neutral" />
          {props.status?.mockMode ? <StatusPill label="Mock mode" tone="warn" /> : null}
          {props.status?.authEnabled ? <StatusPill label="Auth on" tone="ok" /> : <StatusPill label="Auth off" tone="neutral" />}
          {props.status ? <StatusPill label={formatStorageHealth(props.status)} tone={storageHealthTone(props.status)} /> : null}
          <StatusPill label={props.paused ? `Display: paused (${props.queuedCount})` : 'Display: live'} tone={props.paused ? 'warn' : 'ok'} />

          <button className="control-button" type="button" onClick={props.onTogglePause}>
            {props.paused ? `Resume (${props.queuedCount})` : 'Pause'}
          </button>
          <button className="control-button" type="button" onClick={props.onToggleSound}>
            Sound {props.soundEnabled ? 'on' : 'off'}
          </button>
          <button className="control-button" type="button" onClick={props.onToggleNotifications}>
            Notify {props.notificationsEnabled ? 'on' : 'off'}
          </button>
          <div className="status-filter-control" ref={classificationMenuRef}>
            <button
              className={`control-button classification-trigger ${props.classificationFilter.length || props.exchangeFilter.length || props.marketFilter.length ? 'active' : ''}`}
              type="button"
              aria-haspopup="menu"
              aria-expanded={classificationMenuOpen}
              onClick={() => setClassificationMenuOpen((value) => !value)}
            >
              Coins: {formatFilterTrigger(props.classificationFilter, props.exchangeFilter, props.marketFilter)}
            </button>
            {classificationMenuOpen ? (
              <div className="classification-menu" role="menu" aria-label="Coin classification filters">
                <button
                  className="classification-menu-row"
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={props.classificationFilter.length === 0}
                  onClick={() => props.onClassificationFilterChange([])}
                >
                  <input type="checkbox" checked={props.classificationFilter.length === 0} readOnly tabIndex={-1} />
                  <span>All coins</span>
                </button>
                {coinClassificationFilterOptions.map((option) => {
                  const active = props.classificationFilter.includes(option.value);
                  return (
                    <button
                      className="classification-menu-row"
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={active}
                      onClick={() => props.onClassificationFilterChange(toggleClassificationFilter(props.classificationFilter, option.value))}
                      key={option.value}
                    >
                      <input type="checkbox" checked={active} readOnly tabIndex={-1} />
                      <span>{option.label}</span>
                    </button>
                  );
                })}
                <div className="classification-menu-divider" />
                <div className="classification-menu-heading">Exchanges</div>
                <button
                  className="classification-menu-row"
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={props.exchangeFilter.length === 0}
                  onClick={() => props.onExchangeFilterChange([])}
                >
                  <input type="checkbox" checked={props.exchangeFilter.length === 0} readOnly tabIndex={-1} />
                  <span>All exchanges</span>
                </button>
                {exchangeFilterOptions.map((option) => {
                  const active = props.exchangeFilter.includes(option.value);
                  return (
                    <button
                      className="classification-menu-row"
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={active}
                      onClick={() => props.onExchangeFilterChange(toggleExchangeFilter(props.exchangeFilter, option.value))}
                      key={option.value}
                    >
                      <input type="checkbox" checked={active} readOnly tabIndex={-1} />
                      <span>{option.label}</span>
                    </button>
                  );
                })}
                <div className="classification-menu-divider" />
                <div className="classification-menu-heading">Markets</div>
                <button
                  className="classification-menu-row"
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={props.marketFilter.length === 0}
                  onClick={() => props.onMarketFilterChange([])}
                >
                  <input type="checkbox" checked={props.marketFilter.length === 0} readOnly tabIndex={-1} />
                  <span>Spot + Futures</span>
                </button>
                {marketFilterOptions.map((option) => {
                  const active = props.marketFilter.includes(option.value);
                  return (
                    <button
                      className="classification-menu-row"
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={active}
                      onClick={() => props.onMarketFilterChange(toggleMarketFilter(props.marketFilter, option.value))}
                      key={option.value}
                    >
                      <input type="checkbox" checked={active} readOnly tabIndex={-1} />
                      <span>{option.label}</span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
          <button className="control-button" type="button" onClick={props.onToggleTheme}>
            {props.theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>
        </div>
      </div>
    </header>
  );
}

function formatFilterTrigger(classificationFilter: CoinClassificationFilter, exchangeFilter: ExchangeFilter, marketFilter: MarketFilter): string {
  const classificationLabel = formatClassificationTrigger(classificationFilter);
  const exchangeLabel = getExchangeFilterLabel(exchangeFilter);
  const marketLabel = getMarketFilterLabel(marketFilter);
  const labels = [
    classificationFilter.length ? classificationLabel : null,
    exchangeFilter.length ? exchangeLabel : null,
    marketFilter.length ? marketLabel : null
  ].filter((label): label is string => label !== null);

  return labels.length ? labels.join(', ') : 'All';
}

function formatClassificationTrigger(filter: CoinClassificationFilter): string {
  if (filter.length === 0) return 'All coins';
  if (filter.length === 1) return getCoinClassificationFilterLabel(filter);
  return `${filter.length} coin filters`;
}

function toggleClassificationFilter(current: CoinClassificationFilter, mode: CoinClassificationFilterMode): CoinClassificationFilter {
  if (current.includes(mode)) return current.filter((item) => item !== mode);
  return coinClassificationFilterOptions
    .map((option) => option.value)
    .filter((item) => current.includes(item) || item === mode);
}

function StatusPill(props: { label: string; tone: 'ok' | 'bad' | 'warn' | 'neutral' }) {
  return <span className={`status-pill ${props.tone}`}>{props.label}</span>;
}

function formatStorageHealth(status: ApiStatus): string {
  const state = status.health?.state ?? status.storage?.state ?? 'disabled';
  if (state === 'unhealthy') return 'Storage: unhealthy';
  if (state === 'degraded') return 'Storage: degraded';
  if (state === 'healthy' || state === 'running') return 'Storage: healthy';
  return 'Storage: disabled';
}

function storageHealthTone(status: ApiStatus): 'ok' | 'bad' | 'warn' | 'neutral' {
  const state = status.health?.state ?? status.storage?.state ?? 'disabled';
  if (state === 'unhealthy') return 'bad';
  if (state === 'degraded') return 'warn';
  if (state === 'healthy' || state === 'running') return 'ok';
  return 'neutral';
}

function formatSocketStatus(label: string, socket: { connected: boolean; serverConnected: boolean; lastError: string | null } | undefined): string {
  if (!socket) return `${label}: waiting`;
  if (socket.serverConnected) return `${label}: connected`;
  if (socket.connected) return `${label}: socket open`;
  return `${label}: ${socket.lastError ?? 'offline'}`;
}

function socketTone(socket: { connected: boolean; serverConnected: boolean } | undefined): 'ok' | 'bad' | 'warn' {
  if (socket?.serverConnected) return 'ok';
  if (socket?.connected) return 'warn';
  return 'bad';
}
