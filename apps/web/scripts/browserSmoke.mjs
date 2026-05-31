import { chromium } from 'playwright';

const baseUrl = (process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3201').replace(/\/$/, '');
const checks = [
  ['/bull', 'Top Spot'],
  ['/price-alerts', 'Price Alerts'],
  ['/scores', 'Scores'],
  ['/flows', 'Flows'],
  ['/funding', 'Funding'],
  ['/onchain-alpha', 'Onchain / Alpha'],
  ['/coins', 'Exchange Coins']
];

const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage();
  const issues = [];

  page.on('pageerror', (error) => {
    issues.push(`pageerror:${error.message}`);
  });

  page.on('console', (message) => {
    if (message.type() === 'error') issues.push(`console:${message.text()}`);
  });

  for (const [path, heading] of checks) {
    await page.goto(`${baseUrl}${path}`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: heading, level: 1 }).waitFor({ timeout: 10_000 });
  }

  await page.goto(`${baseUrl}/bull`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /Coins:/ }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Binance' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Spot', exact: true }).click();
  await page.getByRole('button', { name: /Coins:.*Binance.*Spot/ }).waitFor({ timeout: 10_000 });
  await page.mouse.click(8, 8);
  await page.getByRole('menu').waitFor({ state: 'detached', timeout: 10_000 });

  await page.waitForTimeout(750);

  await mockScoreApis(page);
  await page.goto(`${baseUrl}/scores`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Scores', level: 1 }).waitFor({ timeout: 10_000 });
  await page.getByRole('button', { name: /Coins:/ }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Binance' }).waitFor({ timeout: 10_000 });
  await page.mouse.click(8, 8);
  await page.getByRole('menu').waitFor({ state: 'detached', timeout: 10_000 });
  await page.getByRole('heading', { name: /Top 5 Bull|Market Regime|Score Health/ }).first().waitFor({ timeout: 10_000 });
  await page.getByRole('button', { name: 'BTC' }).first().waitFor({ timeout: 10_000 });
  await page.getByText('Upward price alert').first().waitFor({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Detail' }).first().click();
  await page.getByRole('dialog', { name: /BTC score detail/i }).waitFor({ timeout: 10_000 });
  const spotBreakdown = page.getByLabel('Spot breakdown');
  await spotBreakdown.waitFor({ timeout: 10_000 });
  await spotBreakdown.getByText('Bull Pressure', { exact: true }).waitFor({ timeout: 10_000 });
  await page.getByLabel('Spot Bull pressure bar').waitFor({ timeout: 10_000 });
  await spotBreakdown.getByText('32.05').waitFor({ timeout: 10_000 });
  await spotBreakdown.getByText('Thin cap').waitFor({ timeout: 10_000 });

  if (issues.length) {
    throw new Error(issues.join('\n'));
  }

  console.log('browser-smoke-ok');
} finally {
  await browser.close();
}

async function mockScoreApis(page) {
  const generatedAt = new Date().toISOString();
  const btcScore = {
    coin: 'BTC',
    scoreConfigVersion: 'flow-v2',
    windowMinutes: 5,
    latestScoreTs: generatedAt,
    bullScore: 82,
    bearScore: 14,
    netScore: 68,
    confidenceScore: 91,
    rank: 1,
    updatedAt: generatedAt,
    dominantSignal: 'price_alert_up',
    marketRegime: 'bullish',
    primaryReason: 'Upward price alert',
    riskTags: ['positive_funding_overheated'],
    evidenceSummary: { total: 2, topRuleKeys: ['price_alert_up'], feedKeys: ['pricealerts', 'all_spot_top_buy_5m'], sides: ['bull', 'risk'] },
    recentScoreDelta: 12.5,
    scoreState: 'clean_bull',
    tradeAction: 'LONG_WATCH',
    componentScores: {
      spot: { bull: 32.05, bear: 3.4 },
      derivatives: { bull: 15.8, bear: 2.25 },
      topOi: { bull: 8.05, bear: 1.5 },
      bigActivity: { bull: 10.5, bear: 0 }
    },
    flowBreakdown: [
      { family: 'spot', side: 'bull', score: 32.05, rawScore: 34.2, maxScore: 35, multiplier: 0.94, effectiveHits: 4, thinLiquidity: false },
      { family: 'spot', side: 'bear', score: 3.4, rawScore: 4, maxScore: 35, multiplier: 0.85, effectiveHits: 1, thinLiquidity: true },
      { family: 'derivatives', side: 'bull', score: 15.8, rawScore: 20, maxScore: 25, multiplier: 0.79, effectiveHits: 2, thinLiquidity: false },
      { family: 'derivatives', side: 'bear', score: 2.25, rawScore: 7.5, maxScore: 25, multiplier: 0.3, effectiveHits: 1, thinLiquidity: false },
      { family: 'topOi', side: 'bull', score: 8.05, rawScore: 8.05, maxScore: 10, multiplier: 1, effectiveHits: 1, thinLiquidity: false },
      { family: 'topOi', side: 'bear', score: 1.5, rawScore: 1.5, maxScore: 10, multiplier: 1, effectiveHits: 1, thinLiquidity: false },
      { family: 'bigActivity', side: 'bull', score: 10.5, rawScore: 10.5, maxScore: 15, multiplier: 1, effectiveHits: 2, thinLiquidity: false },
      { family: 'bigActivity', side: 'bear', score: 0, rawScore: 0, maxScore: 15, multiplier: 1, effectiveHits: 0, thinLiquidity: false }
    ]
  };
  const ethScore = { ...btcScore, coin: 'ETH', bullScore: 12, bearScore: 76, netScore: -64, marketRegime: 'bearish', primaryReason: 'Derivatives sell pressure', riskTags: [], recentScoreDelta: -7.4, evidenceSummary: { total: 1, topRuleKeys: ['derivatives_sell_pressure'], feedKeys: ['all_derivatives_top_sell_5m'], sides: ['bear'] } };
  const baseList = (kind, side, scores) => ({
    generatedAt,
    enabled: true,
    kind,
    scoreConfigVersion: 'flow-v2',
    windowMinutes: 5,
    side,
    limit: scores.length,
    filters: { minConfidence: 50, halal: null, exchange: null, market: null, updatedSince: null },
    total: scores.length,
    scores
  });

  await page.route('**/api/scoring/config/current*', (route) => fulfillJson(route, {
    generatedAt,
    storageBacked: true,
    config: {
      scoreConfigVersion: 'flow-v2',
      description: 'Smoke scoring config',
      active: true,
      activatedAt: generatedAt,
      retiredAt: null,
      windows: [5, 15, 60].map((minutes) => ({ minutes, halfLifeMinutes: minutes, maxAgeMinutes: minutes * 2 })),
      sideSaturation: 100,
      materialChange: {},
      confidence: {},
      burst: { threshold: 3, maxBonus: 8 },
      rules: []
    }
  }));

  await page.route('**/api/scores/**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/scores/top') {
      const side = url.searchParams.get('side') || 'net';
      return fulfillJson(route, baseList('top', side, side === 'bear' ? [ethScore] : [btcScore]));
    }
    if (url.pathname === '/api/scores/current') return fulfillJson(route, baseList('current', 'net', [btcScore, ethScore]));
    if (url.pathname === '/api/scores/market-regime') {
      return fulfillJson(route, {
        generatedAt,
        enabled: true,
        scoreConfigVersion: 'flow-v2',
        windowMinutes: 5,
        side: 'net',
        limit: 500,
        filters: { minConfidence: 50, halal: null, exchange: null, market: null, updatedSince: null },
        sampledCoins: 2,
        regime: 'conflicted',
        bullishCoinCount: 1,
        bearishCoinCount: 1,
        mixedCount: 0,
        quietCount: 0,
        averageConfidence: 88,
        averageBullScore: 47,
        averageBearScore: 45,
        averageNetScore: 2,
        topSector: null,
        topCategory: null,
        dataFreshness: { latestScoreTs: generatedAt, oldestScoreTs: generatedAt, latestAgeSeconds: 1 },
        leaders: { bull: [btcScore], bear: [ethScore], net: [btcScore] }
      });
    }
    if (url.pathname === '/api/scores/BTC') return fulfillJson(route, { ...baseList('current', 'net', [btcScore]), coin: 'BTC', score: btcScore });
    if (url.pathname === '/api/scores/BTC/timeline') return fulfillJson(route, { ...baseList('current', 'net', [btcScore]), coin: 'BTC', snapshots: [{ scoreSnapshotId: 'score-smoke-1', ts: generatedAt, ...btcScore, eventCount: 2, evidenceCount: 2, previousNetScore: 55, netScoreDelta: 13, scoreHash: 'score-hash', evidenceHash: 'evidence-hash', computedAt: generatedAt }] });
    if (url.pathname === '/api/scores/BTC/evidence') return fulfillJson(route, { ...baseList('current', 'net', [btcScore]), coin: 'BTC', evidence: [{ evidenceKey: 'evidence-smoke-1', scoreSnapshotId: 'score-smoke-1', scoreTs: generatedAt, windowMinutes: 15, coin: 'BTC', eventId: 'event-smoke-1', eventReceivedAt: generatedAt, entryId: 'entry-smoke-1', feedKey: 'pricealerts', signalKey: 'price_alert_up', ruleKey: 'price_alert_up', side: 'bull', contribution: 22, confidenceImpact: 4, weight: 10, decayMultiplier: 1, value: 4.2, unit: 'percent', reason: 'Upward price alert', source: 'entry', sourceEventIds: ['event-smoke-1'], sourceReceivedAt: generatedAt, payload: { exchange: 'binance', market: 'spot' } }] });
    return route.fallback();
  });
}

function fulfillJson(route, body) {
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body)
  });
}
