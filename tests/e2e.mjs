// End-to-end check with Playwright. Run: node tests/e2e.mjs   (needs `playwright` + chromium; serves the repo itself)
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {extname, join, normalize} from 'node:path';
import {createRequire} from 'node:module';
import {startDevServer} from '../api/dev/server.mjs';
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
    if (transform) body = Buffer.from(transform(f, body.toString()));
    res.writeHead(200, {'content-type': TYPES[extname(f)] || 'application/octet-stream'}).end(body);
  } catch { res.writeHead(404).end(); }
}).listen(0);
const server = serve();
const base = `http://localhost:${server.address().port}/`;
const trackPosts = [];
const trackServer = serve((f, h) => f.endsWith('index.html') ? h.replace("const TRACK_URL = '';", "const TRACK_URL = '/__track';") : h, trackPosts);
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
  const ctx = await browser.newContext({...devices['iPhone 13'], reducedMotion: 'reduce'});   // no start-up spin, so positions hold still
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
    const gap = await page.evaluate(() => {   // a point inside the wheel area that no card covers (the wheel may be mid-spin, so look rather than assume)
      const r = document.getElementById('fanwrap').getBoundingClientRect();
      for (let y = r.top + 2; y < r.bottom - 2; y += 6) for (let x = r.left + 2; x < r.right - 2; x += 6) {
        const els = document.elementsFromPoint(x, y);
        if (els.some(e => e.id === 'fanwrap') && !els.some(e => e.classList?.contains('fc'))) return {x, y};
      }
      return null;
    });
    assert.ok(gap, 'the wheel area has a spot without a card');
    await page.mouse.click(gap.x, gap.y);   // miss
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

// ---- accounts: the real Worker (in-memory SQLite) behind the real pages ----
{
  const api = startDevServer({port: 0});
  const apiBase = `http://localhost:${api.address().port}`;
  const accServer = serve((f, h) => f.endsWith('scripts/config.mjs') ? h.replace("export const API_URL = '';", `export const API_URL = '${apiBase}';`) : h);
  const web = `http://localhost:${accServer.address().port}/`;
  api.setWebOrigin(`http://localhost:${accServer.address().port}`);
  api.env.GOOGLE_CLIENT_ID = 'dummy'; api.env.GOOGLE_CLIENT_SECRET = 'dummy';   // only so the Google button is listed
  const mails = async () => (await (await fetch(apiBase + '/__dev/mails')).json());
  const tokenIn = async kind => { for (const m of (await mails()).reverse()) { const t = m.text.match(new RegExp(`#${kind}=([\\w-]+)`)); if (t) return t[1]; } };

  for (const [label, ctxOpts] of [['phone', devices['iPhone 13']], ['desktop', {viewport: {width: 1280, height: 800}}]]) {
    const email = `e2e-${label}@example.com`, pw1 = 'first long passphrase', pw2 = 'second long passphrase';
    const ctx = await browser.newContext(ctxOpts);
    const page = await ctx.newPage();
    page.setDefaultTimeout(8000);   // fail fast with a readable message instead of hanging for 30 s per step
    const problems = [];
    page.on('pageerror', e => problems.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/fonts\.g|cloudflareinsights|ERR_TUNNEL|ERR_CONNECTION|Failed to load resource/.test(m.text())) problems.push('console: ' + m.text()); });
    page.on('dialog', d => d.accept());
    const noHScroll = async () => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'horizontal scroll');
    const openFresh = async url => { await page.goto('about:blank'); await page.goto(url); };   // an emailed link opens a new page; a same-page #fragment change would not reload

    await step(`account ${label}: sign-up form, verification link, sign-in`, async () => {
      await page.goto(web + 'account.html'); await page.waitForSelector('#guest:not([hidden])');
      assert.equal(await page.locator('#social-guest a').count(), 1, 'only the configured provider is offered');
      assert.match(await page.locator('#social-guest a').getAttribute('href'), /\/auth\/google\/start\?mode=login/);
      await noHScroll();
      await page.click('#tab-register');
      await page.fill('#rg-name', 'ทดสอบ'); await page.fill('#rg-email', email); await page.fill('#rg-pw', 'short');
      await page.check('#rg-terms');
      await page.fill('#rg-pw', pw1);
      await page.click('#f-register button[type=submit]');
      await page.waitForFunction(() => /ส่งอีเมลยืนยัน/.test(document.getElementById('msg').textContent));
      const token = await tokenIn('verify');
      assert.ok(token, 'verification mail was sent');
      await openFresh(web + 'account.html#verify=' + token);
      await page.waitForFunction(() => /ยืนยันอีเมลเรียบร้อย/.test(document.getElementById('msg').textContent));
      assert.equal(new URL(page.url()).hash, '', 'token removed from the address bar');
      await page.fill('#li-email', email); await page.fill('#li-pw', 'wrong password!!');
      await page.click('#f-login button[type=submit]');
      await page.waitForFunction(() => /ไม่ถูกต้อง/.test(document.getElementById('msg').textContent));
      await page.fill('#li-pw', pw1); await page.click('#f-login button[type=submit]');
      await page.waitForSelector('#member:not([hidden])');
      assert.match(await page.locator('#profile').innerText(), new RegExp(email.replace('.', '\\.')));
      assert.match(await page.locator('#profile').innerText(), /ยืนยันแล้ว/);
      await noHScroll();
    });

    await step(`account ${label}: signed-in home shows name and the card of the day`, async () => {
      await page.goto(web); await page.waitForSelector('#spreads input');
      await page.waitForFunction(() => document.getElementById('n-account').textContent === 'ทดสอบ');
      await page.waitForSelector('#dailybtn');
      assert.match(await page.locator('#dailybtn').innerText(), /ไพ่ประจำวันนี้/);
      await page.click('#dailybtn'); await page.waitForSelector('#dlg[open]');
      assert.match(await page.locator('#favbtn').innerText(), /เพิ่มเป็นไพ่โปรด/, 'signed-in users get the favourite button');
      await page.keyboard.press('Escape');
      await noHScroll();
    });

    await step(`account ${label}: save a reading with a note (consent asked first)`, async () => {
      await page.fill('#q', 'ความรัก'); await page.locator('#spreads input[value=single]').check({force: true});
      await page.click('#deckbtn'); await page.waitForSelector('#fan .fc', {state: 'attached'});
      await page.locator('#fan .fc').nth(30).dispatchEvent('click');
      await page.waitForSelector('#session:not([hidden])', {timeout: 8000});
      assert.match(await page.locator('#rsave').innerText(), /ยินยอมและบันทึก/);
      assert.match(await page.locator('#savebar').innerText(), /ความยินยอม/);
      await page.fill('#rnote', 'โน้ตของฉัน');
      await page.click('#rsave');
      await page.waitForFunction(() => /บันทึกลงประวัติแล้ว/.test(document.getElementById('savebar').textContent));
      await noHScroll();
    });

    await step(`account ${label}: favourite a card, then history and favourites on the account page`, async () => {
      await page.click('#n-cat'); await page.waitForSelector('#grid .tile');
      await page.locator('#grid .tile').first().click(); await page.waitForSelector('#favbtn');
      await page.click('#favbtn');
      await page.waitForFunction(() => document.getElementById('favbtn').getAttribute('aria-pressed') === 'true');
      await page.keyboard.press('Escape');
      await page.goto(web + 'account.html'); await page.waitForSelector('#member:not([hidden])');
      await page.click('#d-history summary');
      await page.waitForSelector('#history .item');
      assert.equal(await page.locator('#history textarea').inputValue(), 'โน้ตของฉัน');
      assert.match(await page.locator('#history .item').innerText(), /ความรัก/);
      await page.fill('#history textarea', 'แก้โน้ต'); await page.click('#history [data-note-save]');
      await page.waitForFunction(() => /บันทึกโน้ตแล้ว/.test(document.getElementById('msg').textContent));
      await page.click('#d-favs summary'); await page.waitForSelector('#favs .row');
      assert.equal(await page.locator('#favs .row').count(), 1);
      await page.reload(); await page.waitForSelector('#member:not([hidden])'); await page.click('#d-history summary'); await page.waitForSelector('#history .item');
      assert.equal(await page.locator('#history textarea').inputValue(), 'แก้โน้ต', 'note persisted on the server');
      assert.equal(await page.locator('#c-history').isChecked(), true);
      await noHScroll();
    });

    await step(`account ${label}: sign out, forgot password, reset link, new password`, async () => {
      await page.click('#logout'); await page.waitForSelector('#guest:not([hidden])');
      await openFresh(web + 'account.html#login=ok'); await page.waitForSelector('#guest:not([hidden])');
      await page.click('#to-forgot'); await page.fill('#fg-email', email); await page.click('#f-forgot button[type=submit]');
      await page.waitForFunction(() => /ส่งลิงก์ตั้งรหัสผ่านใหม่ให้แล้ว/.test(document.getElementById('msg').textContent));
      const token = await tokenIn('reset'); assert.ok(token);
      await openFresh(web + 'account.html#reset=' + token); await page.waitForSelector('#reset:not([hidden])');
      assert.equal(await page.locator('#guest').isVisible(), false);
      await page.fill('#rs-pw', pw2); await page.click('#f-reset button[type=submit]');
      await page.waitForFunction(() => /ตั้งรหัสผ่านใหม่แล้ว/.test(document.getElementById('msg').textContent));
      await page.waitForSelector('#guest:not([hidden])');
      await page.fill('#li-email', email); await page.fill('#li-pw', pw1); await page.click('#f-login button[type=submit]');
      await page.waitForFunction(() => /ไม่ถูกต้อง/.test(document.getElementById('msg').textContent));
      await page.fill('#li-pw', pw2); await page.click('#f-login button[type=submit]');
      await page.waitForSelector('#member:not([hidden])');
    });

    await step(`account ${label}: export my data and delete the account`, async () => {
      const [download] = await Promise.all([page.waitForEvent('download'), page.click('#export')]);
      const data = JSON.parse(await (await import('node:fs/promises')).readFile(await download.path(), 'utf8'));
      assert.equal(data.user.email, email); assert.equal(data.readings.length, 1); assert.equal(data.readings[0].note, 'แก้โน้ต'); assert.equal(data.favorites.length, 1);
      assert.ok(!JSON.stringify(data).includes('pbkdf2'));
      await page.click('#privacy summary');
      await page.fill('#dl-confirm', 'DELETE'); await page.fill('#dl-pw', 'wrong wrong wrong'); await page.click('#f-delete button[type=submit]');
      await page.waitForFunction(() => /รหัสผ่านไม่ถูกต้อง/.test(document.getElementById('msg').textContent));
      await page.fill('#dl-pw', pw2); await page.click('#f-delete button[type=submit]');
      await page.waitForSelector('#guest:not([hidden])');
      // within the 30-day grace period the right password brings the account back, with its data
      await page.fill('#li-email', email); await page.fill('#li-pw', 'wrong wrong wrong'); await page.click('#f-login button[type=submit]');
      await page.waitForFunction(() => /ไม่ถูกต้อง/.test(document.getElementById('msg').textContent));
      await page.fill('#li-pw', pw2); await page.click('#f-login button[type=submit]');
      await page.waitForSelector('#member:not([hidden])');
      await page.waitForFunction(() => /กู้คืนบัญชี/.test(document.getElementById('msg').textContent));
      await page.click('#d-history summary'); await page.waitForSelector('#history .item');
    });

    await step(`account ${label}: change the display name and see the devices that are signed in`, async () => {
      await page.click('#profile summary:has-text("เปลี่ยนชื่อที่แสดง")');
      await page.fill('#nm-new', 'ชื่อใหม่'); await page.click('#f-name button[type=submit]');
      await page.waitForFunction(() => /เปลี่ยนชื่อที่แสดงแล้ว/.test(document.getElementById('msg').textContent));
      assert.match(await page.locator('#profile').innerText(), /ชื่อใหม่/);
      await page.click('#d-devices summary'); await page.waitForSelector('#devices .row');
      assert.equal(await page.locator('#devices .row').count(), 1, 'only this browser is signed in');
      assert.match(await page.locator('#devices').innerText(), /เครื่องนี้/);
      assert.equal(await page.locator('#devices [data-revoke]').count(), 0, 'no button to revoke the current device here (use sign out)');
      await noHScroll();
    });

    await step(`account ${label}: no page or console errors`, async () => assert.deepEqual(problems, []));
    await ctx.close();
  }

  await step('account: without API_URL the account page says it is off and the home page shows no sign-in', async () => {
    const ctx = await browser.newContext(); const page = await ctx.newPage();
    await page.goto(base + 'account.html'); await page.waitForSelector('#off:not([hidden])');
    await page.goto(base); await page.waitForSelector('#spreads input');
    assert.equal(await page.locator('#n-account').isVisible(), false); assert.equal(await page.locator('#daily').isVisible(), false);
    await ctx.close();
  });
  accServer.close(); api.close();
}

await browser.close(); server.close(); trackServer.close();
console.log(failed ? `${failed} FAILED` : 'PASS: e2e (phone + desktop)');
process.exit(failed ? 1 : 0);
