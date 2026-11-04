import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {client, makeEnv} from './helpers.mjs';
import worker from '../index.js';
import {isDue, messageText, sendDue} from '../lib/line.mjs';

const SECRET = 'line-messaging-secret', TOKEN = 'line-messaging-token';
const row = (env, sql, ...a) => env.db.prepare(sql).get(...a);
const count = (env, t, w = '') => row(env, `SELECT COUNT(*) n FROM ${t} ${w}`).n;

/* ---- LINE network mock ---- */
const net = {friends: new Set(), pushes: [], replies: [], pushStatus: () => 200};
const fetcher = async (url, init = {}) => {
  url = String(url);
  assert.equal(init.headers?.authorization, `Bearer ${TOKEN}`, 'every LINE call is authenticated');
  if (url.includes('/v2/bot/profile/')) return new Response('{}', {status: net.friends.has(decodeURIComponent(url.split('/').pop())) ? 200 : 404});
  if (url.endsWith('/v2/bot/message/push')) { const b = JSON.parse(init.body); const st = net.pushStatus(b.to); if (st === 'throw') throw new Error('network'); net.pushes.push({to: b.to, text: b.messages[0].text, status: st}); return new Response('{}', {status: st}); }
  if (url.endsWith('/v2/bot/message/reply')) { net.replies.push(JSON.parse(init.body)); return new Response('{}', {status: 200}); }
  throw new Error('unexpected ' + url);
};
const mk = () => makeEnv({FETCHER: fetcher, LINE_MESSAGING_TOKEN: TOKEN, LINE_MESSAGING_SECRET: SECRET, DAILY_SECRET: 'daily-secret-for-line-tests-xx', LINE_OA_URL: 'https://line.me/R/ti/p/@test'});

// a user with a LINE identity (inserted directly: the OAuth flow itself is covered in social.test.mjs)
async function lineUser(env, n, {consent = true} = {}) {
  const c = client(env), email = `u${n}@example.com`;
  await c.post('/auth/register', {email, password: 'a long test passphrase'});
  await c.post('/auth/login', {email, password: 'a long test passphrase'});
  const uid = row(env, 'SELECT id FROM users WHERE email = ?', email).id;
  env.db.prepare("INSERT INTO identities (id, user_id, provider, provider_user_id, created_at) VALUES (?, ?, 'line', ?, ?)").run(crypto.randomUUID(), uid, 'U' + n, new Date().toISOString());
  if (consent) await c.post('/me/consents', {kind: 'line_notify', version: '1', granted: true});
  return {c, uid, lineId: 'U' + n};
}
const webhook = (env, events, {sig, secret = SECRET} = {}) => {
  const body = JSON.stringify({events});
  return worker.fetch(new Request('https://api.test/line/webhook', {method: 'POST', headers: {'content-type': 'application/json', 'x-line-signature': sig ?? createHmac('sha256', secret).update(body).digest('base64')}, body}), env, {waitUntil() {}});
};

/* ---- settings endpoint ---- */
{
  const env = mk(), plain = client(env);
  assert.equal((await plain.get('/me/line-notify')).status, 401);
  await plain.post('/auth/register', {email: 'nolinked@example.com', password: 'a long test passphrase'});
  await plain.post('/auth/login', {email: 'nolinked@example.com', password: 'a long test passphrase'});
  const s0 = (await plain.get('/me/line-notify')).data;
  assert.equal(s0.linked, false); assert.equal(s0.subscription, null); assert.equal(s0.add_friend_url, 'https://line.me/R/ti/p/@test');
  assert.equal((await plain.put('/me/line-notify', {enabled: true})).data.error, 'line_not_linked');

  const {c, uid, lineId} = await lineUser(env, 1, {consent: false});
  assert.equal((await c.put('/me/line-notify', {enabled: true})).data.error, 'consent_required', 'no reminders without consent');
  await c.post('/me/consents', {kind: 'line_notify', version: '1', granted: true});
  for (const bad of [{}, {enabled: 'yes'}, {enabled: true, schedule: 'hourly'}, {enabled: true, hour: 24}, {enabled: true, hour: 1.5}, {enabled: true, weekday: 7}, {enabled: true, hour: '7'}])
    assert.equal((await c.put('/me/line-notify', bad)).status, 400, JSON.stringify(bad));

  let r = (await c.put('/me/line-notify', {enabled: true, schedule: 'daily', hour: 8})).data;
  assert.equal(r.subscription.friend, false, 'not a friend yet'); assert.equal(r.subscription.schedule, 'daily'); assert.equal(r.subscription.hour, 8);
  assert.equal(row(env, 'SELECT line_user_id FROM line_subscriptions').line_user_id, lineId, 'taken from the linked LINE identity, never from the request');
  net.friends.add(lineId);
  r = (await c.put('/me/line-notify', {enabled: true, schedule: 'weekly', hour: 20, weekday: 3})).data;
  assert.equal(r.subscription.friend, true, 'friend status is checked with LINE'); assert.equal(count(env, 'line_subscriptions'), 1, 'upsert, not duplicate');
  assert.equal((await client(env, {origin: 'https://evil.test'}).put('/me/line-notify', {enabled: true})).status, 403);
  assert.equal((await c.del('/me/line-notify')).status, 204); assert.equal(count(env, 'line_subscriptions'), 0);
  net.friends.clear();
}

/* ---- webhook ---- */
{
  const env = mk(), {c, uid, lineId} = await lineUser(env, 2);
  await c.put('/me/line-notify', {enabled: true});
  const sub = () => row(env, 'SELECT enabled, friend, blocked_at FROM line_subscriptions');
  assert.equal((await webhook(env, [], {sig: 'bm9wZQ=='})).status, 401, 'forged signature');
  assert.equal((await webhook(env, [{type: 'follow', source: {userId: lineId}}], {secret: 'wrong-secret'})).status, 401);
  assert.equal((await worker.fetch(new Request('https://api.test/line/webhook', {method: 'POST', body: '{}'}), env, {waitUntil() {}})).status, 401, 'no signature at all');
  assert.equal(sub().friend, 0, 'forged events change nothing');
  assert.equal((await webhook(env, [])).status, 200, "LINE's verify ping");
  assert.equal((await webhook(makeEnv(), [])).status, 503, 'unconfigured');

  assert.equal((await webhook(env, [{type: 'follow', source: {userId: lineId}}, {type: 'follow', source: {userId: 'someone-unknown'}}])).status, 200);
  assert.equal(sub().friend, 1);
  await webhook(env, [{type: 'unfollow', source: {userId: lineId}}]);
  assert.equal(sub().friend, 0); assert.ok(sub().blocked_at);
  await webhook(env, [{type: 'follow', source: {userId: lineId}}]);
  assert.equal(sub().friend, 1); assert.equal(sub().blocked_at, null, 'adding the account back clears the block');

  net.replies.length = 0;
  await webhook(env, [{type: 'message', replyToken: 'rt1', message: {type: 'text', text: 'hello'}, source: {userId: lineId}}]);
  assert.equal(sub().enabled, 1, 'other chat messages do nothing'); assert.equal(net.replies.length, 0);
  await webhook(env, [{type: 'message', replyToken: 'rt2', message: {type: 'text', text: ' หยุด '}, source: {userId: lineId}}]);
  assert.equal(sub().enabled, 0, 'typing "หยุด" stops reminders'); assert.equal(net.replies.length, 1); assert.equal(net.replies[0].replyToken, 'rt2');
  const last = row(env, "SELECT granted, version FROM consents WHERE kind = 'line_notify' ORDER BY id DESC LIMIT 1");
  assert.equal(last.granted, 0); assert.equal(last.version, 'chat-stop');
  assert.equal((await c.get('/me/line-notify')).data.consent, false, 'the settings page reflects the withdrawal');
  assert.equal((await webhook(env, [{type: 'follow', source: {userId: 'x'.repeat(100)}}, null, 'junk'])).status, 200, 'malformed events are skipped');
}

/* ---- schedule logic (Thai time) ---- */
{
  const T = (y, m, d, h) => Date.UTC(y, m - 1, d, h - 7);   // Thai wall clock -> instant
  const daily = {schedule: 'daily', hour: 8, weekday: 0, last_sent_at: null};
  assert.equal(isDue(daily, T(2026, 11, 4, 7)), false, 'before the chosen hour');
  assert.equal(isDue(daily, T(2026, 11, 4, 8)), true);
  assert.equal(isDue(daily, T(2026, 11, 4, 23)), true, 'catch-up later the same day');
  assert.equal(isDue({...daily, last_sent_at: new Date(T(2026, 11, 4, 8)).toISOString()}, T(2026, 11, 4, 9)), false, 'once per day');
  assert.equal(isDue({...daily, last_sent_at: new Date(T(2026, 11, 3, 8)).toISOString()}, T(2026, 11, 4, 8)), true, 'next day');
  assert.equal(isDue({...daily, hour: 0, last_sent_at: new Date(T(2026, 11, 3, 23)).toISOString()}, T(2026, 11, 4, 0)), true, 'Thai midnight, not UTC midnight, starts a new day');
  const wk = {schedule: 'weekly', hour: 19, weekday: 3, last_sent_at: null};   // Wednesday
  const wed = T(2026, 11, 4, 19);   // 2026-11-04 is a Wednesday in Thailand
  assert.equal(isDue(wk, wed), true); assert.equal(isDue(wk, wed - 86_400_000), false, 'wrong weekday');
  assert.equal(isDue({...wk, last_sent_at: new Date(wed - 3600_000).toISOString()}, wed), false);
  assert.equal(isDue({...wk, last_sent_at: new Date(wed - 7 * 86_400_000).toISOString()}, wed), true, 'a week later');
}

/* ---- the sender ---- */
{
  const env = mk(), now = Date.UTC(2026, 10, 4, 12, 7);   // 19:07 Thai, Wednesday
  const users = [];
  for (let i = 10; i < 16; i++) users.push(await lineUser(env, i));
  const set = (u, over = {}) => env.db.prepare("INSERT INTO line_subscriptions (user_id, line_user_id, enabled, friend, schedule, hour, weekday) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(u.uid, u.lineId, over.enabled ?? 1, over.friend ?? 1, over.schedule ?? 'daily', over.hour ?? 19, over.weekday ?? 3);
  set(users[0]); set(users[1], {friend: 0}); set(users[2], {enabled: 0}); set(users[3], {hour: 22}); set(users[4], {schedule: 'weekly', weekday: 5}); set(users[5]);
  env.db.prepare("UPDATE line_subscriptions SET blocked_at = '2026-01-01T00:00:00.000Z' WHERE line_user_id = ?").run(users[5].lineId);

  net.pushes.length = 0; net.pushStatus = () => 200;
  let r = await sendDue(env, now);
  assert.deepEqual([r.sent, r.failed, r.blocked], [1, 0, 0]);
  assert.deepEqual(net.pushes.map(p => p.to), [users[0].lineId], 'only the due, enabled, befriended, unblocked subscriber');
  const text = net.pushes[0].text;
  assert.match(text, /ไพ่ประจำวันนี้: .+ \(.+\)/, "today's public card is named");
  assert.ok(text.includes('https://ivoryrosetarot.online') && text.includes('หยุด'));
  assert.ok(!text.includes('u10@example.com') && !text.includes('ทดสอบ'), 'no personal data in the message');
  assert.equal(text, await messageText(env, now));
  assert.ok(row(env, 'SELECT last_sent_at FROM line_subscriptions WHERE line_user_id = ?', users[0].lineId).last_sent_at);
  r = await sendDue(env, now + 60_000);
  assert.equal(r.sent, 0, 'running again in the same hour sends nothing twice');

  // a day later: permanent refusal blocks, a rate limit leaves it for the next run, a network error likewise, others still go out
  net.pushes.length = 0;
  env.db.prepare('UPDATE line_subscriptions SET hour = 19').run();
  env.db.prepare("UPDATE line_subscriptions SET blocked_at = NULL, friend = 1, enabled = 1, schedule = 'daily', last_sent_at = NULL").run();
  const nine = {[users[0].lineId]: 200, [users[1].lineId]: 403, [users[2].lineId]: 429, [users[3].lineId]: 'throw', [users[4].lineId]: 500, [users[5].lineId]: 200};
  net.pushStatus = to => nine[to];
  r = await sendDue(env, now + 86_400_000);
  assert.deepEqual([r.sent, r.failed, r.blocked], [2, 3, 1]);
  const st = id => row(env, 'SELECT last_sent_at, blocked_at FROM line_subscriptions WHERE line_user_id = ?', id);
  assert.ok(st(users[0].lineId).last_sent_at && st(users[5].lineId).last_sent_at, 'successes recorded');
  assert.ok(st(users[1].lineId).blocked_at, '403 stops further tries');
  for (const u of [users[2], users[3], users[4]]) { assert.equal(st(u.lineId).last_sent_at, null); assert.equal(st(u.lineId).blocked_at, null, 'transient failures are retried'); }

  // withdrawn consent: not sent, and switched off
  const w = users[2];
  await w.c.post('/me/consents', {kind: 'line_notify', version: '1', granted: false});
  env.db.prepare('UPDATE line_subscriptions SET enabled = 1 WHERE user_id = ?').run(w.uid);
  net.pushes.length = 0; net.pushStatus = () => 200;
  await sendDue(env, now + 86_400_000);
  assert.ok(!net.pushes.some(p => p.to === w.lineId)); assert.equal(row(env, 'SELECT enabled FROM line_subscriptions WHERE user_id = ?', w.uid).enabled, 0);

  // deleted accounts are skipped
  env.db.prepare("UPDATE users SET deleted_at = '2026-11-01T00:00:00.000Z' WHERE id = ?").run(users[4].uid);
  env.db.prepare('UPDATE line_subscriptions SET last_sent_at = NULL, enabled = 1').run();
  net.pushes.length = 0;
  await sendDue(env, now + 2 * 86_400_000);
  assert.ok(!net.pushes.some(p => p.to === users[4].lineId));
  assert.equal((await sendDue(makeEnv(), now)).skipped, 'not_configured');

  // per-run cap
  const big = mk();
  for (let i = 100; i < 160; i++) { const u = await lineUser(big, i); big.db.prepare("INSERT INTO line_subscriptions (user_id, line_user_id, schedule, hour) VALUES (?, ?, 'daily', 0)").run(u.uid, u.lineId); big.db.prepare('UPDATE line_subscriptions SET friend = 1').run(); }
  net.pushes.length = 0; net.pushStatus = () => 200;
  assert.equal((await sendDue(big, now)).sent, 40, 'at most 40 per run');
  assert.equal((await sendDue(big, now + 1)).sent, 20, 'the rest go out on the next run');
}

/* ---- scheduled(): the hourly cron sends, the daily cron cleans ---- */
{
  const env = mk(), u = await lineUser(env, 200);
  env.db.prepare("INSERT INTO line_subscriptions (user_id, line_user_id, friend, schedule, hour) VALUES (?, ?, 1, 'daily', 0)").run(u.uid, u.lineId);
  net.pushes.length = 0; net.pushStatus = () => 200;
  const jobs = [];
  await worker.scheduled({cron: '7 * * * *'}, env, {waitUntil: p => jobs.push(p)});
  await Promise.all(jobs);
  assert.equal(net.pushes.length, 1);
  env.db.prepare("UPDATE users SET deleted_at = '2000-01-01T00:00:00.000Z'").run();
  const jobs2 = [];
  await worker.scheduled({cron: '27 20 * * *'}, env, {waitUntil: p => jobs2.push(p)});
  await Promise.all(jobs2);
  assert.equal(count(env, 'users'), 0, 'the daily job purges old deleted accounts'); assert.equal(count(env, 'line_subscriptions'), 0);
  assert.equal(net.pushes.length, 1, 'and does not send anything');
}

/* ---- feedback ---- */
{
  const env = mk(), anon = client(env);
  assert.equal((await anon.post('/feedback', {kind: 'bug', body: 'ปุ่มไม่ทำงาน', page: '/index.html'})).status, 204);
  const f = row(env, 'SELECT * FROM feedback');
  assert.equal(f.user_id, null); assert.equal(f.status, 'new'); assert.equal(f.page, '/index.html');
  const me = client(env);
  await me.post('/auth/register', {email: 'fb@example.com', password: 'a long test passphrase'}); await me.post('/auth/login', {email: 'fb@example.com', password: 'a long test passphrase'});
  await me.post('/feedback', {kind: 'idea', body: 'อยากได้ไพ่รายสัปดาห์', page: 'https://evil.test/x'});
  const f2 = env.db.prepare('SELECT user_id, page FROM feedback ORDER BY rowid DESC').get();
  assert.ok(f2.user_id, 'attached to the signed-in user'); assert.equal(f2.page, null, 'a page that is not a local path is dropped');
  for (const bad of [{kind: 'spam', body: 'hello there'}, {kind: 'bug', body: 'x'}, {kind: 'bug', body: ['a']}, {kind: 'bug'}]) assert.equal((await anon.post('/feedback', bad)).status, 400);
  assert.equal((await client(env, {origin: 'https://evil.test'}).post('/feedback', {kind: 'bug', body: 'hello there'})).status, 403);
  assert.equal((await anon.post('/feedback', undefined, {rawBody: JSON.stringify({kind: 'bug', body: 'x'.repeat(9000)}), contentType: 'application/json'})).status, 400);
  assert.equal(count(env, 'feedback'), 2);
}

console.log('PASS: LINE reminders (consent, friend check, signed webhook, stop-by-chat, Thai-time schedule, retries, caps) and feedback');
