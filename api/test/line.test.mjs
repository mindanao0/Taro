import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {client, makeEnv} from './helpers.mjs';
import worker from '../index.js';
import {isDue, messageText, sendDue} from '../lib/line.mjs';
import {DISCLOSURE} from '../../scripts/line-model.mjs';

const SECRET = 'line-messaging-secret', TOKEN = 'line-messaging-token';
const row = (env, sql, ...a) => env.db.prepare(sql).get(...a);
const count = (env, t, w = '') => row(env, `SELECT COUNT(*) n FROM ${t} ${w}`).n;

/* ---- LINE network mock ---- */
const net = {friends: new Set(), pushes: [], replies: [], pushStatus: () => 200, profileStatus: null};
const fetcher = async (url, init = {}) => {
  url = String(url);
  assert.equal(init.headers?.authorization, `Bearer ${TOKEN}`, 'every LINE call is authenticated');
  if (url.includes('/v2/bot/profile/')) return new Response('{}', {status: net.profileStatus ?? (net.friends.has(decodeURIComponent(url.split('/').pop())) ? 200 : 404)});
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
  // an unclear answer from LINE (outage, rate limit, bad token) must not overwrite what we already know
  net.profileStatus = 500;
  r = (await c.put('/me/line-notify', {enabled: true, schedule: 'daily', hour: 9})).data;
  assert.equal(r.subscription.friend, true, 'a failing friend check keeps the stored value');
  net.profileStatus = 429; assert.equal((await c.put('/me/line-notify', {enabled: true})).data.subscription.friend, true);
  net.profileStatus = 401; assert.equal((await c.put('/me/line-notify', {enabled: true})).data.subscription.friend, true);
  net.profileStatus = null; net.friends.clear();   // a clear 404 means they are not a friend (any more)
  assert.equal((await c.put('/me/line-notify', {enabled: true})).data.subscription.friend, false);
  net.profileStatus = 500; net.friends.add(lineId); net.profileStatus = null;
  assert.equal((await c.del('/me/line-notify')).status, 204); assert.equal(count(env, 'line_subscriptions'), 0);
  net.profileStatus = 500;   // nothing stored yet and LINE unreachable: unknown counts as not a friend
  assert.equal((await c.put('/me/line-notify', {enabled: true})).data.subscription.friend, false);
  net.profileStatus = null; await c.del('/me/line-notify');
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
  // an oversized body is refused while it is being read, before anything else (the signature cannot even be checked on it)
  const big = await worker.fetch(new Request('https://api.test/line/webhook', {method: 'POST', headers: {'x-line-signature': 'AAAA'}, body: 'x'.repeat(70_000)}), env, {waitUntil() {}});
  assert.equal(big.status, 413);
  let pulled = 0;
  const stream = new ReadableStream({pull(ctl) { pulled += 1; ctl.enqueue(new Uint8Array(16_384)); if (pulled > 200) ctl.close(); }});
  const chunked = await worker.fetch(new Request('https://api.test/line/webhook', {method: 'POST', body: stream, duplex: 'half'}), env, {waitUntil() {}});
  assert.equal(chunked.status, 413); assert.ok(pulled < 20, `stopped reading after about the cap (${pulled} chunks of 16 KB pulled, not 200)`);

  assert.equal((await webhook(env, [{type: 'follow', source: {userId: lineId}}, {type: 'follow', source: {userId: 'someone-unknown'}}])).status, 200);
  assert.equal(sub().friend, 1);
  await webhook(env, [{type: 'unfollow', source: {userId: lineId}}]);
  assert.equal(sub().friend, 0); assert.ok(sub().blocked_at);
  await webhook(env, [{type: 'follow', source: {userId: lineId}}]);
  assert.equal(sub().friend, 1); assert.equal(sub().blocked_at, null, 'adding the account back clears the block');

  net.replies.length = 0;
  await webhook(env, [{type: 'message', replyToken: 'rt1', message: {type: 'text', text: 'hello'}, source: {userId: lineId}}]);
  assert.equal(sub().enabled, 1, 'chatting does not change the subscription'); assert.equal(net.replies.length, 1, 'a member who has no daily card yet today gets a hint, not an answer'); assert.match(net.replies[0].messages[0].text, /ถามต่อได้หลังได้รับไพ่ประจำวัน/);
  net.replies.length = 0;
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

  // a day later, mixed outcomes in one run. 400/404-type answers are strikes against that user, 5xx and network errors are retried
  // next run, and the others are still delivered
  net.pushes.length = 0;
  env.db.prepare('UPDATE line_subscriptions SET hour = 19').run();
  env.db.prepare("UPDATE line_subscriptions SET blocked_at = NULL, friend = 1, enabled = 1, schedule = 'daily', last_sent_at = NULL, fail_count = 0").run();
  const mixed = {[users[0].lineId]: 200, [users[1].lineId]: 400, [users[2].lineId]: 500, [users[3].lineId]: 'throw', [users[4].lineId]: 200, [users[5].lineId]: 200};
  net.pushStatus = to => mixed[to];
  r = await sendDue(env, now + 86_400_000);
  assert.deepEqual([r.sent, r.failed, r.blocked, r.aborted], [3, 3, 0, null]);
  const st = id => row(env, 'SELECT last_sent_at, blocked_at, fail_count FROM line_subscriptions WHERE line_user_id = ?', id);
  for (const u of [users[0], users[4], users[5]]) assert.ok(st(u.lineId).last_sent_at, 'successes recorded');
  assert.equal(st(users[1].lineId).fail_count, 1); assert.equal(st(users[1].lineId).blocked_at, null, 'one refusal is not enough to stop reminders');
  for (const u of [users[2], users[3]]) { assert.equal(st(u.lineId).last_sent_at, null); assert.equal(st(u.lineId).blocked_at, null); assert.equal(st(u.lineId).fail_count, 0, 'outages are not held against the user'); }
  // the third refusal in a row switches that user off; an outage in between does not reset or add to the count
  env.db.prepare('UPDATE line_subscriptions SET last_sent_at = NULL').run();
  await sendDue(env, now + 2 * 86_400_000); assert.equal(st(users[1].lineId).fail_count, 2);
  env.db.prepare('UPDATE line_subscriptions SET last_sent_at = NULL').run();
  r = await sendDue(env, now + 3 * 86_400_000); assert.equal(r.blocked, 1);
  assert.ok(st(users[1].lineId).blocked_at, 'three refusals in a row stop the reminders');
  // a success clears earlier strikes
  env.db.prepare("UPDATE line_subscriptions SET fail_count = 2, blocked_at = NULL, last_sent_at = NULL WHERE line_user_id = ?").run(users[1].lineId);
  net.pushStatus = () => 200; env.db.prepare('UPDATE line_subscriptions SET last_sent_at = NULL').run();
  await sendDue(env, now + 4 * 86_400_000); assert.equal(st(users[1].lineId).fail_count, 0);

  // a wrong or expired channel token (401/403) is not any user's fault: the run stops and NO ONE is blocked or penalised
  for (const code of [401, 403]) {
    env.db.prepare("UPDATE line_subscriptions SET last_sent_at = NULL, blocked_at = NULL, fail_count = 0, enabled = 1, friend = 1").run();
    net.pushes.length = 0; net.pushStatus = () => code;
    r = await sendDue(env, now + 5 * 86_400_000);
    assert.equal(r.aborted, 'auth'); assert.equal(r.sent, 0); assert.equal(r.blocked, 0);
    assert.equal(row(env, 'SELECT COUNT(*) n FROM line_subscriptions WHERE blocked_at IS NOT NULL OR fail_count > 0 OR last_sent_at IS NOT NULL').n, 0, `${code}: nobody blocked, penalised or marked as sent`);
    assert.ok(net.pushes.length <= 5, 'stops after the first batch in flight instead of hammering LINE');
  }
  // LINE rate limit (429): stop the run, leave everyone for the next one
  net.pushes.length = 0; net.pushStatus = () => 429;
  r = await sendDue(env, now + 5 * 86_400_000);
  assert.equal(r.aborted, 'rate'); assert.ok(net.pushes.length <= 5); assert.equal(row(env, 'SELECT COUNT(*) n FROM line_subscriptions WHERE blocked_at IS NOT NULL OR fail_count > 0').n, 0);

  // people LINE keeps refusing cannot use up the per-run quota: healthy subscribers are served first
  {
    const q = mk(), refused = [];
    for (let i = 300; i < 345; i++) { const u = await lineUser(q, i); q.db.prepare("INSERT INTO line_subscriptions (user_id, line_user_id, friend, schedule, hour, fail_count) VALUES (?, ?, 1, 'daily', 0, ?)").run(u.uid, u.lineId, i < 342 ? 2 : 0); if (i < 342) refused.push(u.lineId); }
    net.pushes.length = 0; net.pushStatus = to => refused.includes(to) ? 400 : 200;
    r = await sendDue(q, now);
    assert.equal(r.sent, 3, 'the three healthy subscribers all got theirs although 42 refused ones were also due');
  }

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


/* ---- follow-up questions after the daily card ---- */
{
  const env = mk(), {c, uid, lineId} = await lineUser(env, 7);
  net.friends.add(lineId); net.pushes.length = 0;
  await c.put('/me/line-notify', {enabled: true, schedule: 'daily', hour: 0});
  const sub = () => row(env, 'SELECT enabled, ask_date, ask_count, ask_topic, last_sent_at FROM line_subscriptions WHERE user_id = ?', uid);
  const say = async (text, {from = lineId, ...more} = {}) => {
    net.replies.length = 0;
    await webhook(env, [{type: 'message', replyToken: 'rt' + Math.random(), message: {type: 'text', text}, source: {userId: from}, ...more}]);
    return net.replies.map(r => r.messages[0].text);
  };
  const buttons = () => net.replies.at(-1)?.messages[0].quickReply?.items.map(i => i.action.text);
  assert.deepEqual(await say('สวัสดี', {from: 'U-not-a-member'}), [], 'strangers get no answer');
  assert.match((await say('ขอถามหน่อย'))[0], /ถามต่อได้หลังได้รับไพ่ประจำวัน/, 'before the daily card has been sent');
  assert.equal(sub().ask_count, 0);

  await sendDue(env);
  const pushed = net.pushes.at(-1).text, [, name] = pushed.match(/ไพ่ประจำวันนี้: .+ \((.+)\)/);
  assert.match(pushed, /พิมพ์คำถามในแชตนี้ได้ 3 ข้อ/, 'the daily message says questions are welcome');
  const secret = 'ลับ-98765';
  const [a1] = await say(`${secret} ความรัก`); assert.ok(a1.includes(name) && a1.includes('ถามต่อได้อีก 2 ข้อ'), 'answers from today\'s card');
  assert.ok(buttons().includes('ขอมุมอื่น') && buttons().includes('ถามเรื่องการงาน') && !buttons().includes('ถามเรื่องความรัก'), 'tap buttons: another angle and the other topics');
  assert.equal(sub().ask_topic, 'love', 'only the topic of the thread is remembered');
  const [a2] = await say('ขอมุมอื่น'); assert.ok(a2.includes('อีกมุมหนึ่ง') && a2.includes('ถามต่อได้อีก 1 ข้อ'), 'a button is just a message, and "another angle" follows the thread');
  assert.ok((await say('ขอบคุณนะ'))[0].includes('ถามได้อีก 1 ข้อ'), 'small talk is answered kindly, with what is left'); assert.equal(sub().ask_count, 2, 'and costs nothing');
  const [a3] = await say('อีกข้อ'); assert.ok(a3.includes('นี่เป็นข้อสุดท้าย')); assert.equal(buttons(), undefined, 'no buttons after the last question');
  assert.match((await say('ขออีกข้อ'))[0], /ถามครบ 3 ข้อแล้ว/); assert.equal(sub().ask_count, 3, 'the fourth does not count');
  const dump = env.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(t => JSON.stringify(env.db.prepare(`SELECT * FROM ${t.name}`).all())).join('');
  assert.ok(!dump.includes(secret) && !dump.includes('ความรัก ') && !dump.includes('ขอมุมอื่น'), 'the question text is nowhere in the database');

  env.db.prepare('UPDATE line_subscriptions SET ask_date = ?, ask_count = 3 WHERE user_id = ?').run('2000-01-01', uid);
  assert.ok((await say('วันใหม่'))[0].includes('ถามต่อได้อีก 2 ข้อ'), 'the counter starts again on a new Thai day'); assert.equal(sub().ask_count, 1);
  env.db.prepare('UPDATE line_subscriptions SET ask_topic = ? WHERE user_id = ?').run('work', uid);
  assert.ok((await say('ทำไม'))[0].includes('อีกมุมหนึ่ง'), 'a short "why?" continues the remembered topic'); env.db.prepare('UPDATE line_subscriptions SET ask_date = ? WHERE user_id = ?').run('2000-01-01', uid);

  env.db.prepare('UPDATE line_subscriptions SET ask_count = 0 WHERE user_id = ?').run(uid);
  const safe = await say('อยากตาย'); assert.ok(safe[0].includes('1323')); assert.equal(sub().ask_count, 0, 'a safety reply does not use up a question');
  assert.ok((await say('ขอเลขเด็ดหน่อย'))[0].includes('ไม่ใช่เครื่องมือเลือกเลข')); assert.equal(sub().ask_count, 0);
  assert.deepEqual(await say('ซ้ำ', {deliveryContext: {isRedelivery: true}}), [], 'a message LINE re-sends is not answered twice'); assert.equal(sub().ask_count, 0);
  net.replies.length = 0; await webhook(env, [{type: 'message', replyToken: 'rt-sticker', message: {type: 'sticker'}, source: {userId: lineId}}]); assert.equal(net.replies.length, 0, 'only text is answered');

  net.replies.length = 0;   // five questions in one delivery: the counter allows exactly three
  await webhook(env, Array.from({length: 5}, (_, i) => ({type: 'message', replyToken: 'burst' + i, message: {type: 'text', text: 'ข้อ ' + i}, source: {userId: lineId}})));
  assert.equal(net.replies.filter(r => /ถามต่อได้อีก|ข้อสุดท้าย/.test(r.messages[0].text)).length, 3); assert.equal(sub().ask_count, 3);

  env.db.prepare('UPDATE line_subscriptions SET last_sent_at = ? WHERE user_id = ?').run(new Date(Date.now() - 2 * 86_400_000).toISOString(), uid);
  assert.match((await say('เมื่อวานได้ไพ่'))[0], /ถามต่อได้หลังได้รับไพ่ประจำวัน/, 'only today\'s card can be asked about');
  env.db.prepare('UPDATE line_subscriptions SET last_sent_at = ? WHERE user_id = ?').run(new Date().toISOString(), uid);
  await webhook(env, [{type: 'message', replyToken: 'rt-stop', message: {type: 'text', text: 'หยุด'}, source: {userId: lineId}}]);
  assert.deepEqual(await say('ยังอยู่ไหม'), [], 'after "หยุด" the bot stays quiet');
  net.friends.clear();
}
/* ---- optional language-model slot: off by default, grounded, and never trusted ---- */
{
  const env = mk(), {c, uid, lineId} = await lineUser(env, 8);
  net.friends.add(lineId); net.pushes.length = 0;
  await c.put('/me/line-notify', {enabled: true, schedule: 'daily', hour: 0}); await sendDue(env);
  const calls = [], good = 'วันนี้ใจอาจต้องการความอ่อนโยนมากกว่าการเร่งตัวเอง ลองเริ่มจากสิ่งเล็ก ๆ ที่ทำได้จริง แล้วสังเกตว่าอะไรช่วยให้รู้สึกเบาลง คุณคิดว่าอะไรคือก้าวเล็กที่สุดที่ทำได้วันนี้';
  env.AI = {run: async (model, input) => { calls.push({model, input}); return {response: good}; }}; env.LINE_CHAT_MODEL = 'test-model';
  const say = async text => { env.db.prepare('UPDATE line_subscriptions SET ask_count = 0, ask_date = NULL WHERE user_id = ?').run(uid); net.replies.length = 0;
    await webhook(env, [{type: 'message', replyToken: 'rt' + Math.random(), message: {type: 'text', text}, source: {userId: lineId}}]); return net.replies.at(-1)?.messages[0].text; };

  assert.ok(!(await say('ความรักเป็นยังไง')).includes(DISCLOSURE) && calls.length === 0, 'not called until LINE_CHAT_AI=1');
  env.LINE_CHAT_AI = '1';
  const t = await say('ความรักเป็นยังไง');
  assert.equal(calls.length, 1); assert.equal(calls[0].model, 'test-model'); assert.ok(calls[0].input.messages[1].content.includes('ความรักเป็นยังไง'), 'the question reaches the model only as quoted data');
  assert.ok(t.startsWith(good) && t.includes(DISCLOSURE) && t.includes('ถามต่อได้อีก 2 ข้อ'), 'the model text, then the disclosure and the count, both added by the code');

  const rules = r => r.includes('ถ้ามองเรื่อง') && !r.includes(DISCLOSURE);
  env.AI.run = async () => ({response: 'เรื่องนี้จะเกิดขึ้นแน่นอน ' + good}); assert.ok(rules(await say('ความรักเป็นยังไง')), 'certainty language: the rule-based text is sent instead');
  env.AI.run = async () => { throw new Error('model down'); }; assert.ok(rules(await say('ความรักเป็นยังไง')), 'a failing model: rules');
  env.AI.run = () => new Promise(() => {}); env.LINE_CHAT_TIMEOUT_MS = '30'; assert.ok(rules(await say('ความรักเป็นยังไง')), 'a model that hangs: rules'); delete env.LINE_CHAT_TIMEOUT_MS;
  env.AI.run = async () => ({response: 'short'}); assert.ok(rules(await say('ความรักเป็นยังไง')), 'unusable output: rules');

  calls.length = 0; env.AI.run = async (...a) => { calls.push(a); return {response: good}; };
  assert.ok((await say('อยากตาย')).includes('1323'), 'safety'); await say('ขอเลขเด็ด'); await say('ขอบคุณ'); await say('สวัสดี');
  assert.equal(calls.length, 0, 'safety, boundary and small talk replies never reach the model');
  env.LINE_CHAT_AI = '0'; await say('ความรักเป็นยังไง'); assert.equal(calls.length, 0, 'switched off again');
  net.friends.clear();
}
console.log('PASS: LINE reminders and the follow-up chat (consent, friend check, signed webhook, stop-by-chat, Thai-time schedule, retries, caps) and feedback');
