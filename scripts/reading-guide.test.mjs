import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {POSITIONS, PAIRS, elementOf, relation, frameFor, pairReadings} from './reading-guide.mjs';
const read = f => JSON.parse(readFileSync(new URL(f, import.meta.url)));
const cards = read('../data/cards.public.json').cards, {spreads} = read('../data/spreads.json');

// every card has an element; relations are symmetric
for (const c of cards) assert.ok(['fire', 'water', 'air', 'earth'].includes(elementOf(c)), c.id);
for (const a of ['fire', 'water', 'air', 'earth']) for (const b of ['fire', 'water', 'air', 'earth']) assert.equal(relation(a, b), relation(b, a));
assert.equal(relation('fire', 'air'), 'feed'); assert.equal(relation('fire', 'water'), 'oppose'); assert.equal(relation('fire', 'earth'), 'neutral');

// every spread position has its own frame; nothing extra
const keys = spreads.flatMap(s => s.positions.map(p => `${s.id}:${p.id}`));
assert.deepEqual(Object.keys(POSITIONS).sort(), [...keys].sort());
// pair roles point at real positions and carry all five sentences
for (const [sid, roles] of Object.entries(PAIRS)) {
  const ids = spreads.find(s => s.id === sid).positions.map(p => p.id);
  for (const r of roles) {
    assert.ok(r.at.every(id => ids.includes(id)), `${sid} ${r.title}`);
    for (const k of ['same', 'feed', 'oppose', 'neutral', 'mixed']) assert.ok(r[k]?.length > 20, `${sid} ${r.title} ${k}`);
  }
}
// no sentence is reused anywhere
const all = [...Object.values(POSITIONS).flatMap(p => [p.read, p.up, p.rev]),
  ...Object.values(PAIRS).flat().flatMap(r => [r.title, r.same, r.feed, r.oppose, r.neutral, r.mixed])];
assert.equal(new Set(all).size, all.length, 'duplicate wording');

// end-to-end: a three-card reading yields two pair readings, text has no unfilled slots
const pick = id => cards.find(c => c.id === id);
const drawn = [['p1', 'wands-five', 'upright'], ['p2', 'cups-two', 'reversed'], ['p3', 'major-17', 'upright']]
  .map(([position_id, id, orientation], i) => ({position_id, card: pick(id), orientation, i}));
const out = pairReadings('three', drawn);
assert.equal(out.length, 2);
assert.ok(out.every(x => !/[{}]/.test(x.text)), 'unfilled slot');
assert.ok(out[0].text.includes('ใบหนึ่ง') || out[0].text.includes('สองใบอยู่คนละท่า'), 'mixed orientation note');
assert.equal(pairReadings('three', drawn, d => d.i !== 1).length, 0, 'closed cards must not be read');
assert.ok(!/[{}]/.test(frameFor('three', 'p1', pick('wands-five'), 'upright', 'x')));
console.log(`PASS: ${keys.length} position frames, ${Object.values(PAIRS).flat().length} pair roles, ${all.length} unique sentences`);
