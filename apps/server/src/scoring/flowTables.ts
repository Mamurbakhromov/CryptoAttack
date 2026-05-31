export type FlowFamily = 'spot' | 'derivatives' | 'topOi' | 'bigActivity';
export type FlowDirectionSide = 'bull' | 'bear';

export interface RangePoints {
  min?: number;
  max?: number;
  points: number;
}

export const FLOW_COMPONENT_MAX = {
  spot: 41,
  derivatives: 29,
  topOi: 12,
  bigActivity: 18
} as const;

export const FLOW_RAW_MAX =
  FLOW_COMPONENT_MAX.spot +
  FLOW_COMPONENT_MAX.derivatives +
  FLOW_COMPONENT_MAX.topOi +
  FLOW_COMPONENT_MAX.bigActivity;

export const spotDominanceTable: RangePoints[] = [
  { max: 1.1, points: 0 },
  { min: 1.1, max: 1.2, points: 2.1 },
  { min: 1.2, max: 1.35, points: 4.2 },
  { min: 1.35, max: 1.5, points: 6.3 },
  { min: 1.5, max: 1.75, points: 8.4 },
  { min: 1.75, max: 2, points: 10.5 },
  { min: 2, max: 2.5, points: 13.65 },
  { min: 2.5, max: 3, points: 15.75 },
  { min: 3, max: 4, points: 17.85 },
  { min: 4, max: 6, points: 19.43 },
  { min: 6, max: 10, points: 20.48 },
  { min: 10, points: 21 }
];

export const spotRelativeImpactTable: RangePoints[] = [
  { max: 0.05, points: 0 },
  { min: 0.05, max: 0.1, points: 1.03 },
  { min: 0.1, max: 0.25, points: 2.06 },
  { min: 0.25, max: 0.5, points: 3.54 },
  { min: 0.5, max: 1, points: 5.03 },
  { min: 1, max: 2, points: 6.51 },
  { min: 2, max: 4, points: 7.54 },
  { min: 4, points: 8 }
];

export const spotDeltaTable: RangePoints[] = [
  { max: 25_000, points: 0 },
  { min: 25_000, max: 75_000, points: 0.58 },
  { min: 75_000, max: 200_000, points: 1.17 },
  { min: 200_000, max: 500_000, points: 2.04 },
  { min: 500_000, max: 1_500_000, points: 2.92 },
  { min: 1_500_000, points: 3.5 }
];

export const derivativesDominanceTable: RangePoints[] = [
  { max: 1.1, points: 0 },
  { min: 1.1, max: 1.25, points: 1.18 },
  { min: 1.25, max: 1.5, points: 2.95 },
  { min: 1.5, max: 2, points: 5.91 },
  { min: 2, max: 3, points: 8.27 },
  { min: 3, max: 5, points: 10.64 },
  { min: 5, max: 8, points: 11.82 },
  { min: 8, points: 13 }
];

export const derivativesRelativeImpactTable: RangePoints[] = [
  { max: 0.05, points: 0 },
  { min: 0.05, max: 0.15, points: 0.9 },
  { min: 0.15, max: 0.35, points: 1.8 },
  { min: 0.35, max: 0.75, points: 3 },
  { min: 0.75, max: 1.5, points: 4.2 },
  { min: 1.5, max: 3, points: 5.4 },
  { min: 3, points: 6 }
];

export const derivativesDeltaTable: RangePoints[] = [
  { max: 50_000, points: 0 },
  { min: 50_000, max: 200_000, points: 0.63 },
  { min: 200_000, max: 750_000, points: 1.25 },
  { min: 750_000, max: 2_000_000, points: 1.88 },
  { min: 2_000_000, points: 2.5 }
];

export const topOiPercentTable: RangePoints[] = [
  { max: 2, points: 0 },
  { min: 2, max: 5, points: 1.8 },
  { min: 5, max: 10, points: 3.6 },
  { min: 10, max: 20, points: 5.1 },
  { min: 20, points: 6 }
];

export const bigActivityAmountTable: RangePoints[] = [
  { max: 25_000, points: 0 },
  { min: 25_000, max: 75_000, points: 1.21 },
  { min: 75_000, max: 200_000, points: 3.04 },
  { min: 200_000, max: 500_000, points: 4.86 },
  { min: 500_000, max: 1_000_000, points: 6.68 },
  { min: 1_000_000, points: 8.5 }
];

export const bigActivityRelativeImpactTable: RangePoints[] = [
  { max: 0.05, points: 0 },
  { min: 0.05, max: 0.25, points: 1.25 },
  { min: 0.25, max: 0.75, points: 2.5 },
  { min: 0.75, max: 1.5, points: 3.75 },
  { min: 1.5, points: 5 }
];

export function pointsForRange(value: number | null | undefined, table: RangePoints[]): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  const row = table.find((range) => (range.min === undefined || value >= range.min) && (range.max === undefined || value < range.max));
  return row?.points ?? 0;
}

export function spotVolumeCap(volume24hUsd: number | null | undefined): number {
  if (!isPositive(volume24hUsd)) return 7;
  if (volume24hUsd < 100_000) return 7;
  if (volume24hUsd < 500_000) return 14;
  if (volume24hUsd < 2_000_000) return 26;
  return FLOW_COMPONENT_MAX.spot;
}

export function spotActivityCap(activityUsd: number | null | undefined): number {
  if (!isPositive(activityUsd)) return 6;
  if (activityUsd < 10_000) return 6;
  if (activityUsd < 50_000) return 14;
  if (activityUsd < 200_000) return 28;
  return FLOW_COMPONENT_MAX.spot;
}

export function derivativesVolumeCap(volume24hUsd: number | null | undefined): number {
  if (!isPositive(volume24hUsd)) return 6;
  if (volume24hUsd < 250_000) return 6;
  if (volume24hUsd < 1_000_000) return 12;
  if (volume24hUsd < 5_000_000) return 21;
  return FLOW_COMPONENT_MAX.derivatives;
}

export function derivativesActivityCap(activityUsd: number | null | undefined): number {
  if (!isPositive(activityUsd)) return 6;
  if (activityUsd < 25_000) return 6;
  if (activityUsd < 100_000) return 12;
  if (activityUsd < 500_000) return 21;
  return FLOW_COMPONENT_MAX.derivatives;
}

export function bigActivityLiquidityCap(volume24hUsd: number | null | undefined): number {
  if (!isPositive(volume24hUsd)) return 3.6;
  if (volume24hUsd < 100_000) return 3.6;
  if (volume24hUsd < 500_000) return 7.2;
  if (volume24hUsd < 2_000_000) return 12;
  return FLOW_COMPONENT_MAX.bigActivity;
}

export function rankPoints(rank: number | null | undefined, maxPoints: number): number {
  if (typeof rank !== 'number' || !Number.isInteger(rank) || rank < 1 || rank > 10) return 0;
  return ((11 - rank) / 10) * maxPoints;
}

export function repeatHitPoints(effectiveHits: number, maxPoints: 6 | 5 | 3.5): number {
  if (maxPoints === 3.5) {
    if (effectiveHits >= 4) return 3.5;
    if (effectiveHits === 3) return 2.33;
    if (effectiveHits === 2) return 1.17;
    return 0;
  }

  if (maxPoints === 6) {
    if (effectiveHits >= 5) return 6;
    if (effectiveHits === 4) return 4.8;
    if (effectiveHits === 3) return 3.6;
    if (effectiveHits === 2) return 1.8;
    return 0;
  }

  if (effectiveHits >= 5) return 5;
  if (effectiveHits === 4) return 4;
  if (effectiveHits === 3) return 3;
  if (effectiveHits === 2) return 1.5;
  return 0;
}

export function relativeImpactPercent(amountUsd: number | null | undefined, volume24hUsd: number | null | undefined): number | null {
  if (!isPositive(amountUsd) || !isPositive(volume24hUsd)) return null;
  return (Math.abs(amountUsd) / volume24hUsd) * 100;
}

function isPositive(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
