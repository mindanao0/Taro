// Runs the real migrations on SQLite and exercises POST /events and the nightly maintenance against them.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import worker, {maintain} from './index.js';

const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON');
for (const f of readdirSync(new URL('../migrations/', import.meta.url)).sort()) db.exec(readFileSync(new URL('../migrations/' + f, import.meta.url), 'utf8'));

// minimal D1 look-alike over node:sqlite (undefined binds are rejected, as in D1)
const stmt = (sql, args = []) => ({
  bind: (...a) => { assert.ok(a.every(v => v !== undefined), 'undefined bound'); return stmt(sql, a); },
  run: async () => db.prepare(sql).run(...args),
  sql, args
});
const env = {DB: {prepare: sql => stmt(sql), batch: async list => {
  db.exec('BEGIN');
  try { for (const s of list) db.prepare(s.sql).run(...s.args); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
}}};

const SID = 'c0ffee00-1111-2222-3333-444455556666';
const ev = (seq, over = {}) => ({type: 'pick', seq, t_ms: seq * 100, view: 'pick', target: 'fan:12', x: 10, y: 20, rx: 500, ry: 400, outcome: 'ok', ...over});
const post = (body, {path = '/events', origin = 'https://ivoryrosetarot.online', e = env} = {}) =>
  worker.fetch(new Request('https://x.test' + path, {method: 'POST', headers: origin ? {origin} : {}, body: typeof body === 'string' ? body : JSON.stringify(body)}), e);
const good = (events, extra = {}) => ({sid: SID, consent: 'analytics-1', meta: {viewport_w: 390, viewport_h: 844, pointer: 'touch', app_version: 'web-1', started_at: new Date().toISOString()}, events, ...extra});
const count = t => db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;

// stores a batch, in order, with positions
assert.equal((await post(good([ev(1, {type: 'start_pick', target: 'spread:three'}), ev(2), ev(3, {type: 'unpick', outcome: 'undone', data: {pos: 0, q: 'text'}}), ev(4, {type: 'miss_tap', outcome: 'miss', target: 'fan'})]))).status, 204);
let rows = db.prepare('SELECT * FROM ui_events WHERE session_id = ? ORDER BY seq').all(SID);
assert.deepEqual(rows.map(r => r.type), ['start_pick', 'pick', 'unpick', 'miss_tap']);
assert.equal(rows[1].rx, 500); assert.equal(rows[2].outcome, 'undone'); assert.equal(rows[2].data_json, '{"pos":0}');   // free text in data dropped
assert.equal(db.prepare('SELECT pointer, viewport_w, consent_version FROM ui_sessions').get().consent_version, 'analytics-1');

// resending the same batch (retry/beacon duplicate) changes nothing; later batch for the same session appends
await post(good([ev(1), ev(2)]));
assert.equal(count('ui_events'), 4);
assert.equal((await post({sid: SID, consent: 'analytics-1', events: [ev(5, {type: 'auto_open', target: undefined})]})).status, 204);
assert.equal(count('ui_events'), 5); assert.equal(count('ui_sessions'), 1);

// gates: consent, origin, method, size, shape
assert.equal((await post(good([ev(1)], {consent: undefined}))).status, 403);
assert.equal((await post(good([ev(1)], {consent: 'old'}))).status, 403);
assert.equal((await post(good([ev(1)]), {origin: 'https://evil.test'})).status, 403);
assert.equal((await post('{', {})).status, 400);
assert.equal((await post(good([]))).status, 400);
assert.equal((await post(good([ev(1)], {sid: 'x'}))).status, 400);
assert.equal((await post(good(Array.from({length: 101}, (_, i) => ev(i + 1))))).status, 400);
assert.equal((await post(good([ev(1, {type: 'keylog'})]))).status, 400);
assert.equal((await post(good([ev(1, {outcome: 'weird'})]))).status, 400);
assert.equal((await post(good([ev(501)]))).status, 400);                       // per-session cap
assert.equal((await post(good([ev(1, {target: '<script>'})]))).status, 204);   // bad optional text is nulled, not stored
assert.equal(db.prepare('SELECT target FROM ui_events WHERE session_id = ? AND seq = 1').get(SID).target, 'spread:three');   // first row wins
assert.equal((await post('x'.repeat(20000))).status, 413);
assert.equal((await worker.fetch(new Request('https://x.test/events', {method: 'GET', headers: {origin: 'https://ivoryrosetarot.online'}}), env)).status, 405);
assert.equal((await post({}, {path: '/nope'})).status, 404);

// coordinates are clamped, never rejected
await post(good([ev(1, {x: 99999, rx: 5000})], {sid: 'clamp-session-1'}));
const c = db.prepare("SELECT x, rx FROM ui_events WHERE session_id = 'clamp-session-1'").get();
assert.deepEqual([c.x, c.rx], [20000, 1000]);

// rate limit
let n = 0;
const limited = {...env, EVENTS_LIMITER: {limit: async () => ({success: ++n <= 1})}};
assert.equal((await post(good([ev(9)], {sid: 'limit-session-1'}), {e: limited})).status, 204);
assert.equal((await post(good([ev(9)], {sid: 'limit-session-1'}), {e: limited})).status, 429);

// questions endpoint still works through the same worker
db.exec("INSERT INTO questions (q, spread, at) VALUES ('old', 'single', '2020-01-01T00:00:00.000Z'), ('new', 'single', '" + new Date().toISOString() + "')");

// maintenance: sessions older than 30 days are rolled up then deleted; recent ones and aggregates survive; re-running does not double count
const old = new Date(Date.now() - 40 * 86_400_000).toISOString();
db.prepare("INSERT INTO ui_sessions (id, started_at, consent_version, pointer) VALUES ('old-session-1', ?, 'analytics-1', 'touch')").run(old);
db.prepare("INSERT INTO ui_events (session_id, seq, t_ms, type, view, outcome) VALUES ('old-session-1', 1, 0, 'miss_tap', 'pick', 'miss'), ('old-session-1', 2, 5, 'miss_tap', 'pick', 'miss'), ('old-session-1', 3, 9, 'pick', NULL, 'ok')").run();
const recent = count('ui_events') - 3;
await maintain(env); await maintain(env);
assert.equal(count('ui_sessions') >= 1, true);
assert.equal(db.prepare("SELECT COUNT(*) n FROM ui_sessions WHERE id = 'old-session-1'").get().n, 0);
assert.equal(count('ui_events'), recent);
const stat = db.prepare("SELECT n FROM ui_daily_stats WHERE type = 'miss_tap' AND pointer = 'touch'").get();
assert.equal(stat.n, 2);
assert.equal(db.prepare("SELECT n FROM ui_daily_stats WHERE type = 'pick' AND view = ''").get().n, 1);
assert.equal(db.prepare("SELECT COUNT(*) n FROM questions").get().n, 1);   // 90-day purge

console.log('PASS: /events validates and stores ordered click batches on real SQLite; resend is idempotent; maintenance rolls up and purges');
