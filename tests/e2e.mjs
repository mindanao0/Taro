// End-to-end check with Playwright. Run: node tests/e2e.mjs   (needs `playwright` + chromium; serves the repo itself)
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {extname, join, normalize} from 'node:path';
import {createRequire} from 'node:module';
const {chromium, devices} = createRequire(import.meta.url)('playwright');

const ROOT = new URL('..', import.meta.url).pathname;
const TYPES = {'.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.css': 'text/css'};
// transform: optionally rewrite index.html; posts: collects bodies POSTed to /__track
const serve = (transform, posts) => http.createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && req.url === '/__track') {
      let b = ''; for await (const c of req) b += c; posts?.push(JSON.parse(b)); return res.writeHead(204).end();
    }
    const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    const f = join(ROOT, p === '/' ? 'index.html' : p);
    let body = await readFile(f);
    if (transform && f.endsWith('index.html')) body = Buffer.from(transform(body.toString()));
    res.writeHead(200, {'content-type': TYPES[extname(f)] || 'application/octet-stream'}).end(body);
  } catch { res.writeHead(404).end(); }
}).listen(0);
const server = serve();
const base = `http://localhost:${server.address().port}/`;
const trackPosts = [];
const trackServer = serve(h => h.replace("const TRACK_URL = '';", "const TRACK_URL = '/__track';"), trackPosts);
const trackBase = `http://localhost:${trackServer.address().port}/`;

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

// ---- click-sequence tracking (opt-in) ----
{
  const ctx = await browser.newContext(devices['iPhone 13']);
  const page = await ctx.newPage();
  const flush = () => page.evaluate(() => dispatchEvent(new Event('pagehide')));
  await step('tracking: nothing sent without consent, even with TRACK_URL set', async () => {
    await page.goto(trackBase); await page.waitForSelector('#spreads input');
    assert.equal(await page.locator('#trackrow').isVisible(), true);
    await page.locator('#spreads input[value=single]').check({force: true});
    await flush(); await page.waitForTimeout(300);
    assert.equal(trackPosts.length, 0);
  });
  await step('tracking: records pick, undo, miss and kept in order, with positions and no typed text', async () => {
    await page.locator('#trackopt').check();
    await page.fill('#q', 'คำถามลับ-ห้ามรั่ว');
    await page.locator('#spreads input[value=single]').check({force: true});
    await page.click('#deckbtn'); await page.waitForSelector('#fan .fc', {state: 'attached'});
    await page.locator('#fan .fc').nth(30).dispatchEvent('click');          // pick
    await page.locator('#slots li.on .sl').first().dispatchEvent('click');  // undo via slot
    await page.locator('#fanwrap').click({position: {x: 3, y: 3}, force: true});   // miss: corner of the wheel area, no card
    await page.locator('#fan .fc').nth(32).dispatchEvent('click');          // pick again, kept
    await page.waitForSelector('#session:not([hidden])', {timeout: 8000});
    await flush(); await page.waitForTimeout(500);
    const ev = trackPosts.flatMap(b => b.events);
    const types = ev.map(e => e.type + (e.outcome !== 'ok' ? ':' + e.outcome : ''));
    const want = ['start_pick', 'pick', 'unpick:undone', 'miss_tap:miss', 'pick', 'pick_kept:kept', 'auto_open'];
    let at = 0; for (const t of types) if (t === want[at]) at++;
    assert.equal(at, want.length, 'sequence ' + types.join(','));
    assert.deepEqual(ev.map(e => e.seq), ev.map((_, i) => i + 1));
    assert.ok(ev.every((e, i) => i === 0 || e.t_ms >= ev[i - 1].t_ms));
    assert.ok(trackPosts[0].meta.viewport_w > 0 && trackPosts[0].sid);
    const miss = ev.find(e => e.type === 'miss_tap'); assert.ok(miss.x >= 0 && miss.rx >= 0 && miss.rx <= 1000, 'miss has a position');
    assert.ok(!JSON.stringify(trackPosts).includes('คำถามลับ'), 'typed question leaked into the tracking payload');
  });
  await step('tracking: unticking stops further sends', async () => {
    const n = trackPosts.length;
    await page.goto(trackBase); await page.waitForSelector('#trackopt');
    await page.locator('#trackopt').uncheck();
    await page.locator('#spreads input[value=three]').check({force: true});
    await flush(); await page.waitForTimeout(300);
    assert.equal(trackPosts.length, n);
  });
  await ctx.close();
}
await browser.close(); server.close(); trackServer.close();
console.log(failed ? `${failed} FAILED` : 'PASS: e2e (phone + desktop)');
process.exit(failed ? 1 : 0);
