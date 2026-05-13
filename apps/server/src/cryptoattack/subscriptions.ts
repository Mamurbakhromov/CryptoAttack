import type { AppConfig } from '../config.js';
import type { FeedKey, SubscriptionStatus } from '../events/types.js';

export type EndpointName = 'main' | 'fast';

export interface CryptoAttackSubscription {
  endpoint: EndpointName;
  chapter: string;
  category: string;
  payload?: Record<string, unknown>;
  feedKeys: FeedKey[];
  notes: string | null;
  needsConfirmation: boolean;
}

export function getSubscriptions(config: AppConfig): Record<EndpointName, CryptoAttackSubscription[]> {
  const main = [
    createSubscription(config, 'main', 'cex_alerts', 'all_derivatives_top', [
      'all_derivatives_top_buy_5m',
      'all_derivatives_top_sell_5m'
    ]),
    createSubscription(config, 'main', 'cex_alerts', 'all_derivatives_per', ['all_derivatives_per']),
    createSubscription(config, 'main', 'cex_alerts', 'all_spot_top', [
      'all_spot_top_buy_5m',
      'all_spot_top_sell_5m'
    ]),
    createSubscription(config, 'main', 'cex_alerts', 'all_spot_per', ['all_spot_per']),
    createSubscription(config, 'main', 'cex_alerts', 'flows_alert', ['flows_alert']),
    createSubscription(config, 'main', 'cex_alerts', 'cex_track', ['cex_track']),
    createSubscription(config, 'main', 'market_data', 'top_oi', ['top_oi_gainers_60m', 'top_oi_losers_60m']),
    createSubscription(config, 'main', 'market_data', 'top_funding', ['top_funding']),
    createSubscription(config, 'main', 'market_data', 'etf_crypto', ['etf_crypto']),
    createSubscription(config, 'main', 'onchain', '24_all_flows', ['onchain_24_all_flows']),
    createSubscription(config, 'main', 'onchain', '1_all_flows', ['onchain_1_all_flows']),
    createSubscription(config, 'main', 'signals', 'oi_alerts', ['oi_alerts']),
    createSubscription(config, 'main', 'signals', 'pricealerts', ['pricealerts'], {
      notes: 'Server keeps Binance/Bybit spot+futures price alerts for 1_min/5_min and change2/change5/change10.'
    }),
    createSubscription(config, 'main', 'signals', 'volalerts', ['volalerts'], {
      notes: 'Server keeps Binance/Bybit spot+futures volume alerts.'
    })
  ];

  const fast = [createSubscription(config, 'fast', 'cex_alerts', 'listings', ['listings'])];

  if (config.enableDelistings) {
    fast.push(createSubscription(config, 'fast', 'cex_alerts', 'delistings', ['delistings']));
  }

  if (config.enableAnnouncementDelistingFallback) {
    fast.push(
      createSubscription(config, 'fast', 'cex_alerts', 'announcement', ['delistings'], {
        notes: 'Fallback disabled by default. Used only to inspect announcement delisting keywords.',
        needsConfirmation: false
      })
    );
  }

  return { main, fast };
}

export function subscriptionKey(subscription: Pick<CryptoAttackSubscription, 'chapter' | 'category'>): string {
  return `${subscription.chapter}/${subscription.category}`;
}

export function buildSubscribePayload(subscription: CryptoAttackSubscription): Record<string, unknown> {
  return {
    chapter: subscription.chapter,
    category: subscription.category,
    ...(subscription.payload ?? {})
  };
}

export function createSubscriptionStatus(subscription: CryptoAttackSubscription): SubscriptionStatus {
  return {
    key: subscriptionKey(subscription),
    chapter: subscription.chapter,
    category: subscription.category,
    state: 'pending',
    attempts: 0,
    lastAttemptAt: null,
    payloadPreview: null,
    notes: subscription.notes,
    needsConfirmation: subscription.needsConfirmation
  };
}

function createSubscription(
  config: AppConfig,
  endpointName: EndpointName,
  chapter: string,
  category: string,
  feedKeys: FeedKey[],
  options: { notes?: string; needsConfirmation?: boolean } = {}
): CryptoAttackSubscription {
  return {
    endpoint: endpointName,
    chapter,
    category,
    payload: getExtraPayload(config, chapter, category),
    feedKeys,
    notes: options.notes ?? null,
    needsConfirmation: options.needsConfirmation ?? false
  };
}

function getExtraPayload(config: AppConfig, chapter: string, category: string): Record<string, unknown> {
  const key = `${chapter}/${category}`;
  return config.subscribeExtras[key] ?? {};
}
