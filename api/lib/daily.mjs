// Card of the day: the same card for everyone on a given Thai calendar day, computed (nothing stored).
import {hmac} from './crypto.mjs';
import {CARDS, deckVersion} from './deck.mjs';
import {json} from './http.mjs';

const THAI_OFFSET_MS = 7 * 3_600_000;
export const bangkokDate = (ms = Date.now()) => new Date(ms + THAI_OFFSET_MS).toISOString().slice(0, 10);
const secondsToThaiMidnight = (ms = Date.now()) => Math.max(1, Math.ceil((86_400_000 - ((ms + THAI_OFFSET_MS) % 86_400_000)) / 1000));

// First 4-byte chunk that falls inside the largest multiple of n below 2^32, as an index in [0, n); null if every chunk is in the uneven tail.
// Taking `value % n` of the tail would favour low indexes, so those chunks are skipped (same rule as scripts/reading-core.mjs).
export function unbiasedIndex(bytes, n) {
  const limit = Math.floor(2 ** 32 / n) * n;
  for (let o = 0; o + 4 <= bytes.length; o += 4) {
    const v = ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0;
    if (v < limit) return v % n;
  }
  return null;
}
export async function pickIndex(secret, date, n) {
  for (let round = 0; round < 64; round++) {
    const i = unbiasedIndex(await hmac(secret, `${date}#${round}`), n);
    if (i !== null) return i;
  }
  throw new Error('no unbiased value');
}
export const dailyCardId = async (secret, date) => CARDS[await pickIndex(secret, date, CARDS.length)].id;

export async function dailyCard(req, env) {
  if (!env.DAILY_SECRET) return json(503, {error: 'not_configured'});
  const today = bangkokDate(), asked = new URL(req.url).searchParams.get('date');
  const date = asked ?? today;
  // only real, past-or-present dates: tomorrow's card must not be readable in advance
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date || date > today || date < '2024-01-01') return json(400, {error: 'invalid_date'});
  const age = date === today ? secondsToThaiMidnight() : 86_400;
  return json(200, {date, card_id: await dailyCardId(env.DAILY_SECRET, date), deck_version: await deckVersion()}, {'cache-control': `public, max-age=${age}`});
}
