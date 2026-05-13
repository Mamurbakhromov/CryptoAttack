import type { AppConfig } from '../config.js';
import { getSubscriptions, buildSubscribePayload, createSubscriptionStatus, type EndpointName } from '../cryptoattack/subscriptions.js';
import type { EventStore } from '../events/eventStore.js';
import { normalizeCryptoAttackEvent } from '../events/normalizer.js';
import type { NormalizedEvent, RawCryptoAttackEvent } from '../events/types.js';
import type { AppLogger } from '../utils/logger.js';

export type RawEventAppender = (raw: unknown, storedEvents: NormalizedEvent[]) => void;
export type MockRawEventHandler = (raw: unknown, endpointName: 'main' | 'fast') => void;

interface MockController {
  stop: () => void;
}

const coins = ['BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'DOGE', 'LINK', 'AVAX', 'SUI', 'TON'];

export function startMockCryptoAttack(input: {
  config: AppConfig;
  store: EventStore;
  logger: AppLogger;
  appendRawEvent: RawEventAppender;
  handleRawEvent?: MockRawEventHandler;
}): MockController {
  const { config, store, logger, appendRawEvent, handleRawEvent } = input;
  const subscriptions = getSubscriptions(config);
  setMockStatus(store, config, 'main', subscriptions.main.map(createSubscriptionStatus));
  setMockStatus(store, config, 'fast', subscriptions.fast.map(createSubscriptionStatus));

  let index = 0;
  let sequence = 1;
  const generators = [
    () => listing(sequence++),
    () => delisting(sequence++),
    () => allDerivativesTop(sequence++, 'buy'),
    () => allDerivativesTop(sequence++, 'sell'),
    () => allSpotTop(sequence++, 'buy'),
    () => allSpotTop(sequence++, 'sell'),
    () => amountFeed(sequence++, 'all_spot_per'),
    () => amountFeed(sequence++, 'all_derivatives_per'),
    () => topOi(sequence++, 'gainers'),
    () => topOi(sequence++, 'losers'),
    () => oiAlert(sequence++),
    () => signalFeed(sequence++, 'pricealerts'),
    () => signalFeed(sequence++, 'volalerts'),
    () => flowAlert(sequence++, 'outflow'),
    () => flowAlert(sequence++, 'inflow'),
    () => cexTrack(sequence++, 'buy'),
    () => cexTrack(sequence++, 'sell'),
    () => cexTrack(sequence++, 'activity'),
    () => fundingSnapshot(sequence++, 'highest', '30_min'),
    () => fundingSnapshot(sequence++, 'highest', '4_h'),
    () => fundingSnapshot(sequence++, 'lowest', '30_min'),
    () => fundingSnapshot(sequence++, 'lowest', '4_h'),
    () => etfSnapshot(sequence++),
    () => onchainSnapshot(sequence++, '24_all_flows', 'inflow'),
    () => onchainSnapshot(sequence++, '24_all_flows', 'outflow'),
    () => onchainSnapshot(sequence++, '1_all_flows', 'inflow'),
    () => onchainSnapshot(sequence++, '1_all_flows', 'outflow')
  ];

  const emitNext = () => {
    const generated = generators[index % generators.length]?.();
    index += 1;
    if (!generated) return;
    if (handleRawEvent) {
      handleRawEvent(generated.raw, generated.endpointName);
      return;
    }
    const events = normalizeCryptoAttackEvent(generated.raw, {
      endpointName: generated.endpointName,
      enableDelistings: config.enableDelistings,
      enableAnnouncementDelistingFallback: config.enableAnnouncementDelistingFallback
    });
    const stored = store.addEvents(events);
    appendRawEvent(generated.raw, stored);
  };

  emitNext();
  const timer = setInterval(emitNext, config.mockEventIntervalMs);
  timer.unref();
  logger.info({ intervalMs: config.mockEventIntervalMs }, 'Mock CryptoAttack generator started');

  return {
    stop: () => clearInterval(timer)
  };
}

function setMockStatus(
  store: EventStore,
  config: AppConfig,
  endpointName: EndpointName,
  subscriptions: ReturnType<typeof createSubscriptionStatus>[]
): void {
  const now = new Date().toISOString();
  const url = endpointName === 'main' ? config.cryptoAttackMainUrl : config.cryptoAttackFastUrl;
  store.setConnectionStatus({
    name: endpointName,
    url,
    connected: true,
    serverConnected: true,
    enabled: true,
    mock: true,
    generation: 1,
    socketId: `mock-${endpointName}`,
    transport: 'mock',
    lastConnectedAt: now,
    lastDisconnectedAt: null,
    lastError: null,
    subscriptionCount: subscriptions.length,
    lastNewsAt: null,
    subscriptions: subscriptions.map((subscription) => ({
      ...subscription,
      state: 'attempted',
      attempts: 1,
      lastAttemptAt: now,
      payloadPreview: buildSubscribePayload({
        endpoint: endpointName,
        chapter: subscription.chapter,
        category: subscription.category,
        feedKeys: [],
        payload: {},
        notes: subscription.notes,
        needsConfirmation: subscription.needsConfirmation
      })
    }))
  });
}

function baseRaw(sequence: number, chapter: string, category: string, texts: string[], filters: string[]): RawCryptoAttackEvent {
  const now = Date.now();
  return {
    chapter,
    category,
    texts,
    coins: false,
    filters,
    pricetrack: false,
    timesend1: now - Math.floor(Math.random() * 140),
    timestamp: new Date(now - 120).toISOString(),
    id: `mock_${category}_${sequence}`,
    source: 'mock',
    time: now - Math.floor(Math.random() * 140)
  };
}

function listing(sequence: number) {
  const coin = pick(sequence);
  return {
    endpointName: 'fast',
    raw: {
      ...baseRaw(sequence, 'cex_alerts', 'listings', [
        `🚀 Binance will list ${coin}USDT at 12:00 UTC. <a href="https://example.com/listing/${coin.toLowerCase()}">Source</a>`,
        false as unknown as string
      ], ['listing']),
      coins: [coin]
    }
  } as const;
}

function delisting(sequence: number) {
  const coin = pick(sequence + 3);
  return {
    endpointName: 'fast',
    raw: {
      ...baseRaw(sequence, 'cex_alerts', 'delistings', [
        `⚠️ OKX will delist ${coin}USDT perpetual swaps. Confirm delistings category with provider.`
      ], ['delisting']),
      coins: [coin]
    }
  } as const;
}

function allSpotTop(sequence: number, direction: 'buy' | 'sell') {
  return {
    endpointName: 'main',
    raw: baseRaw(sequence, 'cex_alerts', 'all_spot_top', [topRows(`Top 10 ${direction === 'buy' ? 'buying' : 'selling'} coins on all spot in last 5m`, 1.6, direction)], [
      direction,
      '5m'
    ])
  } as const;
}

function allDerivativesTop(sequence: number, direction: 'buy' | 'sell') {
  return {
    endpointName: 'main',
    raw: baseRaw(sequence, 'cex_alerts', 'all_derivatives_top', [topRows(`Top 10 ${direction === 'buy' ? 'buying' : 'selling'} coins in all derivatives in last 5m`, 3.4, direction)], [
      direction,
      '5m'
    ])
  } as const;
}

function topOi(sequence: number, direction: 'gainers' | 'losers') {
  const rows = coins
    .slice(0, 10)
    .map((coin, index) => `${index + 1}. ${coin}USDT OI ${direction === 'gainers' ? '+' : '-'}${(4 + index * 0.7).toFixed(1)}% $${(12 + index * 3).toFixed(1)}M`)
    .join('\n');
  return {
    endpointName: 'main',
    raw: baseRaw(sequence, 'market_data', 'top_oi', [`Top 10 OI ${direction === 'gainers' ? 'Gainers' : 'Losers'} (1h)\n${rows}`], [direction, '60_min'])
  } as const;
}

function amountFeed(sequence: number, category: 'all_spot_per' | 'all_derivatives_per') {
  const market = category === 'all_spot_per' ? 'spot' : 'derivatives';
  return {
    endpointName: 'main',
    raw: baseRaw(sequence, 'cex_alerts', category, [
      `All ${market} amount buying\nTotal amount: $${(12 + sequence * 0.4).toFixed(1)}M\n1. BTCUSDT buy $5.2M +2.1%\n2. ETHUSDT buy $3.4M +1.4%`
    ], ['amount', market])
  } as const;
}

function oiAlert(sequence: number) {
  const coin = pick(sequence + 5);
  return {
    endpointName: 'main',
    raw: {
      ...baseRaw(sequence, 'signals', 'oi_alerts', [
        `#${coin} OI alert on Binance Futures: +${(12 + sequence % 9).toFixed(1)}% in 10m. Price: ${(0.01 + sequence * 0.0007).toFixed(5)} (${(1.2 + sequence % 4).toFixed(2)}%)`
      ], ['oi_alerts', 'open_interest']),
      coins: [coin]
    }
  } as const;
}

function signalFeed(
  sequence: number,
  category: 'pricealerts' | 'volalerts'
) {
  const coin = pick(sequence + 7);
  const price = (0.75 + sequence * 0.031).toFixed(4);
  const priceMove = signedPercent(1.9 + (sequence % 4) * 0.63, sequence % 3 !== 0);
  const signalMove = signedPercent(5.1 + (sequence % 5) * 1.24, sequence % 4 !== 0);
  const alertVolume = `${12 + (sequence % 8) * 9}K`;
  const volume24h = `${(0.8 + sequence * 0.14).toFixed(2)}M`;
  const window = category === 'pricealerts' ? (sequence % 2 === 0 ? '1' : '5') : (sequence % 3 === 0 ? '10' : sequence % 2 === 0 ? '5' : '1');
  const exchange = category === 'pricealerts'
    ? sequence % 2 === 0
      ? { label: 'Binance Futures', filter: 'binance_fut', href: `https://www.binance.com/en/futures/${coin}USDT` }
      : { label: 'Bybit', filter: 'bybit', href: `https://www.bybit.com/trade/spot/${coin}/USDT` }
    : sequence % 2 === 0
      ? { label: 'Binance', filter: 'binance', href: `https://www.binance.com/en/trade/${coin}_USDT` }
      : { label: 'Bybit Futures', filter: 'bybit_fut', href: `https://www.bybit.com/trade/usdt/${coin}USDT` };

  const text = category === 'pricealerts'
    ? `${priceMove.startsWith('-') ? '🧨🔊' : '🔋🔊'} #${coin} $${price} <b>${priceMove}% (${window} min)</b> Vol 24h: $${volume24h} (${alertVolume}) <a href="${exchange.href}">${exchange.label}</a> #PriceAlerts`
    : `${signalMove.startsWith('-') ? '🧨📶' : '🔋📶'} #${coin} $${price} ${priceMove}% Vol 24h: $${volume24h} (${signalMove.startsWith('-') ? '-' : ''}${alertVolume}) <b>${signalMove}% (${window} min)</b> <a href="${exchange.href}">${exchange.label}</a> #VolAlerts`;
  const filters = category === 'pricealerts'
    ? [exchange.filter, `${window}_min`, window === '1' ? 'change2' : 'change5']
    : [exchange.filter, `${window}_min`, window === '1' ? 'change5' : window === '5' ? 'change10' : 'change15'];

  return {
    endpointName: 'main',
    raw: {
      ...baseRaw(sequence, 'signals', category, [text], filters),
      coins: [coin]
    }
  } as const;
}

function flowAlert(sequence: number, direction: 'inflow' | 'outflow') {
  const coin = pick(sequence + 8);
  const exchange = sequence % 2 === 0 ? 'Binance' : 'Coinbase';
  const icon = direction === 'inflow' ? '🔄🔴' : '🔄🟢';
  const hash = mockTxHash(sequence);
  const amount = 1_250_000 + sequence * 71_000;

  return {
    endpointName: 'main',
    raw: {
      ...baseRaw(sequence, 'cex_alerts', 'flows_alert', [
        `${icon} CEX OnChain Alert\n\n#${coin} ${exchange} : $${amount} ${direction === 'inflow' ? 'Inflow' : 'Outflow'} <a href="https://etherscan.io/tx/${hash}">HashTx</a> #InflowOutflow`
      ], []),
      coins: [coin]
    }
  } as const;
}

function cexTrack(sequence: number, action: 'buy' | 'sell' | 'activity') {
  const coin = pick(sequence + 9);
  const exchange = action === 'activity'
    ? { label: 'Binance Futures', href: `https://www.binance.com/en/futures/${coin}USDT` }
    : action === 'buy'
      ? { label: 'Bitget', href: `https://www.bitget.com/spot/${coin}USDT` }
      : { label: 'Bybit Futures', href: `https://www.bybit.com/trade/usdt/${coin}USDT` };
  const verb = action === 'buy' ? 'buying' : action === 'sell' ? 'selling' : 'activity';
  const emoji = action === 'buy' ? '🔫' : action === 'sell' ? '🧨' : '🤔';
  const amount = `${(0.12 + sequence * 0.03).toFixed(2)}M`;
  const price = (0.015 + sequence * 0.0027).toFixed(4);
  const priceChange = signedPercent(1.1 + (sequence % 6) * 0.57, sequence % 5 !== 0);
  const volume24h = `${(1.8 + sequence * 0.22).toFixed(2)}M`;
  const share = (8 + (sequence % 7) * 3).toFixed(0);
  const lastSeen = `${1 + (sequence % 9)} h ago`;
  const duration = sequence % 3 === 0 ? '15 min' : sequence % 2 === 0 ? '8 min' : '42 sec';

  return {
    endpointName: 'main',
    raw: {
      ...baseRaw(sequence, 'cex_alerts', 'cex_track', [
        `🎰 #${coin} ${verb} ${emoji} ${amount} USDT in ${duration} (${share}%) on <a href="${exchange.href}">${exchange.label}</a>%0AP: ${price} ${priceChange.startsWith('-') ? '⬇️' : '⬆️'} (${priceChange}%)%0AVol 24h: ${volume24h} USDT%0ALast ${lastSeen} #CEXTrack`
      ], [exchange.label.replace(/\s+/g, '_')]),
      coins: [coin]
    }
  } as const;
}

function fundingSnapshot(sequence: number, direction: 'highest' | 'lowest', interval: '30_min' | '4_h') {
  const text = `${direction === 'highest' ? '📊🌡 Highest Funding Rate #FundingRate #HighestFunding' : '📊🧪 Lowest Funding Rate #FundingRate #LowestFunding'}${interval === '4_h' ? ' #tw4%' : ''}\n\n${coins
    .slice(0, 10)
    .map((coin, index) => {
      const exchange = ['Binance', 'Bybit', 'Coinbase', 'Hyperliquid', 'Gate'][index % 5] ?? 'Binance';
      const base = 0.28 + index * 0.11 + (sequence % 3) * 0.04;
      const signed = direction === 'highest' ? base : -base;
      return `#${coin} ${exchange} : ${signed.toFixed(2).replace('.', ',')}%`;
    })
    .join('\n')}`;

  return {
    endpointName: 'main',
    raw: {
      ...baseRaw(sequence, 'market_data', 'top_funding', [text], [direction, interval]),
      coins: coins.slice(0, 10)
    }
  } as const;
}

function etfSnapshot(sequence: number) {
  const text = `ETF crypto flow #BTC spot ETF inflow $${(25 + sequence).toFixed(1)}M +${(0.5 + sequence % 4).toFixed(1)}%`;

  return {
    endpointName: 'main',
    raw: {
      ...baseRaw(sequence, 'market_data', 'etf_crypto', [text], ['etf_crypto']),
      coins: ['BTC']
    }
  } as const;
}

function onchainSnapshot(sequence: number, category: '24_all_flows' | '1_all_flows', direction: 'inflow' | 'outflow') {
  const windowLabel = category === '24_all_flows' ? '24 hours' : '1 hour';
  const hashTag = category === '24_all_flows' ? '#CEXFlows24' : '#CEXFlows1';
  const intervalFilter = category === '24_all_flows' ? '30_min' : '60_min';
  const header = `📊${direction === 'inflow' ? '🔴' : '🟢'} CEX ${direction === 'inflow' ? 'Inflows' : 'Outflows'} in the past ${windowLabel} ${hashTag}`;
  const rows = coins
    .slice(0, 10)
    .map((coin, index) => `#${coin} : $${Math.round((direction === 'inflow' ? 420_000 : 610_000) + sequence * 32_500 + index * 87_500)}`)
    .join('\n');

  return {
    endpointName: 'main',
    raw: {
      ...baseRaw(sequence, 'onchain', category, [`${header}\n\n${rows}`], [intervalFilter, direction === 'inflow' ? 'inflows' : 'outflows']),
      coins: coins.slice(0, 10)
    }
  } as const;
}

function signedPercent(value: number, positive: boolean): string {
  const amount = value.toFixed(2).replace(/\.00$/, '');
  return `${positive ? '+' : '-'}${amount}`;
}

function mockTxHash(sequence: number): string {
  return `0x${sequence.toString(16).padStart(64, '0')}`;
}

function topRows(title: string, amountBase: number, direction: 'buy' | 'sell'): string {
  const rows = coins
    .slice(0, 10)
    .map((coin, index) => {
      const buy = amountBase + index * 0.55;
      const sell = amountBase * 0.64 + index * 0.33;
      const amount = direction === 'buy' ? buy : sell;
      return `${index + 1}. ${coin}USDT ${direction} $${amount.toFixed(2)}M buy: $${buy.toFixed(2)}M sell: $${sell.toFixed(2)}M +${(1.2 + index * 0.3).toFixed(1)}%`;
    })
    .join('\n');
  return `${title}\n${rows}`;
}

function pick(sequence: number): string {
  return coins[sequence % coins.length] ?? 'BTC';
}
