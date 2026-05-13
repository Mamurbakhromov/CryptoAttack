import { describe, expect, it } from 'vitest';

import { filterSnapshotByExchange } from './App';
import type { ExchangeAvailabilityByMarket } from './components/ExchangeChips';
import { makeEntry, makeEvent, makeSnapshot } from './test/builders';

describe('app exchange and market filters', () => {
  it('applies market filter to price and volume alerts only', () => {
    const exchangeAvailability = makeAvailability();
    const snapshot = makeSnapshot({
      pricealerts: [makeEvent('pricealerts', {
        entries: [
          makeEntry({ coin: 'BTC', exchange: 'Binance Spot' }),
          makeEntry({ coin: 'ETH', exchange: 'Binance Futures' })
        ]
      })],
      cex_track: [makeEvent('cex_track', {
        entries: [makeEntry({ coin: 'BTC', exchange: 'Binance', direction: 'buy' })]
      })]
    });

    const filtered = filterSnapshotByExchange(snapshot, exchangeAvailability, [], ['perpetual']);

    expect(filtered.feeds.pricealerts.events[0]?.entries.map((entry) => entry.coin)).toEqual(['ETH']);
    expect(filtered.feeds.cex_track.events[0]?.entries.map((entry) => entry.coin)).toEqual(['BTC']);
  });
});

function makeAvailability(): ExchangeAvailabilityByMarket {
  return {
    spot: new Map([['BTC', [{ exchange: 'binance', label: 'Binance', shortLabel: 'BN' }]]]),
    perpetual: new Map([['ETH', [{ exchange: 'binance', label: 'Binance', shortLabel: 'BN' }]]])
  };
}
