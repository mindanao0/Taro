/** No dependencies. Import into browser or Node. Does not persist or transmit data. */
export function randomBelow(limit, cryptoProvider = globalThis.crypto) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 0x100000000) throw new RangeError('Invalid limit');
  if (!cryptoProvider?.getRandomValues) throw new Error('Web Crypto is required');
  const cutoff = Math.floor(0x100000000 / limit) * limit;
  const sample = new Uint32Array(1);
  do { cryptoProvider.getRandomValues(sample); } while (sample[0] >= cutoff);
  return sample[0] % limit;
}
export function shuffled(items, randomInt = randomBelow) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    if (!Number.isInteger(j) || j < 0 || j > i) throw new RangeError('Invalid random sample');
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
export function createReading(cards, spread, {question = '', reversed = false, randomInt = randomBelow, now = () => new Date().toISOString()} = {}) {
  if (!Array.isArray(cards) || !Array.isArray(spread?.positions)) throw new TypeError('Invalid deck or spread');
  const ids = cards.map(c => c.id);
  if (ids.some(id => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length) throw new Error('Card IDs must be unique');
  if (spread.positions.length > cards.length || spread.positions.length < 1) throw new RangeError('Invalid position count');
  const posIds = spread.positions.map(p => p.id);
  if (new Set(posIds).size !== posIds.length) throw new Error('Position IDs must be unique');
  const dealt = shuffled(ids, randomInt).slice(0, spread.positions.length);
  return {
    schema_version: '1.0.0', deck_id: 'gothic-ivory-rose', spread_id: spread.id,
    question: String(question), created_at: now(), reversed_enabled: Boolean(reversed),
    cards: dealt.map((card_id, i) => ({
      card_id, position_id: spread.positions[i].id,
      orientation: reversed && randomInt(2) === 1 ? 'reversed' : 'upright'
    }))
  };
}
export function meaningFor(card, orientation) {
  if (!['upright', 'reversed'].includes(orientation)) throw new Error('Unknown orientation');
  return orientation === 'reversed' ? card.reversed_th : card.upright_th;
}
