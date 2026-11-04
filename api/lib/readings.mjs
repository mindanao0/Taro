// Reading history, private notes and favourite cards. Every query is scoped to the signed-in user.
import {CARD_IDS, SPREADS, deckVersion} from './deck.mjs';
import {json, readJson} from './http.mjs';
import {hasConsent} from './account.mjs';
import {cleanText, iso} from './util.mjs';

const MAX_QUESTION = 300, MAX_NOTE = 2000, DAILY_SAVES = 200, PAGE_DEFAULT = 20, PAGE_MAX = 50;
const ID = /^[0-9a-f-]{36}$/;

const shape = (r, cards, note) => ({
  id: r.id, spread_id: r.spread_id, question: r.question ?? '', reversed_enabled: !!r.reversed_enabled, deck_version: r.deck_version, created_at: r.created_at,
  cards: cards.map(c => ({position_id: c.position_id, card_id: c.card_id, orientation: c.reversed ? 'reversed' : 'upright'})),
  note: note ?? null
});

async function load(env, userId, rows) {   // attach cards and notes for a set of reading rows
  if (!rows.length) return [];
  const ids = rows.map(r => r.id), marks = ids.map(() => '?').join(',');
  const cards = (await env.DB.prepare(`SELECT reading_id, position_index, position_id, card_id, reversed FROM reading_cards WHERE reading_id IN (${marks}) ORDER BY reading_id, position_index`).bind(...ids).all()).results;
  const notes = (await env.DB.prepare(`SELECT reading_id, body FROM reading_notes WHERE reading_id IN (${marks})`).bind(...ids).all()).results;
  return rows.map(r => shape(r, cards.filter(c => c.reading_id === r.id), notes.find(n => n.reading_id === r.id)?.body));
}

export async function saveReading(req, env, _ctx, s) {
  if (!(await hasConsent(env, s.user.id, 'save_history'))) return json(403, {error: 'consent_required'});   // history is opt-in
  const b = await readJson(req, 16384);
  const spread = SPREADS.get(b?.spread_id);
  if (!spread || !Array.isArray(b.cards) || b.cards.length !== spread.positions.length) return json(400, {error: 'invalid_reading'});
  const reversedOn = b.reversed_enabled === true;
  const seen = new Set(), cards = [];
  for (const [i, c] of b.cards.entries()) {
    if (!c || c.position_id !== spread.positions[i].id || !CARD_IDS.has(c.card_id) || seen.has(c.card_id)) return json(400, {error: 'invalid_reading'});
    if (c.orientation !== 'upright' && !(c.orientation === 'reversed' && reversedOn)) return json(400, {error: 'invalid_reading'});
    seen.add(c.card_id); cards.push([i, c.position_id, c.card_id, c.orientation === 'reversed' ? 1 : 0]);
  }
  if (b.question !== undefined && typeof b.question !== 'string') return json(400, {error: 'invalid_reading'});
  if (b.note !== undefined && typeof b.note !== 'string') return json(400, {error: 'invalid_reading'});
  const question = cleanText(b.question ?? '', MAX_QUESTION), note = cleanText(b.note ?? '', MAX_NOTE);
  if ((b.question?.length ?? 0) > MAX_QUESTION * 4 || (b.note?.length ?? 0) > MAX_NOTE * 2) return json(400, {error: 'too_long'});

  const today = iso(Date.now() - 86_400_000);
  const n = (await env.DB.prepare('SELECT COUNT(*) AS n FROM readings WHERE user_id = ? AND created_at > ?').bind(s.user.id, today).first()).n;
  if (n >= DAILY_SAVES) return json(429, {error: 'daily_limit'});

  const id = crypto.randomUUID(), now = iso(), version = await deckVersion(), db = env.DB;
  await db.batch([
    db.prepare('INSERT OR IGNORE INTO deck_versions (version, first_seen_at) VALUES (?, ?)').bind(version, now),
    db.prepare('INSERT INTO readings (id, user_id, spread_id, question, reversed_enabled, deck_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(id, s.user.id, spread.id, question || null, reversedOn ? 1 : 0, version, now),
    ...cards.map(c => db.prepare('INSERT INTO reading_cards (reading_id, position_index, position_id, card_id, reversed) VALUES (?, ?, ?, ?, ?)').bind(id, ...c)),
    ...(note ? [db.prepare('INSERT INTO reading_notes (reading_id, body, updated_at) VALUES (?, ?, ?)').bind(id, note, now)] : [])
  ]);
  return json(201, {id, created_at: now, deck_version: version});
}

export async function listReadings(req, env, _ctx, s) {
  const url = new URL(req.url);
  const limit = Math.min(PAGE_MAX, Math.max(1, Number.parseInt(url.searchParams.get('limit') ?? PAGE_DEFAULT, 10) || PAGE_DEFAULT));
  const cursor = url.searchParams.get('cursor');
  let at = '9999', id = '￿';
  if (cursor) {
    const [a, i] = cursor.split('|');
    if (!a || !i || Number.isNaN(Date.parse(a)) || !ID.test(i)) return json(400, {error: 'invalid_cursor'});
    [at, id] = [a, i];
  }
  const rows = (await env.DB.prepare(
    `SELECT id, spread_id, question, reversed_enabled, deck_version, created_at FROM readings
     WHERE user_id = ? AND (created_at < ? OR (created_at = ? AND id < ?)) ORDER BY created_at DESC, id DESC LIMIT ?`)
    .bind(s.user.id, at, at, id, limit + 1).all()).results;
  const page = rows.slice(0, limit);
  return json(200, {readings: await load(env, s.user.id, page), next_cursor: rows.length > limit ? `${page.at(-1).created_at}|${page.at(-1).id}` : null});
}

const own = (env, userId, id) => ID.test(id)
  ? env.DB.prepare('SELECT id, spread_id, question, reversed_enabled, deck_version, created_at FROM readings WHERE id = ? AND user_id = ?').bind(id, userId).first()
  : null;

export async function getReading(req, env, _ctx, s, params) {
  const r = await own(env, s.user.id, params.id);
  return r ? json(200, (await load(env, s.user.id, [r]))[0]) : json(404, {error: 'not_found'});
}

export async function setNote(req, env, _ctx, s, params) {
  const b = await readJson(req, 16384);
  if (typeof b?.body !== 'string' || b.body.length > MAX_NOTE * 2) return json(400, {error: 'invalid_note'});
  if (!(await own(env, s.user.id, params.id))) return json(404, {error: 'not_found'});
  const body = cleanText(b.body, MAX_NOTE);
  if (!body) await env.DB.prepare('DELETE FROM reading_notes WHERE reading_id = ?').bind(params.id).run();
  else await env.DB.prepare('INSERT INTO reading_notes (reading_id, body, updated_at) VALUES (?, ?, ?) ON CONFLICT (reading_id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at').bind(params.id, body, iso()).run();
  return json(204);
}

export async function deleteReading(req, env, _ctx, s, params) {
  if (!ID.test(params.id)) return json(404, {error: 'not_found'});
  const res = await env.DB.prepare('DELETE FROM readings WHERE id = ? AND user_id = ?').bind(params.id, s.user.id).run();   // cards and note cascade
  return (res.meta?.changes ?? res.changes) ? json(204) : json(404, {error: 'not_found'});
}

/* ---- favourites ---- */
export async function listFavorites(req, env, _ctx, s) {
  const rows = (await env.DB.prepare('SELECT card_id, created_at FROM favorites WHERE user_id = ? ORDER BY created_at, card_id').bind(s.user.id).all()).results;
  return json(200, {favorites: rows});
}
export async function addFavorite(req, env, _ctx, s, params) {
  if (!CARD_IDS.has(params.card_id)) return json(400, {error: 'unknown_card'});
  await env.DB.prepare('INSERT OR IGNORE INTO favorites (user_id, card_id, created_at) VALUES (?, ?, ?)').bind(s.user.id, params.card_id, iso()).run();   // repeating it changes nothing
  return json(204);
}
export async function removeFavorite(req, env, _ctx, s, params) {
  await env.DB.prepare('DELETE FROM favorites WHERE user_id = ? AND card_id = ?').bind(s.user.id, params.card_id).run();
  return json(204);
}
