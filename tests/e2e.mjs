// End-to-end check with Playwright. Run: node tests/e2e.mjs   (needs `playwright` + chromium; serves the repo itself)
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {extname, join, normalize} from 'node:path';
import {createRequire} from 'node:module';
const {chromium, devices} = createRequire(import.meta.url)('playwright');

const ROOT = new URL('..', import.meta.url).pathname;
const TYPES = {'.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.css': 'text/css'};
const server = http.createServer(async (req, res) => {
  try {
    const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    const f = join(ROOT, p === '/' ? 'index.html' : p);
    res.writeHead(200, {'content-type': TYPES[extname(f)] || 'application/octet-stream'}).end(await readFile(f));
  } catch { res.writeHead(404).end(); }
}).listen(0);
const base = `http://localhost:${server.address().port}/`;

const browser = await chromium.launch();
let failed = 0;
const step = async (name, fn) => { try { await fn(); console.log('ok  ', name); } catch (e) { failed++; console.log('FAIL', name, '\n    ', e.message.split('\n')[0]); } };

for (const [label, ctxOpts] of [['phone', devices['iPhone 13']], ['desktop', {viewport: {width: 1280, height: 800}}]]) {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  const problems = [];
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  page.on('requestfailed', r => { if (!/fonts\.g|cloudflareinsights/.test(r.url())) problems.push('requestfailed: ' + r.url()); });
  page.on('response', r => { if (r.status() >= 400 && !/fonts\.g|cloudflareinsights/.test(r.url())) problems.push(r.status() + ' ' + r.url()); });
  // the log endpoint must stay silent while LOG_URL is empty
  page.on('request', r => { if (r.method() === 'POST') problems.push('unexpected POST ' + r.url()); });
  const noHScroll = async () => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'horizontal scroll');

  await step(`${label}: home loads, no overflow`, async () => {
    await page.goto(base); await page.waitForSelector('#spreads input');
    await noHScroll();
    assert.ok(await page.locator('#spreads input').count() >= 4);
  });

  await step(`${label}: pick 3 cards and open the reading`, async () => {
    await page.fill('#q', 'ทดสอบ');
    await page.locator('#spreads input[value=three]').check({force: true});
    await page.click('#deckbtn');
    await page.waitForSelector('#fan .fc', {state: 'attached'});
    await noHScroll();
    for (let i = 0; i < 3; i++) {
      await page.locator('#fan .fc').nth(30 + i * 8).dispatchEvent('click');
    }
    await page.waitForSelector('#session:not([hidden])', {timeout: 8000});
    await noHScroll();
    assert.equal(await page.locator('#table .card').count(), 3);
    await page.locator('#table .card').first().click();
    await page.waitForSelector('#chapters *');
  });

  await step(`${label}: undo a pick`, async () => {
    await page.goto(base); await page.waitForSelector('#spreads input');
    await page.click('#deckbtn'); await page.waitForSelector('#fan .fc', {state: 'attached'});
    await page.locator('#fan .fc').nth(30).dispatchEvent('click');
    assert.equal(await page.locator('#slots li.on').count(), 1);
    await page.locator('#slots li.on .sl').first().dispatchEvent('click');
    assert.equal(await page.locator('#slots li.on').count(), 0);
  });

  await step(`${label}: catalogue search and dialog`, async () => {
    await page.goto(base); await page.click('#n-cat');
    await page.waitForSelector('#grid > *');
    assert.equal(await page.locator('#grid > *').count(), 78);
    await page.fill('#s', 'Moon');
    assert.ok(await page.locator('#grid > *').count() < 5);
    await page.locator('#grid > *').first().click();
    await page.waitForSelector('#dlg[open]');
    await page.keyboard.press('Escape');
    await noHScroll();
  });

  await step(`${label}: no console/network problems`, async () => assert.deepEqual(problems, []));
  await ctx.close();
}
await browser.close(); server.close();
console.log(failed ? `${failed} FAILED` : 'PASS: e2e (phone + desktop)');
process.exit(failed ? 1 : 0);
