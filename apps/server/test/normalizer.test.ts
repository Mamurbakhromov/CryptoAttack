import { describe, expect, it } from 'vitest';

import { normalizeCryptoAttackEvent } from '../src/events/normalizer.js';

const receivedAtMs = Date.parse('2026-01-01T00:00:01.000Z');

describe('normalizeCryptoAttackEvent', () => {
  it('routes listings', () => {
    const events = normalizeCryptoAttackEvent({
      ...raw('cex_alerts', 'listings', 'Binance lists BTCUSDT', ['Listing']),
      coins: ['btc', 'Eth']
    }, {
      receivedAtMs,
      endpointName: 'fast'
    });

    expect(events).toHaveLength(1);
    expect(events[0]?.feedKey).toBe('listings');
    expect(events[0]?.endpoint).toBe('fast');
    expect(events[0]?.coins).toEqual(['BTC', 'ETH']);
    expect(events[0]?.filters).toEqual(['listing']);
  });

  it('routes delistings and keeps the category implemented', () => {
    const events = normalizeCryptoAttackEvent(raw('cex_alerts', 'delistings', 'OKX will delist OLDUSDT', ['delisting']), {
      receivedAtMs,
      endpointName: 'fast',
      enableDelistings: true
    });

    expect(events[0]?.feedKey).toBe('delistings');
  });

  it('routes all_spot_top buy 5m', () => {
    const events = normalizeCryptoAttackEvent(
      raw('cex_alerts', 'all_spot_top', 'Top buying coins on spot 5m\n1. BTCUSDT buy $1.5M +2%\n2. ETHUSDT buy $500K +1%', ['buy', '5m']),
      { receivedAtMs, endpointName: 'main' }
    );

    expect(events.map((event) => event.feedKey)).toEqual(['all_spot_top_buy_5m']);
    expect(events[0]?.entries).toHaveLength(2);
    expect(events[0]?.amountMetric).toBeNull();
  });

  it('routes all_derivatives_top buy 5m', () => {
    const events = normalizeCryptoAttackEvent(
      raw('cex_alerts', 'all_derivatives_top', 'Top buying coins in all derivatives 5 min\n1. SOLUSDT buy $2M +5%', ['buy', '5 min']),
      { receivedAtMs, endpointName: 'main' }
    );

    expect(events.map((event) => event.feedKey)).toEqual(['all_derivatives_top_buy_5m']);
    expect(events[0]?.parserStatus).toBe('parsed');
  });

  it('routes all_derivatives_top buy 5m when provider filters are clear even if rows include sell columns', () => {
    const events = normalizeCryptoAttackEvent(
      raw(
        'cex_alerts',
        'all_derivatives_top',
        '📊🔫 Top 10 Buying coins on all derivatives in the last 5 minutes (amount) #TopCEXad%0A#BTC buy: $26251549 sell: $19628254%0Adelta: $6623295 (0,026%, Vol24: 26B)%0A#ETH buy: $3331449 sell: $2277471%0Adelta: $1053978',
        ['5_min', 'buy']
      ),
      { receivedAtMs, endpointName: 'main' }
    );

    expect(events.map((event) => event.feedKey)).toEqual(['all_derivatives_top_buy_5m']);
    expect(events[0]?.plainText).not.toContain('%0A');
    expect(events[0]?.entries.map((entry) => entry.coin)).toEqual(['BTC', 'ETH']);
    expect(events[0]?.entries[0]?.amountUsd).toBe(26_251_549);
  });

  it('routes top_oi gainers 60m and losers 60m only', () => {
    const gainers = normalizeCryptoAttackEvent(raw('market_data', 'top_oi', 'Top 10 OI Gainers (1h)\n#XRP Binance OI Change (1h): 8%', ['gainers', '60_min']), {
      receivedAtMs,
      endpointName: 'main'
    });
    const losers = normalizeCryptoAttackEvent(raw('market_data', 'top_oi', 'Top 10 OI Losers (1h)\n#ETH Binance OI Change (1h): -8%', ['losers', '60_min']), {
      receivedAtMs,
      endpointName: 'main'
    });
    const thirtyMinute = normalizeCryptoAttackEvent(raw('market_data', 'top_oi', 'Top 10 OI Gainers (30m)\n#SOL Binance OI Change (30m): 8%', ['gainers', '30_min']), {
      receivedAtMs,
      endpointName: 'main'
    });

    expect(gainers[0]?.feedKey).toBe('top_oi_gainers_60m');
    expect(losers[0]?.feedKey).toBe('top_oi_losers_60m');
    expect(thirtyMinute[0]?.feedKey).toBe('raw_unclassified');
  });

  it('routes top_oi 1h events when provider filters say 30_min', () => {
    const events = normalizeCryptoAttackEvent(
      raw(
        'market_data',
        'top_oi',
        '📈📊 Top 10 OI Gainers (1h) #OpenInterest #TopGainers\n\n#UB OKX OI Change (1h): 82.36% Price: 0.0560 (3.02%)',
        ['gainers', '30_min']
      ),
      { receivedAtMs, endpointName: 'main' }
    );

    expect(events[0]?.feedKey).toBe('top_oi_gainers_60m');
    expect(events[0]?.entries[0]?.coin).toBe('UB');
    expect(events[0]?.entries[0]?.exchange).toBe('OKX');
  });

  it('routes signals oi_alerts into the dedicated signals feed', () => {
    const events = normalizeCryptoAttackEvent(
      raw('signals', 'oi_alerts', '#HEMI OI alert on Binance Futures: +14.2% in 10m. Price: 0.00783 (1.69%)', ['oi_alerts', 'open_interest']),
      { receivedAtMs, endpointName: 'main' }
    );

    expect(events[0]?.feedKey).toBe('oi_alerts');
    expect(events[0]?.title).toContain('#HEMI OI alert');
    expect(events[0]?.parserStatus).toBe('parsed');
    expect(events[0]?.entries[0]).toMatchObject({ coin: 'HEMI', exchange: 'BINANCE', percent: 14.2 });
    expect(events[0]?.raw).toMatchObject({ chapter: 'signals', category: 'oi_alerts' });
  });

  it('routes amount categories and builds amount metrics', () => {
    const spot = normalizeCryptoAttackEvent(
      raw(
        'cex_alerts',
        'all_spot_per',
        'All spot amount buying\nTotal amount: $12.5M\n#BTC buy: $7000000 sell: $1000000 +2.4%\n#ETH buy: $5500000 sell: $2000000 +1.4%',
        ['amount', 'spot']
      ),
      { receivedAtMs, endpointName: 'main' }
    );
    const derivatives = normalizeCryptoAttackEvent(
      raw(
        'cex_alerts',
        'all_derivatives_per',
        'All derivatives amount buying\nTotal amount: $22.1M\n#SOL buy: $14100000 sell: $7000000 +5.1%\n#BTC buy: $8000000 sell: $6000000 +1.1%',
        ['amount', 'derivatives']
      ),
      { receivedAtMs, endpointName: 'main' }
    );

    expect(spot[0]?.feedKey).toBe('all_spot_per');
    expect(spot[0]?.parserStatus).toBe('parsed');
    expect(spot[0]?.amountMetric).toMatchObject({ status: 'ok', totalUsd: 12_500_000, sourceFeedKey: 'all_spot_per' });
    expect(derivatives[0]?.feedKey).toBe('all_derivatives_per');
    expect(derivatives[0]?.parserStatus).toBe('parsed');
    expect(derivatives[0]?.amountMetric).toMatchObject({ status: 'ok', totalUsd: 22_100_000, sourceFeedKey: 'all_derivatives_per' });
  });

  it('routes high-value signals, flow feeds, and market-data feeds', () => {
    const flowEvents = normalizeCryptoAttackEvent(
      raw('cex_alerts', 'flows_alert', '🔄🟢 CEX OnChain Alert\n\n#COMP Binance : $1996616 Outflow <a href="https://etherscan.io/tx/0x123">HashTx</a> #InflowOutflow', []),
      { receivedAtMs, endpointName: 'main' }
    );
    expect(flowEvents[0]?.feedKey).toBe('flows_alert');
    expect(flowEvents[0]?.parserStatus).toBe('parsed');
    expect(flowEvents[0]?.entries[0]).toMatchObject({
      coin: 'COMP',
      exchange: 'Binance',
      direction: 'outflow',
      amountUsd: 1_996_616,
      href: 'https://etherscan.io/tx/0x123'
    });

    const cexTrackEvents = normalizeCryptoAttackEvent(
      raw('cex_alerts', 'cex_track', '🎰 #USDE selling 🧨 126K USDT in 15 sec (38%) on <a href="https://www.binance.com/en/trade/USDE_USDT">Binance</a>%0AP: 0,9993 🔁 (0%)%0AVol 24h: 453K USDT%0ALast 1 d ago #CEXTrack', ['Binance']),
      { receivedAtMs, endpointName: 'main' }
    );
    expect(cexTrackEvents[0]?.feedKey).toBe('cex_track');
    expect(cexTrackEvents[0]?.parserStatus).toBe('parsed');
    expect(cexTrackEvents[0]?.entries[0]).toMatchObject({
      coin: 'USDE',
      exchange: 'Binance',
      direction: 'sell',
      amountUsd: 126_000,
      amountAsset: 'USDT',
      percent: 38,
      priceUsd: 0.9993,
      volume24hUsd: 453_000,
      volume24hAsset: 'USDT',
      lastSeen: '1 d ago',
      href: 'https://www.binance.com/en/trade/USDE_USDT'
    });

    const fundingEvents = normalizeCryptoAttackEvent(
      raw('market_data', 'top_funding', '📊🌡 Highest Funding Rate #FundingRate #HighestFunding\n\n#BARD Coinbase : 1,07%\n#ZEREBRO Hyperliquid : 0,92%', ['highest', '30_min']),
      { receivedAtMs, endpointName: 'main' }
    );
    expect(fundingEvents[0]?.feedKey).toBe('top_funding');
    expect(fundingEvents[0]?.parserStatus).toBe('parsed');
    expect(fundingEvents[0]?.entries[0]).toMatchObject({ coin: 'BARD', exchange: 'Coinbase', percent: 1.07, interval: '30_min' });

    const etfEvents = normalizeCryptoAttackEvent(
      raw('market_data', 'etf_crypto', 'ETF crypto flow #BTC spot ETF inflow $25.0M +1.5%', ['etf_crypto']),
      { receivedAtMs, endpointName: 'main' }
    );
    expect(etfEvents[0]?.feedKey).toBe('etf_crypto');
    expect(etfEvents[0]?.parserStatus).toBe('parsed');
    expect(etfEvents[0]?.coins).toContain('BTC');

    const priceAlert = normalizeCryptoAttackEvent(
      raw('signals', 'pricealerts', '🔋🔊 #BTC $43000 <b>+2,4% (1 min)</b> Vol 24h: $1,2M (120K) <a href="https://www.binance.com/en/futures/BTCUSDT">Binance Futures</a> #PriceAlerts', ['binance_fut', '1_min', 'change2']),
      { receivedAtMs, endpointName: 'main' }
    );
    expect(priceAlert[0]?.feedKey).toBe('pricealerts');
    expect(priceAlert[0]?.entries[0]).toMatchObject({ coin: 'BTC', percent: 2.4, threshold: 'change2', interval: '1m' });

    const volumeAlert = normalizeCryptoAttackEvent(
      raw('signals', 'volalerts', '🔋📶 #BTC $43000 +0,8% Vol 24h: $1,2M (120K) <b>+5,4% (1 min)</b> <a href="https://www.binance.com/en/trade/BTC_USDT">Binance</a> #VolAlerts', ['binance', '1_min', 'change5']),
      { receivedAtMs, endpointName: 'main' }
    );
    expect(volumeAlert[0]?.feedKey).toBe('volalerts');
    expect(volumeAlert[0]?.entries[0]).toMatchObject({ coin: 'BTC', percent: 5.4, priceChangePercent: 0.8, threshold: 'change5' });

    const onchainCases = [
      ['onchain', '24_all_flows', 'onchain_24_all_flows', '📊🔴 CEX Inflows in the past 24 hours #CEXFlows24\n\n#LINK : $10961180\n#PEPE : $8229231', ['30_min', 'inflows'], '24h', 'inflow'],
      ['onchain', '1_all_flows', 'onchain_1_all_flows', '📊🟢 CEX Outflows in the past 1 hour #CEXFlows1\n\n#LINK : $2551765\n#PENDLE : $238894', ['60_min', 'outflows'], '1h', 'outflow']
    ] as const;

    for (const [chapter, category, feedKey, text, filters, interval, direction] of onchainCases) {
      const events = normalizeCryptoAttackEvent(
        raw(chapter, category, text, [...filters]),
        { receivedAtMs, endpointName: 'main' }
      );

      expect(events[0]?.feedKey).toBe(feedKey);
      expect(events[0]?.parserStatus).toBe('parsed');
      expect(events[0]?.entries[0]).toMatchObject({ interval, direction });
    }

    expect(normalizeCryptoAttackEvent(
      raw('market_data', 'arbitrage_funding', 'arbitrage_funding #BTC Binance amount $1.2M', ['arbitrage_funding']),
      { receivedAtMs, endpointName: 'main' }
    )[0]?.feedKey).toBe('raw_unclassified');
  });

  it('keeps only selected price alert exchange, interval, and change filters', () => {
    const allowed = normalizeCryptoAttackEvent(
      raw('signals', 'pricealerts', '🔋🔊 #ETH $3000 +8.1% (5 min) Vol 24h: $40M Bybit Futures #PriceAlerts', ['bybit_fut', '5_min', 'change10']),
      { receivedAtMs, endpointName: 'main' }
    );
    const disallowedExchange = normalizeCryptoAttackEvent(
      raw('signals', 'pricealerts', '🔋🔊 #ETH $3000 +2.1% (1 min) Vol 24h: $40M OKX #PriceAlerts', ['okx', '1_min', 'change2']),
      { receivedAtMs, endpointName: 'main' }
    );
    const disallowedInterval = normalizeCryptoAttackEvent(
      raw('signals', 'pricealerts', '🔋🔊 #ETH $3000 +20.1% (10 min) Vol 24h: $40M Bybit #PriceAlerts', ['bybit', '10_min', 'change20']),
      { receivedAtMs, endpointName: 'main' }
    );

    expect(allowed).toHaveLength(1);
    expect(allowed[0]?.feedKey).toBe('pricealerts');
    expect(disallowedExchange).toEqual([]);
    expect(disallowedInterval).toEqual([]);
  });

  it('keeps only selected volume alert exchanges', () => {
    const allowed = normalizeCryptoAttackEvent(
      raw('signals', 'volalerts', '🔊 #SOL Bybit Futures volume alert $4.2M +5.1%', ['bybit_fut']),
      { receivedAtMs, endpointName: 'main' }
    );
    const disallowed = normalizeCryptoAttackEvent(
      raw('signals', 'volalerts', '🔊 #SOL OKX volume alert $4.2M +5.1%', ['okx']),
      { receivedAtMs, endpointName: 'main' }
    );

    expect(allowed).toHaveLength(1);
    expect(allowed[0]?.feedKey).toBe('volalerts');
    expect(disallowed).toEqual([]);
  });

  it('keeps known new feed categories visible when parser samples are needed', () => {
    const events = normalizeCryptoAttackEvent(
      raw('signals', 'volalerts', 'Provider sent a new volume alert format that needs a representative parser sample.', ['binance']),
      { receivedAtMs, endpointName: 'main' }
    );

    expect(events[0]?.feedKey).toBe('volalerts');
    expect(events[0]?.parserStatus).toBe('parser_needs_sample');
    expect(events[0]?.entries).toEqual([]);
  });

  it('parses real Open Interest Alerts blocks conservatively', () => {
    const events = normalizeCryptoAttackEvent(
      raw(
        'signals',
        'oi_alerts',
        '🍿🔊 Open Interest Alerts\n#COIN Binance\nOI Change (15m): 1.48 %\nOI Change (30m): 2.76 %\nPrice: 190.13 $\nTotal alerts: 0 #OIAlerts',
        ['oi_alerts']
      ),
      { receivedAtMs, endpointName: 'main' }
    );

    expect(events[0]?.feedKey).toBe('oi_alerts');
    expect(events[0]?.parserStatus).toBe('parsed');
    expect(events[0]?.coins).toEqual(['COIN']);
    expect(events[0]?.entries[0]).toMatchObject({
      coin: 'COIN',
      exchange: 'BINANCE',
      percent: 2.76,
      priceUsd: 190.13,
      oiChange15mPercent: 1.48,
      oiChange30mPercent: 2.76,
      totalAlerts: 0
    });
  });

  it('parses OI alert 5 minute follow-up samples without replacing receive time', () => {
    const events = normalizeCryptoAttackEvent(
      raw(
        'signals',
        'oi_alerts',
        '🔥 #D $0.013 2.17% CEX (Binance) 5 min price change after notification:\nTime UTC: 26.05.01 12:19:19\n🍿🔊 Open Interest Alerts\n#D Binance\nOI Change (15m): 1.48 %\nOI Change (30m): 2.76 %\nPrice: 0.0127 $\nTotal alerts: 0 #OIAlerts',
        ['oi_alerts']
      ),
      { receivedAtMs, endpointName: 'main' }
    );

    expect(events[0]?.feedKey).toBe('oi_alerts');
    expect(events[0]?.timestamp).toBe('2026-01-01T00:00:00.800Z');
    expect(events[0]?.receivedAt).toBe(new Date(receivedAtMs).toISOString());
    expect(events[0]?.coins).toEqual(['D']);
    expect(events[0]?.entries[0]).toMatchObject({
      coin: 'D',
      exchange: 'BINANCE',
      priceUsd: 0.013,
      priceChangePercent: 2.17,
      followupPriceChangePercent: 2.17,
      oiChange15mPercent: 1.48,
      oiChange30mPercent: 2.76,
      notifiedAt: '2026-05-01T12:19:19.000Z'
    });
  });

  it('keeps unknown signals oi_alerts payloads in the oi_alerts feed for parser tuning', () => {
    const events = normalizeCryptoAttackEvent(
      raw('signals', 'oi_alerts', 'Provider sent a new OI alert format that needs a real parser sample.', ['oi_alerts']),
      { receivedAtMs, endpointName: 'main' }
    );

    expect(events[0]?.feedKey).toBe('oi_alerts');
    expect(events[0]?.parserStatus).toBe('parser_needs_sample');
    expect(events[0]?.entries).toEqual([]);
  });

  it('preserves malformed payloads as raw_unclassified', () => {
    let events: ReturnType<typeof normalizeCryptoAttackEvent> = [];
    expect(() => {
      events = normalizeCryptoAttackEvent(false, { receivedAtMs, endpointName: 'main' });
    }).not.toThrow();

    expect(events[0]?.feedKey).toBe('raw_unclassified');
    expect(events[0]?.plainText).toContain('Malformed');
    expect(events[0]?.raw).toBe(false);
  });

  it('routes only requested 5m provider top-list headers', () => {
    const cases = [
      {
        category: 'all_derivatives_top',
        text: '📊🧨 Top 10 Selling coins on all derivatives in the last 30 minutes (amount)',
        feedKey: 'raw_unclassified'
      },
      {
        category: 'all_spot_top',
        text: '📊🧨 Top 10 Selling coins on all spot in the last 5 minutes (amount) #TopCEXas',
        feedKey: 'all_spot_top_sell_5m'
      },
      {
        category: 'all_derivatives_top',
        text: '📊🧨 Top 10 Selling coins on all derivatives in the last 30 minutes (amount) #TopCEXad',
        feedKey: 'raw_unclassified'
      },
      {
        category: 'all_derivatives_top',
        text: '📊🔫 Top 10 Buying coins on all derivatives in the last 30 minutes (amount) #TopCEXad',
        feedKey: 'raw_unclassified'
      },
      {
        category: 'all_spot_top',
        text: '📊🧨 Top 10 Selling coins on all spot in the last 30 minutes (amount) #TopCEXas',
        feedKey: 'raw_unclassified'
      },
      {
        category: 'all_spot_top',
        text: '📊🔫 Top 10 Buying coins on all spot in the last 30 minutes (amount) #TopCEXas',
        feedKey: 'raw_unclassified'
      },
      {
        category: 'all_derivatives_top',
        text: '📊🧨 Top 10 Selling coins on all derivatives in the last 5 minutes (amount)',
        feedKey: 'all_derivatives_top_sell_5m'
      }
    ] as const;

    for (const item of cases) {
      const events = normalizeCryptoAttackEvent(raw('cex_alerts', item.category, item.text, []), {
        receivedAtMs,
        endpointName: 'main'
      });

      expect(events.map((event) => event.feedKey)).toEqual([item.feedKey]);
    }
  });

  it('routes sell top events into sell widgets, not buy widgets', () => {
    const events = normalizeCryptoAttackEvent(raw('cex_alerts', 'all_spot_top', 'Top selling coins on spot 5m\n1. BTCUSDT sell $1M', ['sell', '5m']), {
      receivedAtMs,
      endpointName: 'main'
    });

    expect(events[0]?.feedKey).toBe('all_spot_top_sell_5m');
    expect(events[0]?.entries[0]?.direction).toBe('sell');
  });

  it('does not route mixed buy and sell top events into buy 5m widgets', () => {
    const events = normalizeCryptoAttackEvent(raw('cex_alerts', 'all_spot_top', 'Top buy and sell activity on spot 5m\n1. BTCUSDT buy $1M\n2. ETHUSDT sell $2M', ['buy', 'sell', '5m']), {
      receivedAtMs,
      endpointName: 'main'
    });

    expect(events[0]?.feedKey).toBe('raw_unclassified');
  });

  it('does not route top_oi without clear gainer signal', () => {
    const events = normalizeCryptoAttackEvent(raw('market_data', 'top_oi', 'Top OI update\n1. BTCUSDT OI $10M', ['oi']), {
      receivedAtMs,
      endpointName: 'main'
    });

    expect(events[0]?.feedKey).toBe('raw_unclassified');
  });

  it('creates a stable fallback id when raw id is missing', () => {
    const { id: _id, ...payload } = raw('news', 'x_source', 'Exchange update for ETH', ['news']);

    const first = normalizeCryptoAttackEvent(payload, { receivedAtMs, endpointName: 'main' });
    const second = normalizeCryptoAttackEvent(payload, { receivedAtMs: receivedAtMs + 5_000, endpointName: 'main' });

    expect(first[0]?.id).toBe(second[0]?.id);
    expect(first[0]?.id).toMatch(/^generated_/);
  });

  it('strips HTML from plainText while preserving safe links in htmlText', () => {
    const events = normalizeCryptoAttackEvent({
      chapter: 'news',
      category: 'x_source',
      texts: ['OKX <strong>update</strong> <a href="https://x.com/okx/status/1992813449965916613">Twitter</a>', false],
      coins: false,
      filters: ['OKX'],
      timestamp: '2026-01-01T00:00:00.800Z'
    }, { receivedAtMs, endpointName: 'main' });

    expect(events[0]?.feedKey).toBe('raw_unclassified');
    expect(events[0]?.plainText).toBe('OKX update Twitter');
    expect(events[0]?.htmlText).toContain('href="https://x.com/okx/status/1992813449965916613"');
    expect(events[0]?.filters).toEqual(['okx']);
  });

  it('normalizes false coins and missing filters to empty arrays', () => {
    const events = normalizeCryptoAttackEvent({
      chapter: 'news',
      category: 'x_source',
      texts: ['Plain text event'],
      coins: false,
      id: 'empty-coins-filters'
    }, { receivedAtMs, endpointName: 'main' });

    expect(events[0]?.feedKey).toBe('raw_unclassified');
    expect(events[0]?.coins).toEqual([]);
    expect(events[0]?.filters).toEqual([]);
  });
});

function raw(chapter: string, category: string, text: string, filters: string[]) {
  return {
    chapter,
    category,
    texts: [text, false],
    coins: false,
    filters,
    timestamp: '2026-01-01T00:00:00.800Z',
    time: Date.parse('2026-01-01T00:00:00.800Z'),
    id: `${chapter}_${category}_${text.length}`,
    source: 'test'
  };
}
