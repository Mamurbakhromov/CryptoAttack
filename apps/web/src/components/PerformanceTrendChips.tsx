export type PerformanceTrend = 'gainer' | 'loser';
export type PerformanceTrendByCoin = ReadonlyMap<string, ReadonlySet<PerformanceTrend>>;

interface PerformanceTrendChipsProps {
  coin: string | null | undefined;
  trends: PerformanceTrendByCoin;
}

export function PerformanceTrendChips({ coin, trends }: PerformanceTrendChipsProps) {
  const coinTrends = trends.get(normalizePerformanceCoin(coin));
  if (!coinTrends?.size) return null;

  return (
    <span className="performance-trend-chip-row" aria-label="Performance trend">
      {coinTrends.has('gainer') ? <span className="performance-trend-chip gainer" title="Daily gainer">G</span> : null}
      {coinTrends.has('loser') ? <span className="performance-trend-chip loser" title="Daily loser">L</span> : null}
    </span>
  );
}

export function normalizePerformanceCoin(coin: string | null | undefined): string {
  return (coin ?? '').trim().toUpperCase().replace(/^[#$]+/, '').replace(/[^A-Z0-9]/g, '');
}
