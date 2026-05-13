import type { CoinClassificationFilter } from '../coinClassification';
import type { DashboardSnapshot, FeedKey, NormalizedEvent } from '../types';
import type { ExchangeAvailabilityByMarket } from './ExchangeChips';
import type { PerformanceTrendByCoin } from './PerformanceTrendChips';
import { TopTable } from './TopTable';

interface AmountsPageProps {
  snapshot: DashboardSnapshot;
  highlightedIds: Set<string>;
  exchangeAvailability: ExchangeAvailabilityByMarket;
  classificationFilter: CoinClassificationFilter;
  performanceTrends: PerformanceTrendByCoin;
  mode: AmountsPageMode;
}

type AmountsPageMode = 'bull' | 'sell';

export function AmountsPage({ snapshot, highlightedIds, exchangeAvailability, classificationFilter, performanceTrends, mode }: AmountsPageProps) {
  const spotBuyEvents = filterDirectionalEvents(snapshot, 'all_spot_per', 'buy');
  const derivativesBuyEvents = filterDirectionalEvents(snapshot, 'all_derivatives_per', 'buy');
  const spotSellEvents = filterDirectionalEvents(snapshot, 'all_spot_per', 'sell');
  const derivativesSellEvents = filterDirectionalEvents(snapshot, 'all_derivatives_per', 'sell');
  const spotBuy = spotBuyEvents[0] ?? null;
  const derivativesBuy = derivativesBuyEvents[0] ?? null;
  const spotSell = spotSellEvents[0] ?? null;
  const derivativesSell = derivativesSellEvents[0] ?? null;
  const page = getAmountsPageConfig(mode);

  return (
    <main className="mx-auto grid max-w-[1800px] gap-3 px-4 py-3 md:px-6">
      <section className={`page-hero ${page.heroClass}`}>
        <h1>{page.heroTitle}</h1>
        <span>{page.heroSubtitle}</span>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <TopTable
          title={page.spotTitle}
          subtitle={page.spotSubtitle}
          event={page.spotEvent === 'buy' ? spotBuy : spotSell}
          historyEvents={page.spotEvent === 'buy' ? spotBuyEvents : spotSellEvents}
          market="spot"
          exchangeAvailability={exchangeAvailability}
          classificationFilter={classificationFilter}
          performanceTrends={performanceTrends}
          highlighted={isHighlighted(page.spotEvent === 'buy' ? spotBuy : spotSell, highlightedIds)}
        />
        <TopTable
          title={page.derivativesTitle}
          subtitle={page.derivativesSubtitle}
          event={page.derivativesEvent === 'buy' ? derivativesBuy : derivativesSell}
          historyEvents={page.derivativesEvent === 'buy' ? derivativesBuyEvents : derivativesSellEvents}
          market="perpetual"
          exchangeAvailability={exchangeAvailability}
          classificationFilter={classificationFilter}
          performanceTrends={performanceTrends}
          highlighted={isHighlighted(page.derivativesEvent === 'buy' ? derivativesBuy : derivativesSell, highlightedIds)}
        />
      </section>
    </main>
  );
}

function getAmountsPageConfig(mode: AmountsPageMode): {
  heroClass: 'bull' | 'bear';
  heroTitle: string;
  heroSubtitle: string;
  spotTitle: string;
  spotSubtitle: string;
  spotEvent: 'buy' | 'sell';
  derivativesTitle: string;
  derivativesSubtitle: string;
  derivativesEvent: 'buy' | 'sell';
} {
  if (mode === 'bull') {
    return {
      heroClass: 'bull',
      heroTitle: 'Amounts Bull',
      heroSubtitle: 'Buying pressure from spot and derivatives percent feeds',
      spotTitle: 'Top 10 Spot Buying Percent',
      spotSubtitle: 'cex_alerts/all_spot_per, classified buy + 5m',
      spotEvent: 'buy',
      derivativesTitle: 'Top 10 Derivatives Buying Percent',
      derivativesSubtitle: 'cex_alerts/all_derivatives_per, classified buy + 5m',
      derivativesEvent: 'buy'
    };
  }

  return {
    heroClass: 'bear',
    heroTitle: 'Amounts Sell',
    heroSubtitle: 'Selling pressure from spot and derivatives percent feeds',
    spotTitle: 'Top 10 Spot Selling Percent',
    spotSubtitle: 'cex_alerts/all_spot_per, classified sell + 5m',
    spotEvent: 'sell',
    derivativesTitle: 'Top 10 Derivatives Selling Percent',
    derivativesSubtitle: 'cex_alerts/all_derivatives_per, classified sell + 5m',
    derivativesEvent: 'sell'
  };
}

function filterDirectionalEvents(snapshot: DashboardSnapshot, feedKey: FeedKey, direction: 'buy' | 'sell'): NormalizedEvent[] {
  return snapshot.feeds[feedKey].events.filter((event) => getEventDirection(event) === direction);
}

function getEventDirection(event: NormalizedEvent): 'buy' | 'sell' | null {
  const entryDirection = event.entries.find((entry) => entry.direction === 'buy' || entry.direction === 'sell')?.direction;
  if (entryDirection === 'buy' || entryDirection === 'sell') return entryDirection;
  const filters = event.filters.join(' ');
  if (/\bbuy\b/i.test(filters) || /\bbuying\b/i.test(event.plainText)) return 'buy';
  if (/\bsell\b/i.test(filters) || /\bselling\b/i.test(event.plainText)) return 'sell';
  return null;
}

function isHighlighted(event: NormalizedEvent | null, highlightedIds: Set<string>): boolean {
  return event === null ? false : highlightedIds.has(event.id);
}
