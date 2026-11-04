import assert from 'node:assert/strict';
import {ORIGIN, client, makeEnv} from './helpers.mjs';
import {bangkokDate, dailyCardId, pickIndex, unbiasedIndex} from '../lib/daily.mjs';
import {CARDS, CARD_IDS, SPREADS, deckVersion} from '../lib/deck.mjs';
import worker from '../index.js';

const row = (env, sql, ...a) => env.db.prepare(sql).get(...a);
const count = (env, t, w = '') => row(env, `SELECT COUNT(*) n FROM ${t} ${w}`).n;

async function user(env, email, {consent = true} = {}) {
  const c = client(env);
  await c.post('/auth/register', {email, password: 'a long test passphrase'});
  await c.post('/auth/login', {email, password: 'a long test passphrase'});
  if (consent) await c.post('/me/consents', {kind: 'save_history', version: '1', granted: true});
  return c;
}
const reading = (over = {}) => ({spread_id: 'three', question: 'ทดสอบ', reversed_enabled: true,
  cards: [{position_id: 'p1', card_id: 'major-00', orientation: 'upright'}, {position_id: 'p2', card_id: 'cups-ace', orientation: 'reversed'}, {position_id: 'p3', card_id: 'swords-ten', orientation: 'upright'}], ...over});

/* ---- deck data the API validates against ---- */
assert.equal(CARDS.length, 78); assert.equal(CARD_IDS.size, 78); assert.ok(SPREADS.has('celtic-cross'));
assert.match(await deckVersion(), /^[0-9a-f]{12}$/);

/* ---- saving ---- */
const env = makeEnv(), ann = await user(env, 'ann@example.com'), bob = await user(env, 'bob@example.com');
{
  const noConsent = await user(env, 'nc@example.com', {consent: false});
  assert.equal((await noConsent.post('/me/readings', reading())).data.error, 'consent_required');
  assert.equal((await client(env).post('/me/readings', reading())).status, 401);
  await noConsent.post('/me/consents', {kind: 'save_history', version: '1', granted: true});
  assert.equal((await noConsent.post('/me/readings', reading())).status, 201);
  await noConsent.post('/me/consents', {kind: 'save_history', version: '1', granted: false});
  assert.equal((await noConsent.post('/me/readings', reading())).data.error, 'consent_required', 'withdrawing stops new saves');
  assert.equal((await noConsent.get('/me/readings')).data.readings.length, 1, 'but existing history stays visible to its owner');
}
const bad = async (label, body) => assert.equal((await ann.post('/me/readings', body)).status, 400, label);
const base = reading();
await bad('unknown spread', {...base, spread_id: 'nope'});
await bad('too few cards', {...base, cards: base.cards.slice(0, 2)});
await bad('too many cards', {...base, cards: [...base.cards, base.cards[0]]});
await bad('duplicate card', {...base, cards: [base.cards[0], {...base.cards[1], card_id: 'major-00'}, base.cards[2]]});
await bad('unknown card', {...base, cards: [{...base.cards[0], card_id: 'major-99'}, base.cards[1], base.cards[2]]});
await bad('wrong position order', {...base, cards: [base.cards[1], base.cards[0], base.cards[2]].map((c, i) => ({...c, position_id: ['p2', 'p1', 'p3'][i]}))});
await bad('reversed without the option', {...base, reversed_enabled: false});
await bad('bad orientation', {...base, cards: [{...base.cards[0], orientation: 'sideways'}, base.cards[1], base.cards[2]]});
await bad('question not text', {...base, question: {a: 1}});
await bad('cards not an array', {...base, cards: 'x'});
await bad('absurdly long question', {...base, question: 'ก'.repeat(5000)});
assert.equal(count(env, 'readings', "WHERE user_id = (SELECT id FROM users WHERE email = 'ann@example.com')"), 0, 'rejected requests store nothing');

let r = await ann.post('/me/readings', {...base, question: '  ' + 'ก'.repeat(400) + '\u0000 ', note: 'โน้ต', junk: 'ignored', user_id: 'someone-else'});
assert.equal(r.status, 201); assert.match(r.data.id, /^[0-9a-f-]{36}$/); assert.equal(r.data.deck_version, await deckVersion());
const saved = (await ann.get('/me/readings/' + r.data.id)).data;
assert.equal(saved.question.length, 300, 'question trimmed to 300'); assert.equal(saved.note, 'โน้ต');
assert.deepEqual(saved.cards.map(c => [c.position_id, c.card_id, c.orientation]), [['p1', 'major-00', 'upright'], ['p2', 'cups-ace', 'reversed'], ['p3', 'swords-ten', 'upright']]);
assert.equal(row(env, 'SELECT user_id FROM readings WHERE id = ?', r.data.id).user_id, row(env, "SELECT id FROM users WHERE email = 'ann@example.com'").id, 'owner comes from the session, never the body');
assert.equal(count(env, 'deck_versions'), 1);
assert.equal((await ann.post('/me/readings', {...base, question: undefined})).status, 201, 'question is optional');
assert.equal((await ann.post('/me/readings', {spread_id: 'single', reversed_enabled: false, cards: [{position_id: 'p1', card_id: 'wands-king', orientation: 'upright'}]})).status, 201);
assert.equal(count(env, 'deck_versions'), 1, 'one row per deck version');

/* ---- ownership: nobody else can see, change or delete it ---- */
{
  const id = r.data.id;
  assert.equal((await bob.get('/me/readings/' + id)).status, 404);
  assert.equal((await bob.put(`/me/readings/${id}/note`, {body: 'hijack'})).status, 404);
  assert.equal((await bob.del('/me/readings/' + id)).status, 404);
  assert.equal((await client(env).get('/me/readings/' + id)).status, 401);
  assert.equal((await ann.get('/me/readings/not-a-uuid')).status, 404);
  assert.equal((await bob.get('/me/readings')).data.readings.length, 0);
  assert.equal((await ann.get('/me/readings/' + id)).data.note, 'โน้ต', 'untouched by the failed attempts');
  assert.equal((await client(env, {origin: 'https://evil.test'}).del('/me/readings/' + id)).status, 403);
}

/* ---- notes ---- */
{
  const id = r.data.id;
  assert.equal((await ann.put(`/me/readings/${id}/note`, {body: ' updated\u0000 '})).status, 204);
  assert.equal((await ann.get('/me/readings/' + id)).data.note, 'updated');
  assert.equal((await ann.put(`/me/readings/${id}/note`, {body: 'x'.repeat(5000)})).status, 400);
  assert.equal((await ann.put(`/me/readings/${id}/note`, {body: 123})).status, 400);
  assert.equal((await ann.put(`/me/readings/${id}/note`, {body: '   '})).status, 204);
  assert.equal((await ann.get('/me/readings/' + id)).data.note, null, 'blank note removes it');
  assert.equal(count(env, 'reading_notes'), 0);
  await ann.put(`/me/readings/${id}/note`, {body: 'again'});
}

/* ---- list and pagination ---- */
{
  const e = makeEnv(); const c = await user(e, 'pg@example.com');
  for (let i = 0; i < 7; i++) {
    await c.post('/me/readings', {...base, question: 'q' + i});
    e.db.prepare('UPDATE readings SET created_at = ? WHERE question = ?').run(new Date(Date.UTC(2026, 0, 1, 0, 0, i < 4 ? i : 3)).toISOString(), 'q' + i);   // q3..q6 share a timestamp: the id tie-break must keep pages stable
  }
  const seen = []; let cursor = null, pages = 0;
  do {
    const res = (await c.get(`/me/readings?limit=3${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`)).data;
    seen.push(...res.readings.map(x => x.question)); cursor = res.next_cursor; pages++;
    assert.ok(res.readings.every(x => x.cards.length === 3));
  } while (cursor);
  assert.equal(pages, 3); assert.equal(seen.length, 7); assert.equal(new Set(seen).size, 7, 'no duplicates or gaps across pages');
  assert.deepEqual(seen.slice(-3), ['q2', 'q1', 'q0'], 'newest first');
  assert.equal((await c.get('/me/readings?cursor=garbage')).status, 400);
  assert.equal((await c.get('/me/readings?limit=9999')).data.readings.length, 7);
  assert.equal((await c.get('/me/readings?limit=0')).status, 200);
  assert.equal((await c.get('/me/readings?limit=1')).data.next_cursor !== null, true);
}

/* ---- delete cascades ---- */
{
  const id = r.data.id;
  assert.equal((await ann.del('/me/readings/' + id)).status, 204);
  assert.equal((await ann.del('/me/readings/' + id)).status, 404);
  assert.equal(count(env, 'reading_cards', `WHERE reading_id = '${id}'`), 0); assert.equal(count(env, 'reading_notes', `WHERE reading_id = '${id}'`), 0);
}

/* ---- daily cap ---- */
{
  const e = makeEnv(), c = await user(e, 'cap@example.com');
  const uid = row(e, 'SELECT id FROM users').id, v = await deckVersion();
  e.db.prepare('INSERT INTO deck_versions VALUES (?, ?)').run(v, new Date().toISOString());
  const ins = e.db.prepare('INSERT INTO readings (id, user_id, spread_id, deck_version, created_at) VALUES (?, ?, ?, ?, ?)');
  for (let i = 0; i < 200; i++) ins.run(crypto.randomUUID(), uid, 'single', v, new Date().toISOString());
  assert.equal((await c.post('/me/readings', reading())).data.error, 'daily_limit');
}

/* ---- favourites ---- */
{
  assert.deepEqual((await ann.get('/me/favorites')).data, {favorites: []});
  assert.equal((await ann.put('/me/favorites/major-13', {})).status, 204);
  assert.equal((await ann.put('/me/favorites/major-13', {})).status, 204, 'repeat is harmless');
  assert.equal((await ann.put('/me/favorites/cups-queen', {})).status, 204);
  assert.equal((await ann.put('/me/favorites/major-99', {})).status, 400);
  assert.equal((await ann.get('/me/favorites')).data.favorites.map(f => f.card_id).sort().join(), 'cups-queen,major-13');
  assert.deepEqual((await bob.get('/me/favorites')).data, {favorites: []}, 'private to the user');
  assert.equal((await client(env).put('/me/favorites/major-13', {})).status, 401);
  assert.equal((await client(env, {origin: 'https://evil.test'}).put('/me/favorites/major-00', {})).status, 403);
  assert.equal((await ann.del('/me/favorites/major-13')).status, 204);
  assert.equal((await ann.del('/me/favorites/major-13')).status, 204);
  assert.equal((await ann.get('/me/favorites')).data.favorites.length, 1);
}

/* ---- export includes history ---- */
{
  await ann.post('/me/readings', {...base, question: 'export me', note: 'n1'});
  const res = await worker.fetch(new Request('https://api.test/me/export', {headers: {cookie: ann.cookie, origin: ORIGIN}}), env, {waitUntil() {}});
  const d = await res.json();
  const mine = d.readings.find(x => x.question === 'export me');
  assert.ok(mine && mine.note === 'n1' && mine.cards.length === 3);
  assert.ok(d.favorites.some(f => f.card_id === 'cups-queen'));
  assert.ok(!JSON.stringify(d).includes('bob@example.com'), "another user's data never appears");
}

/* ---- card of the day ---- */
{
  const SECRET = 'daily-secret-for-tests-daily-secret';
  const e = makeEnv({DAILY_SECRET: SECRET}), c = client(e);
  assert.equal((await client(makeEnv()).get('/content/daily')).status, 503, 'refuses to run without a secret');

  const today = bangkokDate();
  let res = await c.get('/content/daily');
  assert.equal(res.status, 200); assert.equal(res.data.date, today); assert.ok(CARD_IDS.has(res.data.card_id)); assert.equal(res.data.deck_version, await deckVersion());
  const maxAge = Number(res.headers.get('cache-control').match(/max-age=(\d+)/)[1]);
  assert.ok(maxAge >= 1 && maxAge <= 86400 && res.headers.get('cache-control').startsWith('public'), 'cached until Thai midnight');
  assert.equal((await client(e).get('/content/daily')).data.card_id, res.data.card_id, 'same card for everyone, with or without a session');
  assert.equal((await c.get(`/content/daily?date=${today}`)).data.card_id, res.data.card_id);

  assert.equal((await c.get('/content/daily?date=2024-02-31')).status, 400);   // not a real date
  assert.equal((await c.get('/content/daily?date=tomorrow')).status, 400);
  assert.equal((await c.get('/content/daily?date=2023-12-31')).status, 400);
  const next = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  assert.equal((await c.get(`/content/daily?date=${next}`)).status, 400, "tomorrow's card is not readable in advance");
  assert.equal((await c.get('/content/daily?date=2025-06-01')).headers.get('cache-control'), 'public, max-age=86400');

  // Thai calendar day boundary: 17:00 UTC is midnight in Bangkok
  assert.equal(bangkokDate(Date.UTC(2026, 10, 4, 16, 59, 59)), '2026-11-04');
  assert.equal(bangkokDate(Date.UTC(2026, 10, 4, 17, 0, 0)), '2026-11-05');

  // deterministic, secret-dependent, uniform enough, never biased towards the low end
  assert.equal(await dailyCardId(SECRET, '2026-03-03'), await dailyCardId(SECRET, '2026-03-03'));
  const days = Array.from({length: 3900}, (_, i) => new Date(Date.UTC(2020, 0, 1) + i * 86_400_000).toISOString().slice(0, 10));
  const tally = new Map(), other = [];
  for (const d of days) { const id = await dailyCardId(SECRET, d); tally.set(id, (tally.get(id) || 0) + 1); other.push(await dailyCardId('another-secret-another-secret-xx', d)); }
  assert.equal(tally.size, 78, 'every card comes up');
  assert.ok(Math.max(...tally.values()) < 90 && Math.min(...tally.values()) > 20, `expected about 50 each, got ${Math.min(...tally.values())}-${Math.max(...tally.values())}`);
  assert.ok(days.filter((_, i) => other[i] === other[0]).length < 200);
  assert.notDeepEqual(await Promise.all(days.slice(0, 30).map(d => dailyCardId(SECRET, d))), other.slice(0, 30), 'a different secret gives a different sequence');
  // the uneven tail is skipped, not folded onto the low indexes: for n = 78 the accepted range ends at 78 * floor(2^32 / 78)
  const lim = Math.floor(2 ** 32 / 78) * 78, be = v => [v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
  assert.equal(unbiasedIndex(Uint8Array.from([...be(lim - 1), 9, 9, 9, 9]), 78), (lim - 1) % 78, 'last accepted value is used');
  assert.equal(unbiasedIndex(Uint8Array.from([...be(lim), ...be(5)]), 78), 5, 'first rejected value is skipped for the next chunk');
  assert.equal(unbiasedIndex(Uint8Array.from([...be(0xffffffff), ...be(lim + 3)]), 78), null, 'all chunks in the tail -> try the next hash');
  assert.equal(unbiasedIndex(Uint8Array.from(be(77)), 78), 77);
  // pickIndex stays in range: with n = 3 the accepted range is a multiple of 3
  for (const n of [1, 2, 3, 78]) for (let i = 0; i < 50; i++) { const v = await pickIndex(SECRET, 'd' + i, n); assert.ok(v >= 0 && v < n); }
}

console.log('PASS: readings (consent, validation, ownership, notes, pagination, cascade, cap), favourites, export, card of the day');
