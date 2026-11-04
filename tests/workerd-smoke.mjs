// Runs taro-api on Cloudflare's real Workers runtime (workerd, via `wrangler dev --local`) with a local D1, and walks the main flows over HTTP.
// This is what the SQLite-based unit tests cannot show: that the bundle starts, WebCrypto accepts our PBKDF2 count, and D1 accepts our SQL.
// Run: node tests/workerd-smoke.mjs      (needs wrangler: npm install)
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';

const root = new URL('..', import.meta.url).pathname, apiDir = root + 'api';
const wrangler = root + 'node_modules/wrangler/bin/wrangler.js';   // the package does not export this path, so it is located directly
if (!existsSync(wrangler)) { console.log('wrangler is not installed: run npm install'); process.exit(1); }
const PORT = 8790 + Math.floor(Math.random() * 100), B = `http://localhost:${PORT}`;
const ORIGIN = 'https://ivoryrosetarot.online';

const mig = spawnSync(process.execPath, [wrangler, 'd1', 'migrations', 'apply', 'taro', '--local'], {cwd: apiDir, encoding: 'utf8'});
assert.equal(mig.status, 0, 'local migrations failed:\n' + mig.stdout + mig.stderr);

const dev = spawn(process.execPath, [wrangler, 'dev', '--local', '--port', String(PORT), '--var', 'COOKIE_SECRET:smoke-cookie-secret-smoke-cookie-secret', '--var', 'DAILY_SECRET:smoke-daily-secret-smoke-daily-secret'],
  {cwd: apiDir, detached: true, stdio: ['ignore', 'pipe', 'pipe']});
let log = '';
dev.stdout.on('data', d => { log += d; }); dev.stderr.on('data', d => { log += d; });
const stop = () => { try { process.kill(-dev.pid, 'SIGKILL'); } catch { /* already gone */ } };
process.on('exit', stop);

let failed = 0;
const step = async (name, fn) => { try { await fn(); console.log('ok  ', name); } catch (e) { failed++; console.log('FAIL', name, '\n    ', String(e.message).split('\n')[0]); } };

try {
  for (let i = 0; i < 60 && !/Ready on/.test(log); i++) await new Promise(r => setTimeout(r, 1000));
  assert.match(log, /Ready on/, 'wrangler dev did not start:\n' + log.slice(-800));

  let cookie = '';
  const call = async (method, path, body, headers = {}) => {
    const res = await fetch(B + path, {method, redirect: 'manual', headers: {origin: ORIGIN, ...(body !== undefined ? {'content-type': 'application/json'} : {}), ...(cookie ? {cookie} : {}), ...headers}, body: body === undefined ? undefined : JSON.stringify(body)});
    const set = res.headers.getSetCookie?.()[0];
    if (set) cookie = set.includes('Max-Age=0') ? '' : set.split(';')[0];
    const text = await res.text();
    return {status: res.status, headers: res.headers, data: text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null, set};
  };
  const email = `smoke-${Date.now()}@example.com`, pw = 'a long smoke test passphrase';

  await step('register with the production PBKDF2 count', async () => {
    const t = Date.now(), r = await call('POST', '/auth/register', {email, password: pw, terms_version: '2026-11'});
    assert.equal(r.status, 201, JSON.stringify(r.data)); console.log(`       (${Date.now() - t} ms)`);
    assert.doesNotMatch(log, /refused, using fallback/, 'the platform refused the high PBKDF2 count: the fallback kicked in');
  });
  await step('login sets a hardened cookie, wrong password is refused', async () => {
    assert.equal((await call('POST', '/auth/login', {email, password: 'wrong wrong wrong'})).status, 401);
    const r = await call('POST', '/auth/login', {email, password: pw});
    assert.equal(r.status, 200);
    for (const f of ['__Host-taro_session=', 'HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/']) assert.ok(r.set.includes(f), f);
    assert.equal(r.headers.get('access-control-allow-origin'), ORIGIN); assert.equal(r.headers.get('access-control-allow-credentials'), 'true');
  });
  await step('session, consent and a saved reading round-trip through D1', async () => {
    assert.equal((await call('GET', '/me')).data.user.email, email);
    assert.equal((await call('POST', '/me/consents', {kind: 'save_history', version: '1', granted: true})).status, 204);
    const saved = await call('POST', '/me/readings', {spread_id: 'three', question: 'ทดสอบ', reversed_enabled: true, note: 'โน้ต', cards: [{position_id: 'p1', card_id: 'major-00', orientation: 'upright'}, {position_id: 'p2', card_id: 'cups-ace', orientation: 'reversed'}, {position_id: 'p3', card_id: 'swords-ten', orientation: 'upright'}]});
    assert.equal(saved.status, 201, JSON.stringify(saved.data));
    const list = await call('GET', '/me/readings');
    assert.equal(list.data.readings.length, 1); assert.equal(list.data.readings[0].note, 'โน้ต'); assert.equal(list.data.readings[0].question, 'ทดสอบ');
    assert.equal((await call('PUT', '/me/favorites/major-13', {})).status, 204);
    assert.equal((await call('GET', '/me/favorites')).data.favorites.length, 1);
    assert.equal((await call('GET', '/me/sessions')).data.sessions.length >= 1, true);
    const exp = await call('GET', '/me/export'); assert.ok(exp.data.readings.length === 1 && !JSON.stringify(exp.data).includes('pbkdf2'));
  });
  await step('card of the day, providers, CORS and CSRF guards', async () => {
    const d = await call('GET', '/content/daily'); assert.match(d.data.card_id, /^[a-z]+-/); assert.match(d.headers.get('cache-control'), /public, max-age=\d+/);
    assert.deepEqual((await call('GET', '/auth/providers')).data, {providers: []});
    const pre = await call('OPTIONS', '/auth/login', undefined, {'access-control-request-method': 'POST'}); assert.equal(pre.status, 204);
    assert.equal((await call('POST', '/auth/login', {}, {origin: 'https://evil.test'})).status, 403);
    assert.equal((await fetch(B + '/me/delete', {method: 'POST', headers: {origin: ORIGIN, 'content-type': 'text/plain', cookie}, body: '{}'})).status, 403);
  });
  await step('delete, restore by password, and sign-out clears the cookie', async () => {
    assert.equal((await call('POST', '/me/delete', {confirm: 'DELETE', password: pw})).status, 204);
    assert.equal((await call('GET', '/me')).status, 401);
    const back = await call('POST', '/auth/login', {email, password: pw}); assert.equal(back.data.restored, true);
    assert.equal((await call('GET', '/me/readings')).data.readings.length, 1, 'data survived the grace period');
    const out = await call('POST', '/auth/logout', {}); assert.equal(out.status, 204); assert.match(out.set, /Max-Age=0/);
  });
  await step('no secrets, emails or tokens in the runtime log', async () => { assert.doesNotMatch(log, new RegExp(email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'the address was logged'); assert.doesNotMatch(log, /#verify=|#reset=|passphrase/, 'a link or password was logged'); });
} catch (e) { failed++; console.log('FAIL setup\n    ', e.message); }
stop();
console.log(failed ? `${failed} FAILED` : 'PASS: taro-api runs on workerd with local D1: sign-up, sign-in, history, favourites, export, daily card, CSRF/CORS, delete and restore');
process.exit(failed ? 1 : 0);
