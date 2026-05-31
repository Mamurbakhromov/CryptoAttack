import type { ScoreConfig } from './types.js';

export const defaultScoreConfig: ScoreConfig = {
  version: 'rule-v1',
  engine: 'rule-v1',
  description: 'Transparent rule-based Bull/Bear scoring v1',
  windows: [
    { minutes: 5, halfLifeMinutes: 2.5, maxAgeMinutes: 15 },
    { minutes: 15, halfLifeMinutes: 7.5, maxAgeMinutes: 45 },
    { minutes: 60, halfLifeMinutes: 30, maxAgeMinutes: 180 },
    { minutes: 240, halfLifeMinutes: 120, maxAgeMinutes: 720 },
    { minutes: 1_440, halfLifeMinutes: 480, maxAgeMinutes: 2_880 }
  ],
  sideSaturation: 45,
  materialChange: {
    minNetDelta: 7,
    minSideDelta: 10,
    minConfidenceDelta: 15
  },
  confidence: {
    base: 20,
    evidenceCountCap: 36,
    feedDiversityCap: 30,
    signalDiversityCap: 24,
    exchangeBreadthCap: 12,
    parserPenalty: 15,
    conflictPenalty: 22,
    stalePenalty: 10,
    singleFeedPenalty: 8,
    burstPenalty: 8
  },
  burst: {
    threshold: 3,
    maxBonus: 10
  },
  rules: [
    { ruleKey: 'spot_buy_pressure', feedKeys: ['all_spot_top_buy_5m'], side: 'bull', baseWeight: 14, scale: 'logUsd', valueField: 'amountUsd', maxContribution: 18, reasonTemplate: 'Spot buy pressure in top list' },
    { ruleKey: 'derivatives_buy_pressure', feedKeys: ['all_derivatives_top_buy_5m'], side: 'bull', baseWeight: 12, scale: 'logUsd', valueField: 'deltaUsd', maxContribution: 20, reasonTemplate: 'Derivatives buy pressure in top list' },
    { ruleKey: 'price_alert_up', feedKeys: ['pricealerts', 'price_alerts', 'pricealerts2'], side: 'bull', baseWeight: 10, scale: 'percentAbs', valueField: 'priceChangePercent', minValue: 0.01, maxContribution: 18, reasonTemplate: 'Upward price alert' },
    { ruleKey: 'volume_alert_up', feedKeys: ['volalerts'], side: 'bull', baseWeight: 8, scale: 'percentAbs', valueField: 'priceChangePercent', minValue: 0.01, maxContribution: 14, reasonTemplate: 'Confirming upward volume alert' },
    { ruleKey: 'oi_rising_with_price', feedKeys: ['top_oi_gainers_60m'], side: 'bull', baseWeight: 12, scale: 'percentAbs', valueField: 'percent', minValue: 0, maxContribution: 20, reasonTemplate: 'Open interest rising with constructive price action' },
    { ruleKey: 'cex_outflow', feedKeys: ['flows_alert', 'onchain_24_all_flows', 'onchain_1_all_flows'], side: 'bull', baseWeight: 9, scale: 'logUsd', valueField: 'amountUsd', maxContribution: 15, reasonTemplate: 'CEX/onchain outflow pressure' },
    { ruleKey: 'listing', feedKeys: ['listings'], side: 'bull', baseWeight: 6, scale: 'fixed', maxContribution: 8, reasonTemplate: 'Fresh listing catalyst' },
    { ruleKey: 'negative_funding_contrarian', feedKeys: ['top_funding'], side: 'bull', baseWeight: 5, scale: 'percentAbs', valueField: 'percent', maxContribution: 8, reasonTemplate: 'Negative funding contrarian support' },

    { ruleKey: 'spot_sell_pressure', feedKeys: ['all_spot_top_sell_5m'], side: 'bear', baseWeight: 14, scale: 'logUsd', valueField: 'amountUsd', maxContribution: 18, reasonTemplate: 'Spot sell pressure in top list' },
    { ruleKey: 'derivatives_sell_pressure', feedKeys: ['all_derivatives_top_sell_5m'], side: 'bear', baseWeight: 12, scale: 'logUsd', valueField: 'deltaUsd', maxContribution: 20, reasonTemplate: 'Derivatives sell pressure in top list' },
    { ruleKey: 'price_alert_down', feedKeys: ['pricealerts', 'price_alerts', 'pricealerts2'], side: 'bear', baseWeight: 10, scale: 'percentAbs', valueField: 'priceChangePercent', maxContribution: 18, reasonTemplate: 'Downward price alert' },
    { ruleKey: 'oi_loser', feedKeys: ['top_oi_losers_60m'], side: 'bear', baseWeight: 12, scale: 'percentAbs', valueField: 'percent', maxContribution: 20, reasonTemplate: 'Open interest loser pressure' },
    { ruleKey: 'cex_inflow', feedKeys: ['flows_alert', 'onchain_24_all_flows', 'onchain_1_all_flows'], side: 'bear', baseWeight: 9, scale: 'logUsd', valueField: 'amountUsd', maxContribution: 15, reasonTemplate: 'CEX/onchain inflow pressure' },
    { ruleKey: 'delisting', feedKeys: ['delistings'], side: 'bear', baseWeight: 35, scale: 'fixed', maxContribution: 45, reasonTemplate: 'Delisting or negative listing action' },

    { ruleKey: 'positive_funding_overheated', feedKeys: ['top_funding'], side: 'risk', baseWeight: 10, scale: 'percentAbs', valueField: 'percent', minValue: 0.01, maxContribution: 16, reasonTemplate: 'Overheated positive funding risk' }
  ]
};

export const flowV2ScoreConfig: ScoreConfig = {
  version: 'flow-v2',
  engine: 'flow-v2',
  description: 'Intraday flow scoring v2 for 2-4h spot-led trade pressure',
  windows: [
    { minutes: 5, halfLifeMinutes: 5, maxAgeMinutes: 30 },
    { minutes: 15, halfLifeMinutes: 15, maxAgeMinutes: 75 },
    { minutes: 60, halfLifeMinutes: 45, maxAgeMinutes: 180 },
    { minutes: 240, halfLifeMinutes: 90, maxAgeMinutes: 480 },
    { minutes: 1_440, halfLifeMinutes: 240, maxAgeMinutes: 1_440 }
  ],
  sideSaturation: 100,
  materialChange: {
    minNetDelta: 7,
    minSideDelta: 10,
    minConfidenceDelta: 15
  },
  confidence: {
    base: 40,
    evidenceCountCap: 0,
    feedDiversityCap: 0,
    signalDiversityCap: 0,
    exchangeBreadthCap: 0,
    parserPenalty: 15,
    conflictPenalty: 25,
    stalePenalty: 0,
    singleFeedPenalty: 0,
    burstPenalty: 0
  },
  burst: {
    threshold: 3,
    maxBonus: 0
  },
  rules: [
    {
      ruleKey: 'flow_spot_family',
      feedKeys: ['all_spot_top_buy_5m', 'all_spot_top_sell_5m', 'all_spot_per'],
      side: 'confidence',
      baseWeight: 41,
      scale: 'fixed',
      maxContribution: 41,
      reasonTemplate: 'Spot flow family'
    },
    {
      ruleKey: 'flow_derivatives_family',
      feedKeys: ['all_derivatives_top_buy_5m', 'all_derivatives_top_sell_5m', 'all_derivatives_per'],
      side: 'confidence',
      baseWeight: 29,
      scale: 'fixed',
      maxContribution: 29,
      reasonTemplate: 'Derivatives flow family'
    },
    {
      ruleKey: 'flow_top_oi_family',
      feedKeys: ['top_oi_gainers_60m', 'top_oi_losers_60m'],
      side: 'confidence',
      baseWeight: 12,
      scale: 'fixed',
      maxContribution: 12,
      reasonTemplate: 'Top OI family'
    },
    {
      ruleKey: 'flow_big_activity_family',
      feedKeys: ['cex_track', 'flows_alert'],
      side: 'confidence',
      baseWeight: 18,
      scale: 'fixed',
      maxContribution: 18,
      reasonTemplate: 'Big activity family'
    }
  ]
};

export function scoreConfigForVersion(version: string): ScoreConfig {
  if (version === flowV2ScoreConfig.version) {
    return {
      ...flowV2ScoreConfig,
      rules: flowV2ScoreConfig.rules.map((rule) => ({ ...rule, feedKeys: [...rule.feedKeys] })),
      windows: flowV2ScoreConfig.windows.map((window) => ({ ...window }))
    };
  }

  return {
    ...defaultScoreConfig,
    rules: defaultScoreConfig.rules.map((rule) => ({ ...rule, feedKeys: [...rule.feedKeys] })),
    windows: defaultScoreConfig.windows.map((window) => ({ ...window })),
    version
  };
}
