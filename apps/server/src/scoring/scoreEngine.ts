import { createHash } from 'node:crypto';

import type { ScoreConfig, ScoreEvidenceOutput, ScoreResult, ScoreRuleConfig, ScoreSide, ScoreSourceRow, ScoreWindowConfig } from './types.js';

interface RuleContribution {
  contribution: number;
  value: number | null;
  unit: string | null;
  payload: Record<string, unknown>;
  reasonDetails: string | null;
}

export interface ScoreEngineInput {
  config: ScoreConfig;
  asOf: string;
  coins: string[];
  sourceRows: ScoreSourceRow[];
  windowsMinutes?: number[];
}

export function calculateScores(input: ScoreEngineInput): ScoreResult[] {
  const asOfMs = Date.parse(input.asOf);
  const windows = input.config.windows.filter((window) => !input.windowsMinutes || input.windowsMinutes.includes(window.minutes));
  const rowsByCoin = groupRowsByCoin(input.sourceRows);
  const results: ScoreResult[] = [];

  for (const coin of input.coins.map((item) => item.toUpperCase())) {
    const rows = rowsByCoin.get(coin) ?? [];
    for (const window of windows) {
      results.push(scoreCoinWindow({ config: input.config, asOf: input.asOf, asOfMs, coin, window, rows }));
    }
  }

  return results;
}

function scoreCoinWindow(input: { config: ScoreConfig; asOf: string; asOfMs: number; coin: string; window: ScoreWindowConfig; rows: ScoreSourceRow[] }): ScoreResult {
  const freshRows = input.rows.filter((row) => {
    const ageMinutes = (input.asOfMs - Date.parse(row.receivedAt)) / 60_000;
    return Number.isFinite(ageMinutes) && ageMinutes >= 0 && ageMinutes <= input.window.maxAgeMinutes;
  });
  const evidence = buildEvidence(input.config, input.window, input.asOfMs, input.coin, freshRows);
  evidence.push(...buildBurstEvidence(input.config, input.window, input.asOfMs, input.coin, evidence));

  const bullRaw = evidence.filter((item) => item.side === 'bull').reduce((sum, item) => sum + item.contribution, 0);
  const riskRaw = evidence.filter((item) => item.side === 'risk').reduce((sum, item) => sum + item.contribution, 0);
  const bearRaw = evidence.filter((item) => item.side === 'bear').reduce((sum, item) => sum + item.contribution, 0) + riskRaw;
  const bullScore = normalizeSideScore(bullRaw, input.config.sideSaturation);
  const bearScore = normalizeSideScore(bearRaw, input.config.sideSaturation);
  const netScore = round2(bullScore - bearScore);
  const confidenceScore = calculateConfidence(input.config, input.window, input.asOfMs, freshRows, evidence, bullScore, bearScore);
  const dominantSignal = dominantRule(evidence);
  const marketRegime = regimeForScores(bullScore, bearScore, confidenceScore, evidence.length);
  const eventIds = new Set(evidence.flatMap((item) => item.sourceEventIds));
  const evidenceHash = hashJson(evidence.map((item) => ({ key: item.evidenceKey, contribution: round2(item.contribution), confidenceImpact: round2(item.confidenceImpact) })));
  const scoreHash = hashJson({ bullScore, bearScore, netScore, confidenceScore, dominantSignal, marketRegime, evidenceHash });

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
    payload: {
      bullRaw: round2(bullRaw),
      bearRaw: round2(bearRaw),
      riskRaw: round2(riskRaw),
      conflict: hasConflict(bullScore, bearScore),
      sourceRows: freshRows.length
    },
    evidence
  };
}

function buildEvidence(config: ScoreConfig, window: ScoreWindowConfig, asOfMs: number, coin: string, rows: ScoreSourceRow[]): ScoreEvidenceOutput[] {
  const evidence: ScoreEvidenceOutput[] = [];
  for (const row of rows) {
    for (const rule of config.rules) {
      if (!ruleApplies(rule, row)) continue;
      const ageMinutes = Math.max(0, (asOfMs - Date.parse(row.receivedAt)) / 60_000);
      const decay = 0.5 ** (ageMinutes / window.halfLifeMinutes);
      const rankMultiplier = row.rank ? clamp((11 - row.rank) / 10, 0.25, 1) : 1;
      const calculated = contributionForRule(rule, row, rankMultiplier, decay);
      const contribution = calculated.contribution;
      if (contribution <= 0) continue;
      const side = rule.side;
      const confidenceImpact = confidenceImpactForRow(row, contribution);
      evidence.push({
        evidenceKey: evidenceKey({ version: config.version, windowMinutes: window.minutes, coin, ruleKey: rule.ruleKey, side, eventId: row.eventId, entryId: row.entryId, receivedAt: row.receivedAt }),
        coin,
        side,
        ruleKey: rule.ruleKey,
        contribution,
        confidenceImpact,
        weight: rule.baseWeight,
        decayMultiplier: round4(decay),
        value: calculated.value,
        unit: calculated.unit,
        source: row.source,
        feedKey: row.feedKey,
        eventId: row.eventId,
        eventReceivedAt: row.eventReceivedAt,
        entryId: row.entryId,
        sourceEventIds: [row.eventId],
        sourceReceivedAt: row.receivedAt,
        reason: reasonForRule(rule, row, contribution, decay, calculated.reasonDetails),
        payload: {
          rank: row.rank,
          exchange: row.exchange,
          market: row.market ?? null,
          direction: row.direction,
          parserStatus: row.parserStatus,
          rawLine: row.rawLine,
          ...calculated.payload
        }
      });
    }
  }
  return evidence;
}

function contributionForRule(rule: ScoreRuleConfig, row: ScoreSourceRow, rankMultiplier: number, decay: number): RuleContribution {
  const spotPressure = spotPressureContribution(rule, row, rankMultiplier, decay);
  if (spotPressure) return spotPressure;

  const value = valueForRule(rule, row);
  const valueMultiplier = valueMultiplierForRule(rule, value);
  return {
    contribution: round4(Math.min(rule.maxContribution, rule.baseWeight * valueMultiplier * rankMultiplier * decay)),
    value,
    unit: unitForRule(rule),
    payload: { valueMultiplier: round4(valueMultiplier) },
    reasonDetails: null
  };
}

function spotPressureContribution(rule: ScoreRuleConfig, row: ScoreSourceRow, rankMultiplier: number, decay: number): RuleContribution | null {
  const isBuyPressure = rule.ruleKey === 'spot_buy_pressure';
  const isSellPressure = rule.ruleKey === 'spot_sell_pressure';
  if (!isBuyPressure && !isSellPressure) return null;

  const buyUsd = nonNegativeNumber(row.buyUsd);
  const sellUsd = nonNegativeNumber(row.sellUsd);
  if (buyUsd === null || sellUsd === null || buyUsd + sellUsd <= 0) return null;

  const sideUsd = isBuyPressure ? buyUsd : sellUsd;
  const totalUsd = buyUsd + sellUsd;
  const sideShare = sideUsd / totalUsd;
  const imbalanceMultiplier = clamp((sideShare - 0.5) / 0.35, 0, 1.4);
  const directionalAmountUsd = positiveNumber(row.amountUsd) ?? sideUsd;
  const volumeMultiplier = clamp(Math.log10(Math.max(directionalAmountUsd, 1) / 50_000), 0.25, 1.5);
  const liquidityMultiplier = row.volume24hUsd && row.volume24hUsd > 0 ? clamp(Math.log10(row.volume24hUsd / 1_000_000), 0.25, 1.25) : 1;
  const contribution = round4(Math.min(rule.maxContribution, rule.baseWeight * imbalanceMultiplier * volumeMultiplier * liquidityMultiplier * rankMultiplier * decay));
  const buySellRatio = positiveNumber(row.buySellRatio) ?? (sellUsd > 0 ? buyUsd / sellUsd : null);
  const sideLabel = isBuyPressure ? 'buy' : 'sell';
  const ratioText = buySellRatio === null ? 'B/S unavailable' : `B/S ${round2(buySellRatio)}`;
  const reasonDetails = `${ratioText}, ${sideLabel} share ${round2(sideShare * 100)}%, volume ${round2(volumeMultiplier)}x, liquidity ${round2(liquidityMultiplier)}x`;

  return {
    contribution,
    value: directionalAmountUsd,
    unit: 'usd',
    payload: {
      buyUsd,
      sellUsd,
      buySellRatio: buySellRatio === null ? null : round4(buySellRatio),
      sideShare: round4(sideShare),
      imbalanceMultiplier: round4(imbalanceMultiplier),
      volumeMultiplier: round4(volumeMultiplier),
      liquidityMultiplier: round4(liquidityMultiplier),
      volume24hUsd: row.volume24hUsd
    },
    reasonDetails
  };
}

function buildBurstEvidence(config: ScoreConfig, window: ScoreWindowConfig, asOfMs: number, coin: string, evidence: ScoreEvidenceOutput[]): ScoreEvidenceOutput[] {
  const grouped = new Map<string, ScoreEvidenceOutput[]>();
  for (const item of evidence) {
    if (item.side === 'risk' || item.side === 'confidence') continue;
    const key = `${item.side}:${item.ruleKey}:${item.feedKey}`;
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  }

  const burstEvidence: ScoreEvidenceOutput[] = [];
  for (const [key, items] of grouped) {
    const uniqueEvents = [...new Set(items.map((item) => item.eventId).filter((eventId): eventId is string => Boolean(eventId)))];
    if (uniqueEvents.length < config.burst.threshold) continue;
    const [side, ruleKey, feedKey] = key.split(':') as [ScoreSide, string, string];
    const contribution = Math.min(config.burst.maxBonus, Math.log2(uniqueEvents.length) * 3);
    burstEvidence.push({
      evidenceKey: evidenceKey({ version: config.version, windowMinutes: window.minutes, coin, ruleKey: `${ruleKey}_burst`, side, eventId: uniqueEvents.join(','), entryId: null, receivedAt: new Date(asOfMs).toISOString() }),
      coin,
      side,
      ruleKey: `${ruleKey}_burst`,
      contribution: round4(contribution),
      confidenceImpact: uniqueEvents.length >= 5 ? -config.confidence.burstPenalty : 2,
      weight: contribution,
      decayMultiplier: 1,
      value: uniqueEvents.length,
      unit: 'count',
      source: 'aggregate',
      feedKey,
      eventId: null,
      eventReceivedAt: null,
      entryId: null,
      sourceEventIds: uniqueEvents,
      sourceReceivedAt: new Date(asOfMs).toISOString(),
      reason: `Repeated ${ruleKey} burst across ${uniqueEvents.length} alerts`,
      payload: { burstCount: uniqueEvents.length }
    });
  }
  return burstEvidence;
}

function ruleApplies(rule: ScoreRuleConfig, row: ScoreSourceRow): boolean {
  if (!rule.feedKeys.includes(row.feedKey)) return false;
  if (rule.ruleKey.includes('outflow') && row.direction !== 'outflow') return false;
  if (rule.ruleKey.includes('inflow') && row.direction !== 'inflow') return false;
  if (rule.ruleKey === 'negative_funding_contrarian') return (row.percent ?? 0) < 0;
  if (rule.ruleKey === 'positive_funding_overheated') return (row.percent ?? 0) > 0;
  if (rule.ruleKey === 'price_alert_up' || rule.ruleKey === 'volume_alert_up') return (row.priceChangePercent ?? row.percent ?? 0) > 0;
  if (rule.ruleKey === 'price_alert_down') return (row.priceChangePercent ?? row.percent ?? 0) < 0;
  if (rule.ruleKey === 'oi_rising_with_price') return (row.priceChangePercent ?? 0) >= 0;
  if (rule.ruleKey === 'listing' || rule.ruleKey === 'delisting') return true;
  return true;
}

function valueForRule(rule: ScoreRuleConfig, row: ScoreSourceRow): number | null {
  if (!rule.valueField) return null;
  const value = row[rule.valueField];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function valueMultiplierForRule(rule: ScoreRuleConfig, value: number | null): number {
  if (rule.scale === 'fixed') return 1;
  if (rule.scale === 'ranked') return 1;
  if (rule.scale === 'logUsd') return value === null ? 0.5 : clamp(Math.log10(Math.max(Math.abs(value), 1_000) / 1_000), 0.5, 3);
  if (rule.scale === 'percentAbs') return value === null ? 0.5 : clamp(Math.abs(value) / 2, 0.5, 4);
  return 1;
}

function confidenceImpactForRow(row: ScoreSourceRow, contribution: number): number {
  const parserPenalty = row.parserStatus === 'parser_needs_sample' ? -8 : 0;
  return round2(Math.min(6, contribution / 4) + parserPenalty);
}

function reasonForRule(rule: ScoreRuleConfig, row: ScoreSourceRow, contribution: number, decay: number, details: string | null): string {
  const exchange = row.exchange ? ` on ${row.exchange}` : '';
  const value = valueForRule(rule, row);
  const valueText = value === null ? '' : ` value ${round2(value)}`;
  const detailsText = details ? `; ${details}` : '';
  return `${rule.reasonTemplate}${exchange}${valueText}${detailsText}; contribution ${round2(contribution)} after ${round2(decay)}x recency decay.`;
}

function calculateConfidence(config: ScoreConfig, window: ScoreWindowConfig, asOfMs: number, rows: ScoreSourceRow[], evidence: ScoreEvidenceOutput[], bullScore: number, bearScore: number): number {
  if (!evidence.length) return 0;
  const feeds = new Set(evidence.map((item) => item.feedKey));
  const rules = new Set(evidence.map((item) => item.ruleKey));
  const exchanges = new Set(evidence.map((item) => item.payload.exchange).filter(Boolean));
  const ages = rows.map((row) => (asOfMs - Date.parse(row.receivedAt)) / 60_000).filter(Number.isFinite).sort((a, b) => a - b);
  const medianAge = ages[Math.floor(ages.length / 2)] ?? window.maxAgeMinutes;
  const parserPenalty = rows.some((row) => row.parserStatus === 'parser_needs_sample') ? config.confidence.parserPenalty : 0;
  const conflictPenalty = hasConflict(bullScore, bearScore) ? config.confidence.conflictPenalty * (1 + conflictRatio(bullScore, bearScore)) : 0;
  const stalePenalty = medianAge > window.halfLifeMinutes ? config.confidence.stalePenalty : 0;
  const singleFeedPenalty = feeds.size <= 1 ? config.confidence.singleFeedPenalty : 0;
  const confidence =
    config.confidence.base +
    Math.min(config.confidence.evidenceCountCap, evidence.length * 3) +
    Math.min(config.confidence.feedDiversityCap, feeds.size * 6) +
    Math.min(config.confidence.signalDiversityCap, rules.size * 4) +
    Math.min(config.confidence.exchangeBreadthCap, exchanges.size * 4) +
    Math.max(0, 12 * (1 - medianAge / Math.max(1, window.maxAgeMinutes))) -
    parserPenalty -
    conflictPenalty -
    stalePenalty -
    singleFeedPenalty;
  return round2(clamp(confidence, 0, 100));
}

function normalizeSideScore(raw: number, saturation: number): number {
  return round2(clamp(100 * raw / (raw + saturation), 0, 100));
}

function regimeForScores(bullScore: number, bearScore: number, confidenceScore: number, evidenceCount: number): ScoreResult['marketRegime'] {
  if (evidenceCount === 0 || confidenceScore < 25) return 'thin_data';
  if (hasConflict(bullScore, bearScore)) return 'conflicted';
  if (bullScore - bearScore >= 15) return 'bullish';
  if (bearScore - bullScore >= 15) return 'bearish';
  return 'neutral';
}

function hasConflict(bullScore: number, bearScore: number): boolean {
  return bullScore >= 25 && bearScore >= 25 && conflictRatio(bullScore, bearScore) >= 0.45;
}

function conflictRatio(bullScore: number, bearScore: number): number {
  const maxScore = Math.max(bullScore, bearScore);
  if (maxScore === 0) return 0;
  return Math.min(bullScore, bearScore) / maxScore;
}

function dominantRule(evidence: ScoreEvidenceOutput[]): string | null {
  const sorted = [...evidence].sort((a, b) => b.contribution - a.contribution);
  return sorted[0]?.ruleKey ?? null;
}

function unitForRule(rule: ScoreRuleConfig): string | null {
  if (rule.scale === 'logUsd') return 'usd';
  if (rule.scale === 'percentAbs') return 'percent';
  if (rule.scale === 'ranked') return 'rank';
  return null;
}

function groupRowsByCoin(rows: ScoreSourceRow[]): Map<string, ScoreSourceRow[]> {
  const grouped = new Map<string, ScoreSourceRow[]>();
  for (const row of rows) {
    const coin = row.coin.toUpperCase();
    grouped.set(coin, [...(grouped.get(coin) ?? []), { ...row, coin }]);
  }
  return grouped;
}

function evidenceKey(input: { version: string; windowMinutes: number; coin: string; ruleKey: string; side: ScoreSide; eventId: string | null; entryId: string | null; receivedAt: string }): string {
  return hashJson(input);
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function positiveNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function nonNegativeNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
