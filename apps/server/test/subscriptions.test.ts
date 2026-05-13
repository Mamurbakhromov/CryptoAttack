import { describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config.js';
import { getSubscriptions } from '../src/cryptoattack/subscriptions.js';

describe('getSubscriptions', () => {
  it('includes documented signals oi_alerts on the main endpoint', () => {
    const subscriptions = getSubscriptions(loadConfig({}));
    const oiAlerts = subscriptions.main.find((subscription) => subscription.chapter === 'signals' && subscription.category === 'oi_alerts');

    expect(oiAlerts).toMatchObject({
      endpoint: 'main',
      chapter: 'signals',
      category: 'oi_alerts',
      feedKeys: ['oi_alerts'],
      needsConfirmation: false
    });
  });

  it('includes amount, signal, flow, and market-data subscriptions', () => {
    const subscriptions = getSubscriptions(loadConfig({}));
    const expected = [
      ['cex_alerts', 'all_spot_per', ['all_spot_per']],
      ['cex_alerts', 'all_derivatives_per', ['all_derivatives_per']],
      ['cex_alerts', 'flows_alert', ['flows_alert']],
      ['cex_alerts', 'cex_track', ['cex_track']],
      ['signals', 'pricealerts', ['pricealerts']],
      ['signals', 'volalerts', ['volalerts']],
      ['market_data', 'top_funding', ['top_funding']],
      ['market_data', 'etf_crypto', ['etf_crypto']],
      ['onchain', '24_all_flows', ['onchain_24_all_flows']],
      ['onchain', '1_all_flows', ['onchain_1_all_flows']]
    ] as const;

    for (const [chapter, category, feedKeys] of expected) {
      expect(subscriptions.main.find((subscription) => subscription.chapter === chapter && subscription.category === category)).toMatchObject({
        endpoint: 'main',
        chapter,
        category,
        feedKeys,
        needsConfirmation: false
      });
    }

    expect(subscriptions.main.some((subscription) => subscription.chapter === 'market_data' && subscription.category === 'arbitrage_funding')).toBe(false);
    expect(subscriptions.main.some((subscription) => subscription.chapter === 'signals' && subscription.category === 'pricealerts2')).toBe(false);
    expect(subscriptions.main.some((subscription) => subscription.chapter === 'signals' && subscription.category === 'price_alerts')).toBe(false);
    expect(subscriptions.main.some((subscription) => subscription.chapter === 'signals' && subscription.category === 'volalerts2')).toBe(false);
    expect(subscriptions.main.some((subscription) => subscription.chapter === 'signals' && subscription.category === 'liquidation')).toBe(false);
  });
});
