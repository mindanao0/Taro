// Cloudflare Worker.
//   POST /        question text (no IP, no user agent) -> D1 `questions`
//   POST /events  opt-in click-sequence batches        -> D1 `ui_sessions` / `ui_events`
//   cron          roll old click events into daily stats, purge old rows
// The page posts with mode:'no-cors' (text/plain), so there is no preflight and no CORS headers are needed.
import {TYPES, OUTCOMES, CONSENT_VERSION} from '../scripts/track.mjs';

const SPREADS = new Set(['single', 'three', 'relationship-five', 'celtic-cross']);
const ORIGINS = new Set(['https://ivoryrosetarot.online', 'https://www.ivoryrosetarot.online']);
const MAX_BODY = 4096;           // questions: a 1000-char Thai question is ~3 KB of UTF-8, anything longer is junk
const MAX_EVENTS_BODY = 16384;   // click batches
const MAX_Q = 300;
const RAW_DAYS = 30, QUESTION_DAYS = 90;
const done = status => new Response(null, {status, headers: {'cache-control': 'no-store'}});

// Reads at most `max` bytes; returns null if the body is larger.
async function readCapped(stream, max) {
  if (!stream) return '';
  const reader = stream.getReader(), parts = [];
  let size = 0;
  for (;;) {
    const {done: end, value} = await reader.read();
    if (end) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel(); return null; }
    parts.push(value);
  }
  const all = new Uint8Array(size);
  let o = 0;
  for (const p of parts) { all.set(p, o); o += p.byteLength; }
  return new TextDecoder().decode(all);
}

async function limited(limiter, req) {   // optional rate limit; the IP is only a key, never stored
  if (!limiter) return false;
  const {success} = await limiter.limit({key: req.headers.get('cf-connecting-ip') || 'unknown'});
  return !success;
}

const num = (v, lo, hi) => Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : null;
const word = (v, re, max) => typeof v === 'string' && v.length <= max && re.test(v) ? v : null;

async function postQuestion(req, env) {
  if (Number(req.headers.get('content-length')) > MAX_BODY) return done(413);
  if (await limited(env.LIMITER, req)) return done(429);
  const text = await readCapped(req.body, MAX_BODY);   // also covers chunked bodies that send no content-length
  if (text === null) return done(413);
  let b;
  try { b = JSON.parse(text); } catch { return done(400); }
  if (!b || typeof b !== 'object' || Array.isArray(b)) return done(400);
  const q = typeof b.q === 'string'
    ? b.q.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, MAX_Q)
    : '';
  if (!q || typeof b.spread !== 'string' || !SPREADS.has(b.spread)) return done(400);
  await env.DB.prepare('INSERT INTO questions (q, spread, at) VALUES (?, ?, ?)')
    .bind(q, b.spread, new Date().toISOString()).run();
  return done(204);
}

// Validates one client event; returns the bound values or null. Unknown fields are dropped, never stored.
function cleanEvent(e) {
  if (!e || typeof e !== 'object' || !TYPES.has(e.type)) return null;
  const outcome = e.outcome === undefined ? 'ok' : e.outcome;
  const seq = num(e.seq, 1, 500), t = num(e.t_ms, 0, 86_400_000);
  if (!OUTCOMES.has(outcome) || seq === null || t === null || e.seq !== seq) return null;
  let data = null;
  if (e.data && typeof e.data === 'object' && !Array.isArray(e.data)) {
    const d = {};
    for (const [k, v] of Object.entries(e.data)) if (/^\w{1,16}$/.test(k) && (typeof v === 'number' || typeof v === 'boolean')) d[k] = v;
    const j = JSON.stringify(d);
    if (j !== '{}' && j.length <= 200) data = j;
  }
  return [seq, t, e.type, word(e.view, /^[a-z_]+$/, 12), word(e.target, /^[a-z]+(:[A-Za-z0-9_-]{1,24})?$/, 40),
    num(e.x, 0, 20000), num(e.y, 0, 20000), num(e.rx, 0, 1000), num(e.ry, 0, 1000), outcome, data];
}

async function postEvents(req, env) {
  if (Number(req.headers.get('content-length')) > MAX_EVENTS_BODY) return done(413);
  if (await limited(env.EVENTS_LIMITER, req)) return done(429);
  const text = await readCapped(req.body, MAX_EVENTS_BODY);
  if (text === null) return done(413);
  let b;
  try { b = JSON.parse(text); } catch { return done(400); }
  if (!b || typeof b !== 'object' || Array.isArray(b)) return done(400);
  // The client sends the consent version it showed the visitor; without it nothing is stored.
  if (b.consent !== CONSENT_VERSION) return done(403);
  const sid = word(b.sid, /^[A-Za-z0-9_-]{8,64}$/, 64);
  if (!sid || !Array.isArray(b.events) || !b.events.length || b.events.length > 100) return done(400);
  const events = b.events.map(cleanEvent);
  if (events.some(e => !e)) return done(400);

  const m = b.meta && typeof b.meta === 'object' ? b.meta : {};
  const started = typeof m.started_at === 'string' && !Number.isNaN(Date.parse(m.started_at)) ? new Date(m.started_at).toISOString() : new Date().toISOString();
  const db = env.DB;
  await db.batch([
    db.prepare('INSERT OR IGNORE INTO ui_sessions (id, started_at, consent_version, viewport_w, viewport_h, pointer, app_version) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(sid, started, CONSENT_VERSION, num(m.viewport_w, 0, 20000), num(m.viewport_h, 0, 20000),
        m.pointer === 'touch' || m.pointer === 'mouse' ? m.pointer : null, word(m.app_version, /^[\w.-]+$/, 20)),
    ...events.map(e => db.prepare('INSERT OR IGNORE INTO ui_events (session_id, seq, t_ms, type, view, target, x, y, rx, ry, outcome, data_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(sid, ...e))   // resending a batch is harmless: (session_id, seq) is unique
  ]);
  return done(204);
}

export async function maintain(env, now = new Date()) {
  const cut = n => new Date(now.getTime() - n * 86_400_000).toISOString();
  const db = env.DB;
  await db.batch([
    // roll up first, then delete, so nothing is counted twice or lost
    db.prepare(`INSERT INTO ui_daily_stats (day, type, view, outcome, pointer, n)
      SELECT substr(s.started_at, 1, 10), e.type, COALESCE(e.view, ''), e.outcome, COALESCE(s.pointer, ''), COUNT(*)
      FROM ui_events e JOIN ui_sessions s ON s.id = e.session_id WHERE s.started_at < ?
      GROUP BY 1, 2, 3, 4, 5
      ON CONFLICT (day, type, view, outcome, pointer) DO UPDATE SET n = n + excluded.n`).bind(cut(RAW_DAYS)),
    db.prepare('DELETE FROM ui_events WHERE session_id IN (SELECT id FROM ui_sessions WHERE started_at < ?)').bind(cut(RAW_DAYS)),
    db.prepare('DELETE FROM ui_sessions WHERE started_at < ?').bind(cut(RAW_DAYS)),
    db.prepare('DELETE FROM questions WHERE at < ?').bind(cut(QUESTION_DAYS))
  ]);
}

export default {
  async fetch(req, env) {
    if (req.method !== 'POST') return done(405);
    // Origin is only a browser-side guard (non-browser clients can forge it), so the rate limits are the real abuse control.
    if (!ORIGINS.has(req.headers.get('origin'))) return done(403);
    const path = new URL(req.url).pathname;
    if (path === '/') return postQuestion(req, env);
    if (path === '/events') return postEvents(req, env);
    return done(404);
  },
  async scheduled(_event, env, ctx) { ctx.waitUntil(maintain(env)); }
};
