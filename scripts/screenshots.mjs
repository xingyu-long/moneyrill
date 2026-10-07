// Takes the README screenshots of the demo app (2x pixel density, 3x for phones) and saves them as WebP.
//
// Playwright is deliberately NOT a dependency of this project. Install it once, outside the repository:
//   mkdir -p ~/Library/Caches/moneyrill-screenshots && cd ~/Library/Caches/moneyrill-screenshots   (Linux: ~/.cache/...)
//   npm init -y && npm i playwright && npx playwright install chromium
// Also needs `cwebp` (brew install webp / apt install webp). Then, with the demo app running on port 3002:
//   ./scripts/deploy.sh staging && node scripts/screenshots.mjs
//
// It refuses to run unless the app says it is in Sandbox mode, so it can never photograph real balances.
/* global process, fetch, console, localStorage, document */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const base = process.env.BASE_URL || 'http://localhost:3002';
const out = path.resolve('docs/screenshots');
const quality = process.env.WEBP_QUALITY || '90';
const toolsDir =
  process.env.PLAYWRIGHT_DIR ||
  path.join(
    os.homedir(),
    process.platform === 'darwin' ? 'Library/Caches' : '.cache',
    'moneyrill-screenshots',
  );

let chromium;
try {
  ({ chromium } = createRequire(path.join(toolsDir, 'package.json'))('playwright'));
} catch {
  throw new Error(
    `Playwright is not installed in ${toolsDir}. See the setup steps at the top of this file.`,
  );
}
const health = await fetch(`${base}/api/health`)
  .then((r) => r.json())
  .catch(() => null);
if (!health || health.mode !== 'sandbox')
  throw new Error(
    `${base} is not a running Sandbox (demo) app (health said ${JSON.stringify(health)}). No screenshots taken.`,
  );
try {
  execFileSync('cwebp', ['-version'], { stdio: 'ignore' });
} catch {
  throw new Error('cwebp is not installed (brew install webp).');
}

fs.mkdirSync(out, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'moneyrill-shots-'));
const browser = await chromium.launch();

async function shoot(name, route, opts, ready) {
  const context = await browser.newContext({
    viewport: { width: opts.width, height: opts.height },
    deviceScaleFactor: opts.scale,
    isMobile: opts.mobile,
    hasTouch: opts.mobile,
    colorScheme: opts.theme,
    reducedMotion: 'reduce', // the app draws charts without animation, so every capture is the finished picture
  });
  await context.addInitScript((theme) => {
    localStorage.setItem('moneyrill.theme', theme);
    localStorage.removeItem('moneyrill.private');
  }, opts.theme);
  const page = await context.newPage();
  await page.goto(base + route, { waitUntil: 'networkidle' });
  await ready(page);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
  const png = path.join(tmp, `${name}.png`);
  await page.screenshot({ path: png });
  execFileSync('cwebp', [
    '-q',
    quality,
    '-m',
    '6',
    '-quiet',
    png,
    '-o',
    path.join(out, `${name}.webp`),
  ]);
  await context.close();
  const kb = Math.round(fs.statSync(path.join(out, `${name}.webp`)).size / 1024);
  console.log(`${name}.webp  ${opts.width * opts.scale}x${opts.height * opts.scale}  ${kb} KB`);
}

const chart = (page) => page.locator('svg.recharts-surface').first().waitFor();
const list = (page) => page.getByRole('button', { name: 'Add transaction' }).waitFor();
const desktop = { width: 1360, height: 850, scale: 2, theme: 'light' };
await shoot('home', '/home', desktop, chart);
await shoot('accounts', '/accounts', desktop, chart);
await shoot('investments', '/investments', desktop, chart);
await shoot('reports', '/reports/cash-flow', desktop, chart);
await shoot('transactions', '/transactions', desktop, list);

const phone = { width: 390, height: 844, scale: 3, theme: 'dark', mobile: true };
await shoot('mobile-home', '/home', phone, chart);
await shoot('mobile-transactions', '/transactions', phone, list);
// the detail sheet: open the first transaction, as a finger would
await shoot('mobile-transaction', '/transactions', phone, async (page) => {
  await list(page);
  // a posted transaction, not a pending one (a pending one says it cannot be edited yet)
  await page
    .locator('section[aria-label] button:not([aria-label])', { hasText: 'Morning Roast' })
    .first()
    .click();
  await page.getByRole('dialog').waitFor();
});
await shoot('mobile-accounts', '/accounts', phone, chart);

await browser.close();
fs.rmSync(tmp, { recursive: true, force: true });
