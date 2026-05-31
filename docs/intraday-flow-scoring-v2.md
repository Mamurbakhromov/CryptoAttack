# Intraday Flow Scoring V2

`flow-v2` scores short-horizon CryptoAttack flow for 2-4 hour intraday decisions. It is a decision-support score, not an execution system.

## Model Shape

Each coin/window gets four directional component families:

| Family | Max | Role |
| --- | ---: | --- |
| Spot flow | 41 | Primary directional anchor |
| Derivatives flow | 29 | Confirmation, acceleration, or hedge/noise |
| Top OI | 12 | Sparse confirmation only |
| Big buying/selling | 18 | Large activity confirmation |

Raw max per side is 100:

```text
bullScore = bullRaw
bearScore = bearRaw
netScore = bullScore - bearScore
```

Spot top and spot percent are the same family. The engine scores the best same-side row and adds 1h hit points once, so a coin appearing in both feeds confirms persistence without double-counting the whole move.

## Spot Flow, Max 41

For buys, dominance is `buyUsd / sellUsd`. For sells, dominance is `sellUsd / buyUsd`.

```text
spot = min(dominance + relativeImpact + delta + rank + 1hHits, volume24hCap, activityCap, 41)
relativeImpact = abs(deltaUsd) / volume24hUsd * 100
activity = buyUsd + sellUsd
```

| B/S or S/B | Points |
| --- | ---: |
| <1.10 | 0 |
| 1.10-1.20 | 2.10 |
| 1.20-1.35 | 4.20 |
| 1.35-1.50 | 6.30 |
| 1.50-1.75 | 8.40 |
| 1.75-2.00 | 10.50 |
| 2.00-2.50 | 13.65 |
| 2.50-3.00 | 15.75 |
| 3.00-4.00 | 17.85 |
| 4.00-6.00 | 19.43 |
| 6.00-10.00 | 20.48 |
| 10.00+ | 21 |

Relative impact points are capped at 8: `<0.05%=0`, `0.05-0.10=1.03`, `0.10-0.25=2.06`, `0.25-0.50=3.54`, `0.50-1.00=5.03`, `1.00-2.00=6.51`, `2.00-4.00=7.54`, `4.00+=8`.

Delta points are capped at 3.5: `<$25k=0`, `$25k-$75k=0.58`, `$75k-$200k=1.17`, `$200k-$500k=2.04`, `$500k-$1.5M=2.92`, `$1.5M+=3.5`.

Rank points are `((11 - rank) / 10) * 2.5`.

1h effective hits:

```text
effectiveHits = sameSideSpotHits60m - oppositeSideSpotHits60m
<=1=0, 2=1.8, 3=3.6, 4=4.8, 5+=6
```

Liquidity caps prevent big-cap delta and micro-cap fake dominance from dominating:

| Vol24 | Cap |
| --- | ---: |
| <$100k | 7 |
| $100k-$500k | 14 |
| $500k-$2M | 26 |
| $2M+ | 41 |

| Buy+Sell | Cap |
| --- | ---: |
| <$10k | 6 |
| $10k-$50k | 14 |
| $50k-$200k | 28 |
| $200k+ | 41 |

## Derivatives, OI, And Big Activity

Derivatives use their own thresholds because derivatives volume is naturally larger than spot. Derivatives are discounted when spot does not confirm:

Derivatives max is 29: dominance max 13, relative impact max 6, delta max 2.5, rank max 2.5, and 1h hits max 5.

| Derivatives B/S or S/B | Points |
| --- | ---: |
| <1.10 | 0 |
| 1.10-1.25 | 1.18 |
| 1.25-1.50 | 2.95 |
| 1.50-2.00 | 5.91 |
| 2.00-3.00 | 8.27 |
| 3.00-5.00 | 10.64 |
| 5.00-8.00 | 11.82 |
| 8.00+ | 13 |

Derivatives relative impact points are capped at 6: `<0.05%=0`, `0.05-0.15=0.90`, `0.15-0.35=1.80`, `0.35-0.75=3.00`, `0.75-1.50=4.20`, `1.50-3.00=5.40`, `3.00+=6`.

Derivatives delta points are capped at 2.5: `<$50k=0`, `$50k-$200k=0.63`, `$200k-$750k=1.25`, `$750k-$2M=1.88`, `$2M+=2.5`.

Derivatives volume and activity caps are both `6 / 12 / 21 / 29` across their existing liquidity buckets.

| Spot context | Multiplier |
| --- | ---: |
| Same-side spot >= 12 | 1.00 |
| Same-side spot 6-12 | 0.85 |
| Both spot sides < 6 | 0.70 |
| Opposite-side spot >= 12 | 0.30 |

Top OI is sparse confirmation. A missing top OI event is always 0 points, not a penalty. OI gainers are bull evidence; OI losers are bear evidence. Opposite price movement adds `top_oi_price_conflict`.

Top OI max is 12: OI percent max 6, price confirmation max 3.5, rank max 1, and repeat hit bonus max 1.5.

| OI change | Points |
| --- | ---: |
| <2% | 0 |
| 2-5% | 1.80 |
| 5-10% | 3.60 |
| 10-20% | 5.10 |
| 20%+ | 6 |

Price confirmation is `3.5` when price agrees with the OI side, `1.75` when price is unknown, and `0` when price conflicts with OI direction.

Big activity uses amount, relative impact, hits, and freshness. Standalone big activity is multiplied by `0.75`; same-side spot or derivatives confirmation uses `1.00`; opposite spot uses `0.30`.

Big activity max is 18: amount max 8.5, relative impact max 5, freshness max 1, and 1h hits max 3.5.

| Big activity amount | Points |
| --- | ---: |
| <$25k | 0 |
| $25k-$75k | 1.21 |
| $75k-$200k | 3.04 |
| $200k-$500k | 4.86 |
| $500k-$1M | 6.68 |
| $1M+ | 8.50 |

Big activity relative impact points are capped at 5: `<0.05%=0`, `0.05-0.25=1.25`, `0.25-0.75=2.50`, `0.75-1.50=3.75`, `1.50+=5`.

Freshness is `1` for `<=10 min`, `0.5` for `<=30 min`, and `0` when older. Big activity liquidity caps are `3.6 / 7.2 / 12 / 18` across the existing volume buckets.

## State And Action

`flow-v2` stores `scoreState`, `tradeAction`, `componentScores`, and `flowBreakdown` in score payloads and exposes them through score APIs.

Each active `flowBreakdown` row also carries the compact math needed by the score popup: `rawBeforeCap`, caps such as `volumeCap`, `activityCap`, or `liquidityCap`, `hitPoints`, and `subpoints`. The UI can therefore show both the additive formula and the final cap expression, for example `min(rawBeforeCap, volumeCap, activityCap, maxScore) = finalScore`.

States:

```text
clean_bull, clean_bear, derivatives_only_bull, derivatives_only_bear,
hedged_conflict, mixed, thin_liquidity, neutral
```

Actions:

```text
LONG_WATCH, SHORT_WATCH, WATCH, AVOID, NEUTRAL
```

Confidence is separate from score. It starts at 40 and adjusts for agreement, persistence, liquidity, freshness, and penalties for hedges, thin liquidity, parser sample gaps, derivatives-only signals, and top OI price conflict.
