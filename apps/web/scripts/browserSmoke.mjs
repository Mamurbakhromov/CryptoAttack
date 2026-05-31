import { chromium } from 'playwright';

const baseUrl = (process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3201').replace(/\/$/, '');
const checks = [
  ['/bull', 'Top Spot'],
  ['/price-alerts', 'Price Alerts'],
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

  if (issues.length) {
    throw new Error(issues.join('\n'));
  }

  console.log('browser-smoke-ok');
} finally {
  await browser.close();
}
