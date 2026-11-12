// Accessibility check with axe-core (WCAG 2.0/2.1 A and AA) on the real pages, phone and desktop, in the states a visitor reaches.
// Run: node tests/a11y.mjs      Needs playwright and axe-core (npm install). AXE_PATH can point at axe.min.js.
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {extname, join, normalize} from 'node:path';
import {createRequire} from 'node:module';
import {startDevServer} from '../api/dev/server.mjs';

const require = createRequire(import.meta.url);
const {chromium, devices} = require('playwright');
const AXE = process.env.AXE_PATH || require.resolve('axe-core/axe.min.js');

const ROOT = new URL('..', import.meta.url).pathname;
const TYPES = {'.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.css': 'text/css'};
const apiBase = {value: ''};
const web = http.createServer(async (req, res) => {
  try {
    const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    const f = join(ROOT, p === '/' ? 'index.html' : p);
    let body = await readFile(f);
    if (f.endsWith('scripts/config.mjs') && apiBase.value) body = Buffer.from(body.toString().replace("export const API_URL = '';", `export const API_URL = '${apiBase.value}';`));
    res.writeHead(200, {'content-type': TYPES[extname(f)] || 'application/octet-stream'}).end(body);
  } catch { res.writeHead(404).end(); }
}).listen(0);
const origin = `http://localhost:${web.address().port}`;
const api = startDevServer({port: 0, webOrigin: origin});
api.env.GOOGLE_CLIENT_ID = 'x'; api.env.GOOGLE_CLIENT_SECRET = 'x'; api.env.LINE_CHANNEL_ID = 'x'; api.env.LINE_CHANNEL_SECRET = 'x';
const apiUrl = `http://localhost:${api.address().port}`;

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {})   // CHROMIUM_PATH: use a browser that is already installed;
let failed = 0, checked = 0;

// Interactive elements should be at least 44x44 px (phone). Exempt: inline links inside a sentence, and form controls whose <label> is big enough.
async function targets(page, name) {
  const small = await page.evaluate(() => [...document.querySelectorAll('a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button]')].filter(e => e.offsetParent && !e.closest('[hidden]')).map(e => {
    const box = (e.labels?.[0] ?? e).getBoundingClientRect(), own = e.getBoundingClientRect();
    const inline = e.tagName === 'A' && getComputedStyle(e).display === 'inline' && e.parentElement.textContent.trim().length > e.textContent.trim().length + 8;
    const r = ['checkbox', 'radio'].includes(e.type) ? box : own;
    return {inline, h: Math.round(r.height), w: Math.round(r.width), id: (e.id || e.className || e.tagName) + ' "' + (e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 20) + '"'};
  }).filter(x => !x.inline && (x.h < 44 || x.w < 44)));
  checked++;
  if (small.length) { failed++; console.log(`FAIL ${name}: tap targets under 44px`); small.slice(0, 12).forEach(x => console.log(`        ${x.h}x${x.w} ${x.id}`)); }
  else console.log(`ok   ${name}: tap targets`);
}

async function audit(page, name) {
  await page.addScriptTag({path: AXE});
  const result = await page.evaluate(async () => {
    const r = await axe.run(document, {runOnly: {type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']}, resultTypes: ['violations']});
    return r.violations.map(v => ({id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, first: v.nodes.slice(0, 3).map(n => n.target.join(' ') + ' :: ' + (n.failureSummary || '').split('\n').slice(1, 3).join(' ').slice(0, 160))}));
  });
  checked++;
  if (result.length) { failed++; console.log(`FAIL ${name}`); for (const v of result) console.log(`     [${v.impact}] ${v.id}: ${v.help} (${v.nodes} element${v.nodes > 1 ? 's' : ''})\n        ${v.first.join('\n        ')}`); }
  else console.log(`ok   ${name}`);
}

for (const [label, ctxOpts] of [['phone', devices['iPhone 13']], ['desktop', {viewport: {width: 1280, height: 800}}]]) {
  const ctx = await browser.newContext({...ctxOpts, reducedMotion: 'reduce'});
  const page = await ctx.newPage(); page.setDefaultTimeout(10000);

  // ---- the public site, no account features
  apiBase.value = '';
  await page.goto(origin + '/'); await page.waitForSelector('#spreads input');
  if (label === 'desktop') {   // keyboard only: type a question, choose a layout, start, pick with Enter, take it back with Enter
    checked++;
    try {
      await page.focus('#q'); await page.keyboard.type('ทดสอบ');
      await page.keyboard.press('Tab'); assert.equal(await page.evaluate(() => document.activeElement.name), 'spread', 'Tab moves from the question to the layouts');
      await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowRight');
      assert.equal(await page.evaluate(() => document.querySelector('input[name=spread]:checked').value), 'three', 'arrow keys change the layout');
      await page.focus('#deckbtn'); await page.keyboard.press('Enter');
      await page.waitForSelector('#fan .fc', {state: 'attached'});
      await page.keyboard.press('ArrowRight');   // spins the wheel without a mouse
      let guard = 0;
      while (!(await page.evaluate(() => document.activeElement?.classList.contains('fc'))) && guard++ < 120) await page.keyboard.press('Tab');
      assert.ok(guard < 120, 'a card can be reached with Tab');
      assert.ok(await page.evaluate(() => { const s = getComputedStyle(document.activeElement); return s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2; }), 'the focused card shows a focus ring');
      await page.keyboard.press('Enter');
      assert.equal(await page.locator('#fan .fc.picked').count(), 1, 'Enter picks the focused card');
      assert.match(await page.locator('#pstep').innerText(), /ตำแหน่งที่ 2/, 'the step text moves on (read out as a live region)');
      await page.waitForFunction(() => document.activeElement?.classList.contains('picked'));   // CI is slower: let focus settle on the picked card before undoing
      await page.keyboard.press('Enter');
      assert.equal(await page.locator('#fan .fc.picked').count(), 0, 'Enter on a picked card puts it back');
      console.log('ok   desktop: keyboard-only pick and undo');
    } catch (e) { failed++; console.log('FAIL desktop: keyboard-only pick:', e.message.split('\n')[0]); }
    await page.goto(origin + '/'); await page.waitForSelector('#spreads input');
  }
  await audit(page, `${label}: home`);
  if (label === 'phone') await targets(page, `${label}: home`);
  await page.fill('#q', 'ทดสอบ'); await page.click('#deckbtn'); await page.waitForSelector('#fan .fc', {state: 'attached'});
  await audit(page, `${label}: picking cards`);
  await page.locator('#fan .fc').nth(30).dispatchEvent('click');
  await page.locator('#fan .fc').nth(38).dispatchEvent('click');
  await page.locator('#fan .fc').nth(46).dispatchEvent('click');
  await page.waitForSelector('#session:not([hidden])', {timeout: 8000});
  await page.locator('#table .card').first().click(); await page.waitForSelector('#chapters *');
  await audit(page, `${label}: a reading`);
  await page.click('#n-cat'); await page.waitForSelector('#grid .tile');
  await audit(page, `${label}: catalogue`);
  await page.locator('#grid .tile').first().click(); await page.waitForSelector('#dlg[open]');
  await audit(page, `${label}: card dialog`);
  await page.keyboard.press('Escape');
  for (const f of ['privacy.html', 'terms.html']) { await page.goto(`${origin}/${f}`); await audit(page, `${label}: ${f}`); if (label === 'phone') await targets(page, `${label}: ${f}`); }

  // ---- account pages against the real Worker
  apiBase.value = apiUrl;
  await page.goto(origin + '/account.html'); await page.waitForSelector('#guest:not([hidden])');
  await audit(page, `${label}: sign in`);
  if (label === 'phone') await targets(page, `${label}: sign in`);
  await page.click('#tab-register'); await audit(page, `${label}: sign up`);
  await page.click('#tab-login'); await page.click('#to-forgot'); await audit(page, `${label}: forgot password`);
  await page.click('#from-forgot'); await page.click('#tab-register');
  const email = `a11y-${label}@example.com`;
  await page.fill('#rg-email', email); await page.fill('#rg-pw', 'first long passphrase'); await page.check('#rg-terms'); await page.click('#f-register button[type=submit]');
  await page.waitForFunction(() => /ส่งอีเมลยืนยัน/.test(document.getElementById('msg').textContent));
  await audit(page, `${label}: message after sign up`);
  await page.fill('#li-email', email); await page.fill('#li-pw', 'first long passphrase'); await page.click('#f-login button[type=submit]');
  await page.waitForSelector('#member:not([hidden])');
  for (const s of ['#profile summary', '#methods summary', '#privacy summary', '#d-devices summary']) for (const el of await page.locator(s).all()) await el.click();
  await page.waitForTimeout(400);
  await audit(page, `${label}: member page with everything open`);
  if (label === 'phone') await targets(page, `${label}: member page`);
  await page.goto(origin + '/'); await page.waitForSelector('#dailybtn');
  await audit(page, `${label}: home when signed in`);
  await ctx.close();
}

await browser.close(); web.close(); api.close();
console.log(failed ? `${failed} of ${checked} audits FAILED` : `PASS: no WCAG A/AA violations in ${checked} audits (phone + desktop)`);
process.exit(failed ? 1 : 0);
