/**
 * Visual smoke test: drives the real UI in Edge and screenshots each screen.
 * Run with the API (:3000) and Vite (:5173) already up.
 *
 *   node scripts/screenshots.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.WEB_URL ?? 'http://localhost:5173';
const OUT = 'screenshots';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
const page = await context.newPage();

const errors = [];
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));

async function shot(name, options = {}) {
  await page.waitForTimeout(options.settle ?? 900);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: options.fullPage ?? false });
  console.log(`  captured ${name}.png`);
}

console.log('\nWeb UI walkthrough\n');

// Login
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await shot('01-login');

await page.fill('#email', 'owner@gymlytics.test');
await page.fill('#password', 'Password123!');
await page.fill('#slug', 'gymlytics-demo');
await page.click('button[type=submit]');
await page.waitForURL('**/admin', { timeout: 15000 });
await page.waitForTimeout(1500);
await shot('02-dashboard', { fullPage: true });

// Members
await page.goto(`${BASE}/admin/members`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await shot('03-members', { fullPage: true });

// Member detail — open the first member
const openButton = page.locator('table tbody tr').first().locator('a', { hasText: 'Open' });
if (await openButton.count()) {
  await openButton.first().click();
  await page.waitForTimeout(1800);
  await shot('04-member-detail', { fullPage: true });
}

// Schedule
await page.goto(`${BASE}/admin/schedule`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await shot('05-schedule', { fullPage: true });

// Attendance
await page.goto(`${BASE}/admin/attendance`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await shot('06-attendance', { fullPage: true });

// Promotions
await page.goto(`${BASE}/admin/promotions`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await shot('07-promotions', { fullPage: true });

// Billing
await page.goto(`${BASE}/admin/billing`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await shot('08-billing', { fullPage: true });

// POS
await page.goto(`${BASE}/admin/pos`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await shot('09-pos', { fullPage: true });

// Programs
await page.goto(`${BASE}/admin/programs`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await shot('10-programs', { fullPage: true });

// Waivers
await page.goto(`${BASE}/admin/waivers`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await shot('11-waivers', { fullPage: true });

// Kiosk — pair and check in
const kiosk = await context.newPage();
kiosk.on('pageerror', (error) => errors.push(`kiosk pageerror: ${error.message}`));
await kiosk.goto(`${BASE}/kiosk`, { waitUntil: 'networkidle' });
await kiosk.waitForTimeout(1200);
await kiosk.screenshot({ path: `${OUT}/12-kiosk-pairing.png` });
console.log('  captured 12-kiosk-pairing.png');

await kiosk.fill('#k-slug', 'gymlytics-demo');
await kiosk.fill('#k-device', 'kiosk-lobby-01');
await kiosk.fill('#k-key', 'dev-kiosk-key');
await kiosk.click('button[type=submit]');
await kiosk.waitForTimeout(4000);
await kiosk.screenshot({ path: `${OUT}/13-kiosk-ready.png` });
console.log('  captured 13-kiosk-ready.png');

// Exercise a real check-in on the kiosk: PIN 1234 belongs to the owner.
for (const digit of ['1', '2', '3', '4']) {
  await kiosk.locator('button', { hasText: new RegExp(`^${digit}$`) }).first().click();
  await kiosk.waitForTimeout(350);
}
await kiosk.waitForTimeout(2500);
await kiosk.screenshot({ path: `${OUT}/13b-kiosk-checkin.png` });
console.log('  captured 13b-kiosk-checkin.png');

// Waiver tablet
const waiver = await context.newPage();
waiver.on('pageerror', (error) => errors.push(`waiver pageerror: ${error.message}`));
await waiver.goto(`${BASE}/waiver`, { waitUntil: 'networkidle' });
await waiver.waitForTimeout(2000);
await waiver.screenshot({ path: `${OUT}/14-waiver.png`, fullPage: true });
console.log('  captured 14-waiver.png');

await browser.close();

if (errors.length) {
  console.log('\nConsole errors:');
  for (const error of [...new Set(errors)].slice(0, 20)) console.log(`  ! ${error}`);
  process.exitCode = 1;
} else {
  console.log('\nNo console errors.');
}
