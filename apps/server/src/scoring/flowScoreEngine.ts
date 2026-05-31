import { createHash } from 'node:crypto';

import {
  FLOW_COMPONENT_MAX,
  FLOW_RAW_MAX,
  bigActivityAmountTable,
  bigActivityLiquidityCap,
  bigActivityRelativeImpactTable,
  derivativesActivityCap,
  derivativesDeltaTable,
  derivativesDominanceTable,
  derivativesRelativeImpactTable,
  derivativesVolumeCap,
  pointsForRange,
  rankPoints,
  relativeImpactPercent,
  repeatHitPoints,
  spotActivityCap,
  spotDeltaTable,
  spotDominanceTable,
  spotRelativeImpactTable,
  spotVolumeCap,
  topOiPercentTable,
  type FlowDirectionSide,
  type FlowFamily
} from './flowTables.js';
import type { ScoreConfig, ScoreEvidenceOutput, ScoreResult, ScoreSourceRow, ScoreWindowConfig } from './types.js';

export interface FlowScoreEngineInput {
  config: ScoreConfig;
  asOf: string;
  coins: string[];
  sourceRows: ScoreSourceRow[];
  windowsMinutes?: number[];
}

type FlowScoreState =
  | 'clean_bull'
  | 'clean_bear'
  | 'derivatives_only_bull'
  | 'derivatives_only_bear'
  | 'hedged_conflict'
  | 'mixed'
  | 'thin_liquidity'
  | 'neutral';

type TradeAction = 'LONG_WATCH' | 'SHORT_WATCH' | 'WATCH' | 'AVOID' | 'NEUTRAL';

interface ComponentScores {
  spot: SideScores;
  derivatives: SideScores;
  topOi: SideScores;
  bigActivity: SideScores;
}

interface SideScores {
  bull: number;
  bear: number;
}

interface ComponentDetail {
  family: FlowFamily;
  side: FlowDirectionSide;
  score: number;
  rawScore: number;
  maxScore: number;
  multiplier: number;
  effectiveHits: number;
  rawBeforeCap?: number;
  volumeCap?: number;
  activityCap?: number;
  liquidityCap?: number;
  hitPoints?: number;
  subpoints?: Record<string, number | null>;
  thinLiquidity: boolean;
  newestReceivedAt: string | null;
  evidence: ScoreEvidenceOutput | null;
}

interface RowBaseScore {
  row: ScoreSourceRow;
  score: number;
  decay: number;
  value: number | null;
  unit: string | null;
  subpoints: Record<string, number | null>;
}

const FLOW_FEED_KEYS = {
  spot: 'flow_spot',
  derivatives: 'flow_derivatives',
  topOi: 'flow_top_oi',
  bigActivity: 'flow_big_activity',
  risk: 'flow_risk'
} as const;

export function calculateFlowScores(input: FlowScoreEngineInput): ScoreResult[] {
  const asOfMs = Date.parse(input.asOf);
  const windows = input.config.windows.filter((window) => !input.windowsMinutes || input.windowsMinutes.includes(window.minutes));
  const rowsByCoin = groupRowsByCoin(input.sourceRows);
  const results: ScoreResult[] = [];

  for (const coin of input.coins.map((item) => item.toUpperCase())) {
    const rows = rowsByCoin.get(coin) ?? [];
    for (const window of windows) {
      results.push(scoreFlowCoinWindow({ config: input.config, asOf: input.asOf, asOfMs, coin, window, rows }));
    }
  }

  return results;
}

function scoreFlowCoinWindow(input: { config: ScoreConfig; asOf: string; asOfMs: number; coin: string; window: ScoreWindowConfig; rows: ScoreSourceRow[] }): ScoreResult {
  const freshRows = input.rows.filter((row) => isFreshRow(row, input.asOfMs, input.window.maxAgeMinutes));
  const hitRows = input.rows.filter((row) => isFreshRow(row, input.asOfMs, 60));
  const riskTags = new Set<string>();

  const spotBull = scoreTopFlowFamily({ family: 'spot', side: 'bull', rows: freshRows, hitRows, window: input.window, asOfMs: input.asOfMs, coin: input.coin, configVersion: input.config.version });
  const spotBear = scoreTopFlowFamily({ family: 'spot', side: 'bear', rows: freshRows, hitRows, window: input.window, asOfMs: input.asOfMs, coin: input.coin, configVersion: input.config.version });

  const derivativesBull = scoreTopFlowFamily({
    family: 'derivatives',
    side: 'bull',
    rows: freshRows,
    hitRows,
    window: input.window,
    asOfMs: input.asOfMs,
    coin: input.coin,
    configVersion: input.config.version,
    multiplier: derivativesMultiplier('bull', spotBull.score, spotBear.score)
  });
  const derivativesBear = scoreTopFlowFamily({
    family: 'derivatives',
    side: 'bear',
    rows: freshRows,
    hitRows,
    window: input.window,
    asOfMs: input.asOfMs,
    coin: input.coin,
    configVersion: input.config.version,
    multiplier: derivativesMultiplier('bear', spotBull.score, spotBear.score)
  });
  if (derivativesBull.rawScore > 0 && derivativesBull.multiplier === 0.3) riskTags.add('spot_derivatives_hedge');
  if (derivativesBear.rawScore > 0 && derivativesBear.multiplier === 0.3) riskTags.add('spot_derivatives_hedge');

  const topOiBull = scoreTopOiFamily({ side: 'bull', rows: freshRows, hitRows, window: input.window, asOfMs: input.asOfMs, coin: input.coin, configVersion: input.config.version, riskTags });
  const topOiBear = scoreTopOiFamily({ side: 'bear', rows: freshRows, hitRows, window: input.window, asOfMs: input.asOfMs, coin: input.coin, configVersion: input.config.version, riskTags });

  const bigBull = scoreBigActivityFamily({
    side: 'bull',
    rows: freshRows,
    hitRows,
    window: input.window,
    asOfMs: input.asOfMs,
    coin: input.coin,
    configVersion: input.config.version,
    multiplier: bigActivityMultiplier('bull', spotBull.score, spotBear.score, derivativesBull.score, derivativesBear.score)
  });
  const bigBear = scoreBigActivityFamily({
    side: 'bear',
    rows: freshRows,
    hitRows,
    window: input.window,
    asOfMs: input.asOfMs,
    coin: input.coin,
    configVersion: input.config.version,
    multiplier: bigActivityMultiplier('bear', spotBull.score, spotBear.score, derivativesBull.score, derivativesBear.score)
  });
  if (bigBull.rawScore > 0 && bigBull.multiplier === 0.3) riskTags.add('spot_big_activity_conflict');
  if (bigBear.rawScore > 0 && bigBear.multiplier === 0.3) riskTags.add('spot_big_activity_conflict');

  const details = [spotBull, spotBear, derivativesBull, derivativesBear, topOiBull, topOiBear, bigBull, bigBear];
  if (details.some((detail) => detail.thinLiquidity && detail.score > 0)) riskTags.add('thin_liquidity');

  const componentScores: ComponentScores = {
    spot: { bull: spotBull.score, bear: spotBear.score },
    derivatives: { bull: derivativesBull.score, bear: derivativesBear.score },
    topOi: { bull: topOiBull.score, bear: topOiBear.score },
    bigActivity: { bull: bigBull.score, bear: bigBear.score }
  };

  const bullRaw = round2(componentScores.spot.bull + componentScores.derivatives.bull + componentScores.topOi.bull + componentScores.bigActivity.bull);
  const bearRaw = round2(componentScores.spot.bear + componentScores.derivatives.bear + componentScores.topOi.bear + componentScores.bigActivity.bear);
  const bullScore = normalizeFlowScore(bullRaw);
  const bearScore = normalizeFlowScore(bearRaw);
  const netScore = round2(bullScore - bearScore);
  const scoreState = deriveFlowState(componentScores, bullRaw, bearRaw, riskTags);
  const confidenceScore = calculateFlowConfidence({ state: scoreState, riskTags, rows: freshRows, details, asOfMs: input.asOfMs });
  const tradeAction = tradeActionFor(scoreState, bullScore, bearScore, netScore, confidenceScore);
  const evidence = [
    ...details.map((detail) => detail.evidence).filter((item): item is ScoreEvidenceOutput => Boolean(item)),
    ...buildRiskEvidence({ configVersion: input.config.version, window: input.window, asOf: input.asOf, asOfMs: input.asOfMs, coin: input.coin, riskTags })
  ];
  const dominantSignal = dominantRule(evidence);
  const marketRegime = regimeForFlowState(scoreState, confidenceScore, evidence.length);
  const eventIds = new Set(evidence.flatMap((item) => item.sourceEventIds));
  const payload = {
    engine: 'flow-v2',
    rawMax: FLOW_RAW_MAX,
    bullRaw,
    bearRaw,
    scoreState,
    tradeAction,
    riskTags: [...riskTags].sort(),
    componentScores,
    flowBreakdown: details.map((detail) => ({
      family: detail.family,
      side: detail.side,
      score: detail.score,
      rawScore: detail.rawScore,
      maxScore: detail.maxScore,
      multiplier: detail.multiplier,
      effectiveHits: detail.effectiveHits,
      rawBeforeCap: detail.rawBeforeCap,
      volumeCap: detail.volumeCap,
      activityCap: detail.activityCap,
      liquidityCap: detail.liquidityCap,
      hitPoints: detail.hitPoints,
      subpoints: detail.subpoints,
      thinLiquidity: detail.thinLiquidity,
      newestReceivedAt: detail.newestReceivedAt
    })),
    sourceRows: freshRows.length
  };
  const evidenceHash = hashJson(evidence.map((item) => ({ key: item.evidenceKey, contribution: round2(item.contribution), confidenceImpact: round2(item.confidenceImpact) })));
  const scoreHash = hashJson({ bullScore, bearScore, netScore, confidenceScore, dominantSignal, marketRegime, payload, evidenceHash });

  return {
    scoreConfigVersion: input.config.version,
    ts: input.asOf,
    windowMinutes: input.window.minutes,
    coin: input.coin,
    bullScore,
    bearScore,
    netScore,
    confidenceScore,
    eventCount: eventIds.size,
    evidenceCount: evidence.length,
    dominantSignal,
    marketRegime,
    scoreHash,
    evidenceHash,
    payload,
    evidence
  };
}

function scoreTopFlowFamily(input: {
  family: 'spot' | 'derivatives';
  side: FlowDirectionSide;
  rows: ScoreSourceRow[];
  hitRows: ScoreSourceRow[];
  window: ScoreWindowConfig;
  asOfMs: number;
  coin: string;
  configVersion: string;
  multiplier?: number;
}): ComponentDetail {
  const familyRows = input.rows.filter((row) => rowMatchesTopFamily(row, input.family) && rowSide(row) === input.side);
  const best = bestRowScore(familyRows, (row) => scoreTopFlowRow(row, input.family, input.side, input.asOfMs, input.window));
  const sameHits = input.hitRows.filter((row) => rowMatchesTopFamily(row, input.family) && rowSide(row) === input.side).length;
  const oppositeHits = input.hitRows.filter((row) => rowMatchesTopFamily(row, input.family) && rowSide(row) === oppositeSide(input.side)).length;
  const effectiveHits = Math.max(0, sameHits - oppositeHits);
  const hitPoints = repeatHitPoints(effectiveHits, input.family === 'spot' ? 6 : 5);
  const multiplier = input.multiplier ?? 1;
  const maxScore = input.family === 'spot' ? FLOW_COMPONENT_MAX.spot : FLOW_COMPONENT_MAX.derivatives;

  if (!best) return emptyDetail(input.family, input.side, maxScore, multiplier, effectiveHits);

  const activityUsd = nonNegative(best.row.buyUsd) + nonNegative(best.row.sellUsd);
  const rawBeforeCap = best.score + hitPoints;
  const volumeCap = input.family === 'spot' ? spotVolumeCap(best.row.volume24hUsd) : derivativesVolumeCap(best.row.volume24hUsd);
  const activityCap = input.family === 'spot' ? spotActivityCap(activityUsd) : derivativesActivityCap(activityUsd);
  const capped = Math.min(rawBeforeCap, volumeCap, activityCap, maxScore);
  const score = round2(capped * multiplier);
  const thinLiquidity = capped < rawBeforeCap && Math.min(volumeCap, activityCap) <= maxScore * 0.4;
  const familyLabel = input.family === 'spot' ? 'Spot' : 'Derivatives';
  const sideLabel = input.side === 'bull' ? 'buy' : 'sell';
  const evidence = score > 0 ? familyEvidence({
    configVersion: input.configVersion,
    window: input.window,
    coin: input.coin,
    family: input.family,
    side: input.side,
    ruleKey: input.family === 'spot' ? `flow_spot_${sideLabel}` : `flow_derivatives_${sideLabel}`,
    feedKey: input.family === 'spot' ? FLOW_FEED_KEYS.spot : FLOW_FEED_KEYS.derivatives,
    contribution: score,
    confidenceImpact: confidenceImpactForContribution(score, thinLiquidity),
    weight: maxScore,
    decay: best.decay,
    value: best.value,
    unit: best.unit,
    rows: familyRows,
    bestRow: best.row,
    reason: `${familyLabel} ${sideLabel} pressure: ${round2(score)} / ${maxScore} after dominance, relative impact, rank, 1h hits, liquidity caps, and ${round2(multiplier)}x cross-market multiplier.`,
    payload: {
      rawBeforeCap: round2(rawBeforeCap),
      rawScore: round2(capped),
      volumeCap,
      activityCap,
      hitPoints,
      effectiveHits,
      multiplier,
      thinLiquidity,
      subpoints: { ...best.subpoints, hitPoints }
    }
  }) : null;

  return {
    family: input.family,
    side: input.side,
    score,
    rawScore: round2(capped),
    maxScore,
    multiplier,
    effectiveHits,
    rawBeforeCap: round2(rawBeforeCap),
    volumeCap,
    activityCap,
    hitPoints,
    subpoints: { ...best.subpoints, hitPoints },
    thinLiquidity,
    newestReceivedAt: newestReceivedAt(familyRows),
    evidence
  };
}

function scoreTopFlowRow(row: ScoreSourceRow, family: 'spot' | 'derivatives', side: FlowDirectionSide, asOfMs: number, window: ScoreWindowConfig): RowBaseScore | null {
  const dominance = dominanceRatio(row, side);
  const deltaUsd = absPositive(row.deltaUsd) ?? absPositive((row.buyUsd ?? 0) - (row.sellUsd ?? 0));
  const impact = relativeImpactPercent(deltaUsd, row.volume24hUsd);
  const decay = recencyDecay(row, asOfMs, window);

  if (family === 'spot') {
    const dominancePoints = pointsForRange(dominance, spotDominanceTable);
    const relativeImpactPoints = pointsForRange(impact, spotRelativeImpactTable);
    const deltaPoints = pointsForRange(deltaUsd, spotDeltaTable);
    const rank = rankPoints(row.rank, 2.5);
    const score = (dominancePoints + relativeImpactPoints + deltaPoints + rank) * decay;
    return {
      row,
      score,
      decay,
      value: deltaUsd,
      unit: 'usd',
      subpoints: { dominance, dominancePoints, relativeImpact: impact, relativeImpactPoints, deltaPoints, rankPoints: rank }
    };
  }

  const dominancePoints = pointsForRange(dominance, derivativesDominanceTable);
  const relativeImpactPoints = pointsForRange(impact, derivativesRelativeImpactTable);
  const deltaPoints = pointsForRange(deltaUsd, derivativesDeltaTable);
  const rank = rankPoints(row.rank, 2.5);
  const score = (dominancePoints + relativeImpactPoints + deltaPoints + rank) * decay;
  return {
    row,
    score,
    decay,
    value: deltaUsd,
    unit: 'usd',
    subpoints: { dominance, dominancePoints, relativeImpact: impact, relativeImpactPoints, deltaPoints, rankPoints: rank }
  };
}

function scoreTopOiFamily(input: {
  side: FlowDirectionSide;
  rows: ScoreSourceRow[];
  hitRows: ScoreSourceRow[];
  window: ScoreWindowConfig;
  asOfMs: number;
  coin: string;
  configVersion: string;
  riskTags: Set<string>;
}): ComponentDetail {
  const familyRows = input.rows.filter((row) => rowMatchesTopOi(row) && rowSide(row) === input.side);
  const best = bestRowScore(familyRows, (row) => scoreTopOiRow(row, input.side, input.asOfMs, input.window, input.riskTags));
  const sameHits = input.hitRows.filter((row) => rowMatchesTopOi(row) && rowSide(row) === input.side).length;
  const hitBonus = sameHits >= 2 ? 1.5 : 0;

  if (!best) return emptyDetail('topOi', input.side, FLOW_COMPONENT_MAX.topOi, 1, sameHits);

  const score = round2(Math.min(best.score + hitBonus, FLOW_COMPONENT_MAX.topOi));
  const sideLabel = input.side === 'bull' ? 'gainer' : 'loser';
  const evidence = score > 0 ? familyEvidence({
    configVersion: input.configVersion,
    window: input.window,
    coin: input.coin,
    family: 'topOi',
    side: input.side,
    ruleKey: `flow_top_oi_${sideLabel}`,
    feedKey: FLOW_FEED_KEYS.topOi,
    contribution: score,
    confidenceImpact: confidenceImpactForContribution(score, false),
    weight: FLOW_COMPONENT_MAX.topOi,
    decay: best.decay,
    value: best.value,
    unit: 'percent',
    rows: familyRows,
    bestRow: best.row,
    reason: `Top OI ${sideLabel} confirmation: ${round2(score)} / ${FLOW_COMPONENT_MAX.topOi} from OI change, price confirmation, rank, and repeat hits.`,
    payload: {
      rawScore: score,
      hitBonus,
      sameHits,
      subpoints: { ...best.subpoints, hitBonus }
    }
  }) : null;

  return {
    family: 'topOi',
    side: input.side,
    score,
    rawScore: score,
    maxScore: FLOW_COMPONENT_MAX.topOi,
    multiplier: 1,
    effectiveHits: sameHits,
    rawBeforeCap: round2(best.score + hitBonus),
    hitPoints: hitBonus,
    subpoints: { ...best.subpoints, hitBonus },
    thinLiquidity: false,
    newestReceivedAt: newestReceivedAt(familyRows),
    evidence
  };
}

function scoreTopOiRow(row: ScoreSourceRow, side: FlowDirectionSide, asOfMs: number, window: ScoreWindowConfig, riskTags: Set<string>): RowBaseScore {
  const oiPercent = absPositive(row.percent) ?? absPositive(row.oiChange30mPercent) ?? absPositive(row.oiChange15mPercent);
  const oiPercentPoints = pointsForRange(oiPercent, topOiPercentTable);
  const priceChange = row.priceChangePercent;
  let priceConfirmationPoints = 1.75;
  if (typeof priceChange === 'number' && Number.isFinite(priceChange)) {
    const confirms = side === 'bull' ? priceChange >= 0 : priceChange <= 0;
    priceConfirmationPoints = confirms ? 3.5 : 0;
    if (!confirms) riskTags.add('top_oi_price_conflict');
  }
  const rank = rankPoints(row.rank, 1);
  const decay = recencyDecay(row, asOfMs, window);
  const score = (oiPercentPoints + priceConfirmationPoints + rank) * decay;
  return {
    row,
    score,
    decay,
    value: oiPercent,
    unit: 'percent',
    subpoints: { oiPercent, oiPercentPoints, priceChange: priceChange ?? null, priceConfirmationPoints, rankPoints: rank }
  };
}

function scoreBigActivityFamily(input: {
  side: FlowDirectionSide;
  rows: ScoreSourceRow[];
  hitRows: ScoreSourceRow[];
  window: ScoreWindowConfig;
  asOfMs: number;
  coin: string;
  configVersion: string;
  multiplier: number;
}): ComponentDetail {
  const familyRows = input.rows.filter((row) => rowMatchesBigActivity(row) && rowSide(row) === input.side);
  const best = bestRowScore(familyRows, (row) => scoreBigActivityRow(row, input.asOfMs, input.window));
  const sameHits = input.hitRows.filter((row) => rowMatchesBigActivity(row) && rowSide(row) === input.side).length;
  const oppositeHits = input.hitRows.filter((row) => rowMatchesBigActivity(row) && rowSide(row) === oppositeSide(input.side)).length;
  const effectiveHits = Math.max(0, sameHits - oppositeHits);
  const hitPoints = repeatHitPoints(effectiveHits, 3.5);

  if (!best) return emptyDetail('bigActivity', input.side, FLOW_COMPONENT_MAX.bigActivity, input.multiplier, effectiveHits);

  const rawBeforeCap = best.score + hitPoints;
  const liquidityCap = bigActivityLiquidityCap(best.row.volume24hUsd);
  const capped = Math.min(rawBeforeCap, liquidityCap, FLOW_COMPONENT_MAX.bigActivity);
  const score = round2(capped * input.multiplier);
  const thinLiquidity = capped < rawBeforeCap && liquidityCap <= 7.2;
  const sideLabel = input.side === 'bull' ? 'buying' : 'selling';
  const evidence = score > 0 ? familyEvidence({
    configVersion: input.configVersion,
    window: input.window,
    coin: input.coin,
    family: 'bigActivity',
    side: input.side,
    ruleKey: `flow_big_${sideLabel}`,
    feedKey: FLOW_FEED_KEYS.bigActivity,
    contribution: score,
    confidenceImpact: confidenceImpactForContribution(score, thinLiquidity),
    weight: FLOW_COMPONENT_MAX.bigActivity,
    decay: best.decay,
    value: best.value,
    unit: 'usd',
    rows: familyRows,
    bestRow: best.row,
    reason: `Big ${sideLabel} flow: ${round2(score)} / ${FLOW_COMPONENT_MAX.bigActivity} after amount, relative impact, 1h hits, freshness, liquidity cap, and ${round2(input.multiplier)}x confirmation multiplier.`,
    payload: {
      rawBeforeCap: round2(rawBeforeCap),
      rawScore: round2(capped),
      liquidityCap,
      hitPoints,
      effectiveHits,
      multiplier: input.multiplier,
      thinLiquidity,
      subpoints: { ...best.subpoints, hitPoints }
    }
  }) : null;

  return {
    family: 'bigActivity',
    side: input.side,
    score,
    rawScore: round2(capped),
    maxScore: FLOW_COMPONENT_MAX.bigActivity,
    multiplier: input.multiplier,
    effectiveHits,
    rawBeforeCap: round2(rawBeforeCap),
    liquidityCap,
    hitPoints,
    subpoints: { ...best.subpoints, hitPoints },
    thinLiquidity,
    newestReceivedAt: newestReceivedAt(familyRows),
    evidence
  };
}

function scoreBigActivityRow(row: ScoreSourceRow, asOfMs: number, window: ScoreWindowConfig): RowBaseScore {
  const amountUsd = absPositive(row.amountUsd);
  const impact = relativeImpactPercent(amountUsd, row.volume24hUsd);
  const amountPoints = pointsForRange(amountUsd, bigActivityAmountTable);
  const relativeImpactPoints = pointsForRange(impact, bigActivityRelativeImpactTable);
  const freshnessPoints = ageMinutes(row, asOfMs) <= 10 ? 1 : ageMinutes(row, asOfMs) <= 30 ? 0.5 : 0;
  const decay = recencyDecay(row, asOfMs, window);
  const score = (amountPoints + relativeImpactPoints + freshnessPoints) * decay;
  return {
    row,
    score,
    decay,
    value: amountUsd,
    unit: 'usd',
    subpoints: { amountUsd, amountPoints, relativeImpact: impact, relativeImpactPoints, freshnessPoints }
  };
}

function derivativesMultiplier(side: FlowDirectionSide, spotBull: number, spotBear: number): number {
  const sameSpot = side === 'bull' ? spotBull : spotBear;
  const oppositeSpot = side === 'bull' ? spotBear : spotBull;
  if (oppositeSpot >= 12 && sameSpot < 12) return 0.3;
  if (sameSpot >= 12) return 1;
  if (sameSpot >= 6) return 0.85;
  return 0.7;
}

function bigActivityMultiplier(side: FlowDirectionSide, spotBull: number, spotBear: number, derivativesBull: number, derivativesBear: number): number {
  const sameSpot = side === 'bull' ? spotBull : spotBear;
  const oppositeSpot = side === 'bull' ? spotBear : spotBull;
  const sameDerivatives = side === 'bull' ? derivativesBull : derivativesBear;
  if (oppositeSpot >= 12 && sameSpot < 12) return 0.3;
  if (sameSpot >= 12 || sameDerivatives >= 12) return 1;
  return 0.75;
}

function bestRowScore(rows: ScoreSourceRow[], scorer: (row: ScoreSourceRow) => RowBaseScore | null): RowBaseScore | null {
  const scored = rows.map(scorer).filter((item): item is RowBaseScore => Boolean(item));
  return scored.sort((left, right) => right.score - left.score)[0] ?? null;
}

function rowMatchesTopFamily(row: ScoreSourceRow, family: 'spot' | 'derivatives'): boolean {
  if (family === 'spot') return row.feedKey.includes('spot');
  return row.feedKey.includes('derivatives') || row.feedKey.includes('futures') || row.feedKey.includes('fut_') || row.feedKey.includes('hyper');
}

function rowMatchesTopOi(row: ScoreSourceRow): boolean {
  return row.feedKey.includes('top_oi');
}

function rowMatchesBigActivity(row: ScoreSourceRow): boolean {
  return row.feedKey === 'cex_track' || row.feedKey === 'flows_alert';
}

function rowSide(row: ScoreSourceRow): FlowDirectionSide | null {
  const direction = row.direction?.toLowerCase() ?? '';
  if (direction === 'buy' || direction === 'gainer' || direction === 'outflow') return 'bull';
  if (direction === 'sell' || direction === 'loser' || direction === 'inflow') return 'bear';
  if (row.feedKey.includes('buy') || row.feedKey.includes('gainers')) return 'bull';
  if (row.feedKey.includes('sell') || row.feedKey.includes('losers')) return 'bear';
  return null;
}

function dominanceRatio(row: ScoreSourceRow, side: FlowDirectionSide): number | null {
  const buyUsd = nonNegativeOrNull(row.buyUsd);
  const sellUsd = nonNegativeOrNull(row.sellUsd);
  if (buyUsd !== null && sellUsd !== null) {
    const numerator = side === 'bull' ? buyUsd : sellUsd;
    const denominator = side === 'bull' ? sellUsd : buyUsd;
    if (numerator <= 0) return null;
    return denominator <= 0 ? 999 : numerator / denominator;
  }
  if (row.buySellRatio && row.buySellRatio > 0) return side === 'bull' ? row.buySellRatio : 1 / row.buySellRatio;
  return null;
}

function deriveFlowState(componentScores: ComponentScores, bullRaw: number, bearRaw: number, riskTags: Set<string>): FlowScoreState {
  if (riskTags.has('thin_liquidity')) return 'thin_liquidity';
  if (riskTags.has('spot_derivatives_hedge') || riskTags.has('spot_big_activity_conflict')) return 'hedged_conflict';
  if (bullRaw <= 0 && bearRaw <= 0) return 'neutral';
  const maxRaw = Math.max(bullRaw, bearRaw);
  const minRaw = Math.min(bullRaw, bearRaw);
  if (maxRaw > 0 && minRaw / maxRaw >= 0.45) return 'mixed';
  if (bullRaw > bearRaw && componentScores.derivatives.bull >= 10 && componentScores.spot.bull < 6 && componentScores.spot.bear < 6) return 'derivatives_only_bull';
  if (bearRaw > bullRaw && componentScores.derivatives.bear >= 10 && componentScores.spot.bear < 6 && componentScores.spot.bull < 6) return 'derivatives_only_bear';
  if (bullRaw > bearRaw) return 'clean_bull';
  if (bearRaw > bullRaw) return 'clean_bear';
  return 'neutral';
}

function tradeActionFor(state: FlowScoreState, bullScore: number, bearScore: number, netScore: number, confidenceScore: number): TradeAction {
  if (state === 'thin_liquidity' || state === 'hedged_conflict' || state === 'mixed') return 'AVOID';
  if (state === 'neutral') return 'NEUTRAL';
  if (bullScore >= 60 && netScore >= 25 && confidenceScore >= 60 && bullScore > bearScore) return 'LONG_WATCH';
  if (bearScore >= 60 && netScore <= -25 && confidenceScore >= 60 && bearScore > bullScore) return 'SHORT_WATCH';
  return 'WATCH';
}

function regimeForFlowState(state: FlowScoreState, confidenceScore: number, evidenceCount: number): ScoreResult['marketRegime'] {
  if (evidenceCount === 0 || confidenceScore < 25) return 'thin_data';
  if (state === 'thin_liquidity') return 'thin_data';
  if (state === 'hedged_conflict' || state === 'mixed') return 'conflicted';
  if (state === 'clean_bull' || state === 'derivatives_only_bull') return 'bullish';
  if (state === 'clean_bear' || state === 'derivatives_only_bear') return 'bearish';
  return 'neutral';
}

function calculateFlowConfidence(input: { state: FlowScoreState; riskTags: Set<string>; rows: ScoreSourceRow[]; details: ComponentDetail[]; asOfMs: number }): number {
  const active = input.details.filter((detail) => detail.score > 0);
  if (!active.length) return 0;
  const agreementPoints = agreementConfidence(input.details);
  const maxHits = Math.max(0, ...active.map((detail) => detail.effectiveHits));
  const persistencePoints = maxHits >= 4 ? 15 : maxHits === 3 ? 10 : maxHits === 2 ? 5 : 0;
  const liquidityQualityPoints = input.riskTags.has('thin_liquidity') ? 0 : liquidityQualityConfidence(active);
  const freshnessPoints = freshnessConfidence(input.rows, input.asOfMs);
  let penalties = 0;
  if (input.riskTags.has('spot_derivatives_hedge') || input.riskTags.has('spot_big_activity_conflict')) penalties += 25;
  if (input.riskTags.has('top_oi_price_conflict')) penalties += 10;
  if (input.state === 'derivatives_only_bull' || input.state === 'derivatives_only_bear') penalties += 10;
  if (input.riskTags.has('thin_liquidity')) penalties += 20;
  if (input.rows.some((row) => row.parserStatus === 'parser_needs_sample')) penalties += 15;

  return round2(clamp(40 + agreementPoints + persistencePoints + liquidityQualityPoints + freshnessPoints - penalties, 0, 100));
}

function agreementConfidence(details: ComponentDetail[]): number {
  let points = 0;
  for (const side of ['bull', 'bear'] as const) {
    const spot = details.find((detail) => detail.family === 'spot' && detail.side === side)?.score ?? 0;
    const derivatives = details.find((detail) => detail.family === 'derivatives' && detail.side === side)?.score ?? 0;
    const topOi = details.find((detail) => detail.family === 'topOi' && detail.side === side)?.score ?? 0;
    const big = details.find((detail) => detail.family === 'bigActivity' && detail.side === side)?.score ?? 0;
    if (spot >= 12 && derivatives >= 12) points += 15;
    if (spot >= 12 && big >= 8) points += 8;
    if (derivatives >= 10 && topOi > 0) points += 8;
  }
  return Math.min(20, points);
}

function liquidityQualityConfidence(details: ComponentDetail[]): number {
  const bestRatio = Math.max(0, ...details.map((detail) => detail.rawScore / detail.maxScore));
  if (bestRatio >= 0.85) return 15;
  if (bestRatio >= 0.45) return 8;
  return 0;
}

function freshnessConfidence(rows: ScoreSourceRow[], asOfMs: number): number {
  const ages = rows.map((row) => ageMinutes(row, asOfMs)).filter(Number.isFinite).sort((left, right) => left - right);
  const medianAge = ages[Math.floor(ages.length / 2)] ?? Infinity;
  if (medianAge <= 10) return 10;
  if (medianAge <= 30) return 6;
  if (medianAge <= 60) return 3;
  return 0;
}

function buildRiskEvidence(input: { configVersion: string; window: ScoreWindowConfig; asOf: string; asOfMs: number; coin: string; riskTags: Set<string> }): ScoreEvidenceOutput[] {
  return [...input.riskTags].sort().map((riskTag) => ({
    evidenceKey: evidenceKey({ version: input.configVersion, windowMinutes: input.window.minutes, coin: input.coin, ruleKey: riskTag, side: 'risk', eventId: null, entryId: null, receivedAt: input.asOf }),
    coin: input.coin,
    side: 'risk',
    ruleKey: riskTag,
    contribution: 0,
    confidenceImpact: riskTag === 'thin_liquidity' ? -20 : -10,
    weight: 0,
    decayMultiplier: 1,
    value: null,
    unit: null,
    source: 'aggregate',
    feedKey: FLOW_FEED_KEYS.risk,
    eventId: null,
    eventReceivedAt: null,
    entryId: null,
    sourceEventIds: [],
    sourceReceivedAt: input.asOf,
    reason: riskReason(riskTag),
    payload: { riskTag, engine: 'flow-v2' }
  }));
}

function familyEvidence(input: {
  configVersion: string;
  window: ScoreWindowConfig;
  coin: string;
  family: FlowFamily;
  side: FlowDirectionSide;
  ruleKey: string;
  feedKey: string;
  contribution: number;
  confidenceImpact: number;
  weight: number;
  decay: number;
  value: number | null;
  unit: string | null;
  rows: ScoreSourceRow[];
  bestRow: ScoreSourceRow;
  reason: string;
  payload: Record<string, unknown>;
}): ScoreEvidenceOutput {
  const sourceEventIds = [...new Set(input.rows.map((row) => row.eventId))];
  return {
    evidenceKey: evidenceKey({ version: input.configVersion, windowMinutes: input.window.minutes, coin: input.coin, ruleKey: input.ruleKey, side: input.side, eventId: sourceEventIds.join(','), entryId: input.bestRow.entryId, receivedAt: input.bestRow.receivedAt }),
    coin: input.coin,
    side: input.side,
    ruleKey: input.ruleKey,
    contribution: round4(input.contribution),
    confidenceImpact: input.confidenceImpact,
    weight: input.weight,
    decayMultiplier: round4(input.decay),
    value: input.value,
    unit: input.unit,
    source: 'aggregate',
    feedKey: input.feedKey,
    eventId: input.bestRow.eventId,
    eventReceivedAt: input.bestRow.eventReceivedAt,
    entryId: input.bestRow.entryId,
    sourceEventIds,
    sourceReceivedAt: input.bestRow.receivedAt,
    reason: input.reason,
    payload: {
      engine: 'flow-v2',
      family: input.family,
      exchange: input.bestRow.exchange,
      market: input.bestRow.market ?? null,
      direction: input.bestRow.direction,
      parserStatus: input.bestRow.parserStatus,
      bestFeedKey: input.bestRow.feedKey,
      sourceFeedKeys: [...new Set(input.rows.map((row) => row.feedKey))],
      rank: input.bestRow.rank,
      amountUsd: input.bestRow.amountUsd,
      deltaUsd: input.bestRow.deltaUsd,
      buyUsd: input.bestRow.buyUsd,
      sellUsd: input.bestRow.sellUsd,
      buySellRatio: input.bestRow.buySellRatio,
      volume24hUsd: input.bestRow.volume24hUsd,
      percent: input.bestRow.percent,
      priceChangePercent: input.bestRow.priceChangePercent,
      rawLine: input.bestRow.rawLine,
      ...input.payload
    }
  };
}

function emptyDetail(family: FlowFamily, side: FlowDirectionSide, maxScore: number, multiplier: number, effectiveHits: number): ComponentDetail {
  return {
    family,
    side,
    score: 0,
    rawScore: 0,
    maxScore,
    multiplier,
    effectiveHits,
    thinLiquidity: false,
    newestReceivedAt: null,
    evidence: null
  };
}

function isFreshRow(row: ScoreSourceRow, asOfMs: number, maxAgeMinutes: number): boolean {
  const age = ageMinutes(row, asOfMs);
  return Number.isFinite(age) && age >= 0 && age <= maxAgeMinutes;
}

function recencyDecay(row: ScoreSourceRow, asOfMs: number, window: ScoreWindowConfig): number {
  return 0.5 ** (Math.max(0, ageMinutes(row, asOfMs)) / window.halfLifeMinutes);
}

function ageMinutes(row: ScoreSourceRow, asOfMs: number): number {
  return (asOfMs - Date.parse(row.receivedAt)) / 60_000;
}

function newestReceivedAt(rows: ScoreSourceRow[]): string | null {
  return rows.map((row) => row.receivedAt).sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null;
}

function confidenceImpactForContribution(contribution: number, thinLiquidity: boolean): number {
  return round2(Math.min(8, contribution / 3) - (thinLiquidity ? 6 : 0));
}

function normalizeFlowScore(raw: number): number {
  return round2(clamp((raw / FLOW_RAW_MAX) * 100, 0, 100));
}

function dominantRule(evidence: ScoreEvidenceOutput[]): string | null {
  const sorted = [...evidence].filter((item) => item.side !== 'risk').sort((a, b) => b.contribution - a.contribution);
  return sorted[0]?.ruleKey ?? null;
}

function riskReason(riskTag: string): string {
  if (riskTag === 'thin_liquidity') return 'Thin liquidity cap limited the score; avoid treating the raw pressure as clean signal.';
  if (riskTag === 'spot_derivatives_hedge') return 'Spot and derivatives point in opposite directions; treat as hedge/conflict rather than clean trend.';
  if (riskTag === 'spot_big_activity_conflict') return 'Big activity conflicts with spot direction; directional score is discounted.';
  if (riskTag === 'top_oi_price_conflict') return 'Top OI direction conflicts with price change; OI is not clean confirmation.';
  return `Flow risk tag: ${riskTag}.`;
}

function groupRowsByCoin(rows: ScoreSourceRow[]): Map<string, ScoreSourceRow[]> {
  const grouped = new Map<string, ScoreSourceRow[]>();
  for (const row of rows) {
    const coin = row.coin.toUpperCase();
    grouped.set(coin, [...(grouped.get(coin) ?? []), { ...row, coin }]);
  }
  return grouped;
}

function evidenceKey(input: { version: string; windowMinutes: number; coin: string; ruleKey: string; side: string; eventId: string | null; entryId: string | null; receivedAt: string }): string {
  return hashJson(input);
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function oppositeSide(side: FlowDirectionSide): FlowDirectionSide {
  return side === 'bull' ? 'bear' : 'bull';
}

function absPositive(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) > 0 ? Math.abs(value) : null;
}

function nonNegative(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function nonNegativeOrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
