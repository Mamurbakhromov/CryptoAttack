import { useState } from 'react';

import type { CoinClassificationFilter } from '../coinClassification';
import type { DashboardSnapshot, NormalizedEvent } from '../types';
import { EventTimeline } from './EventTimeline';
import type { ExchangeAvailabilityByMarket } from './ExchangeChips';
import { OiTopTable } from './OiTopTable';
import type { PerformanceTrendByCoin } from './PerformanceTrendChips';
import { TopTable } from './TopTable';

interface DashboardProps {
  snapshot: DashboardSnapshot;
  highlightedIds: Set<string>;
  page: 'bull' | 'bear';
  exchangeAvailability: ExchangeAvailabilityByMarket;
  classificationFilter: CoinClassificationFilter;
  performanceTrends: PerformanceTrendByCoin;
}

export function Dashboard({ snapshot, highlightedIds, page, exchangeAvailability, classificationFilter, performanceTrends }: DashboardProps) {
  const [hoveredCoin, setHoveredCoin] = useState<string | null>(null);
  const latest = (feedKey: keyof DashboardSnapshot['feeds']): NormalizedEvent | null => snapshot.feeds[feedKey].latest;
  const spotBuyTop = latest('all_spot_top_buy_5m');
  const derivativesBuyTop = latest('all_derivatives_top_buy_5m');
  const spotSellTop = latest('all_spot_top_sell_5m');
  const derivativesSellTop = latest('all_derivatives_top_sell_5m');
  const oiGainers = latest('top_oi_gainers_60m');
  const oiLosers = latest('top_oi_losers_60m');

  if (page === 'bull') {
    return (
      <main className="mx-auto grid max-w-[1800px] gap-3 px-4 py-3 md:px-6">
        <PageHeader title="Top Spot" subtitle="Spot and derivatives buyer/seller pressure" tone="bull" />
        <section className="grid gap-4 xl:grid-cols-2">
          <TopTable
            title="Top 10 Spot Buyers 5m"
            subtitle="cex_alerts/all_spot_top, classified buy + 5m"
            event={spotBuyTop}
            historyEvents={snapshot.feeds.all_spot_top_buy_5m.events}
            comparisonHistoryEvents={snapshot.feeds.all_spot_top_sell_5m.events}
            market="spot"
            exchangeAvailability={exchangeAvailability}
            classificationFilter={classificationFilter}
            performanceTrends={performanceTrends}
            hoveredCoin={hoveredCoin}
            onCoinHover={setHoveredCoin}
            highlighted={isHighlighted(spotBuyTop, highlightedIds)}
          />
          <TopTable
            title="Top 10 Derivatives Buyers 5m"
            subtitle="cex_alerts/all_derivatives_top, classified buy + 5m"
            event={derivativesBuyTop}
            historyEvents={snapshot.feeds.all_derivatives_top_buy_5m.events}
            comparisonHistoryEvents={snapshot.feeds.all_derivatives_top_sell_5m.events}
            market="perpetual"
            exchangeAvailability={exchangeAvailability}
            classificationFilter={classificationFilter}
            performanceTrends={performanceTrends}
            hoveredCoin={hoveredCoin}
            onCoinHover={setHoveredCoin}
            highlighted={isHighlighted(derivativesBuyTop, highlightedIds)}
          />
          <TopTable
            title="Top 10 Spot Sellers 5m"
            subtitle="cex_alerts/all_spot_top, classified sell + 5m"
            event={spotSellTop}
            historyEvents={snapshot.feeds.all_spot_top_sell_5m.events}
            comparisonHistoryEvents={snapshot.feeds.all_spot_top_buy_5m.events}
            market="spot"
            exchangeAvailability={exchangeAvailability}
            classificationFilter={classificationFilter}
            performanceTrends={performanceTrends}
            hoveredCoin={hoveredCoin}
            onCoinHover={setHoveredCoin}
            highlighted={isHighlighted(spotSellTop, highlightedIds)}
          />
          <TopTable
            title="Top 10 Derivatives Sellers 5m"
            subtitle="cex_alerts/all_derivatives_top, classified sell + 5m"
            event={derivativesSellTop}
            historyEvents={snapshot.feeds.all_derivatives_top_sell_5m.events}
            comparisonHistoryEvents={snapshot.feeds.all_derivatives_top_buy_5m.events}
            market="perpetual"
            exchangeAvailability={exchangeAvailability}
            classificationFilter={classificationFilter}
            performanceTrends={performanceTrends}
            hoveredCoin={hoveredCoin}
            onCoinHover={setHoveredCoin}
            highlighted={isHighlighted(derivativesSellTop, highlightedIds)}
          />
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto grid max-w-[1800px] gap-3 px-4 py-3 md:px-6">
      <PageHeader title="OI and Listings" subtitle="Open-interest shifts, listings, and delistings" tone="bear" />
      <section className="grid gap-4 xl:grid-cols-2">
        <OiTopTable
          title="Top 10 OI Gainers 60m"
          subtitle="market_data/top_oi, classified gainers + 60m"
          event={oiGainers}
          historyEvents={snapshot.feeds.top_oi_gainers_60m.events}
          exchangeAvailability={exchangeAvailability}
          classificationFilter={classificationFilter}
          performanceTrends={performanceTrends}
          hoveredCoin={hoveredCoin}
          onCoinHover={setHoveredCoin}
          highlighted={isHighlighted(oiGainers, highlightedIds)}
        />
        <EventTimeline
          title="Listings"
          subtitle="wss2 cex_alerts/listings"
          events={snapshot.feeds.listings.events}
          maxVisible={12}
          highlightedIds={highlightedIds}
        />
        <OiTopTable
          title="Top 10 OI Losers 60m"
          subtitle="market_data/top_oi, classified losers + 60m"
          event={oiLosers}
          historyEvents={snapshot.feeds.top_oi_losers_60m.events}
          exchangeAvailability={exchangeAvailability}
          classificationFilter={classificationFilter}
          performanceTrends={performanceTrends}
          hoveredCoin={hoveredCoin}
          onCoinHover={setHoveredCoin}
          highlighted={isHighlighted(oiLosers, highlightedIds)}
        />
        <EventTimeline
          title="Delistings"
          subtitle="wss2 cex_alerts/delistings, needs provider confirmation"
          events={snapshot.feeds.delistings.events}
          maxVisible={12}
          highlightedIds={highlightedIds}
        />
      </section>
    </main>
  );
}

function PageHeader({ title, subtitle, tone }: { title: string; subtitle: string; tone: 'bull' | 'bear' }) {
  return (
    <section className={`page-hero ${tone}`}>
      <h1>{title}</h1>
      <span>{subtitle}</span>
    </section>
  );
}

function isHighlighted(event: NormalizedEvent | null, highlightedIds: Set<string>): boolean {
  return event === null ? false : highlightedIds.has(event.id);
}
