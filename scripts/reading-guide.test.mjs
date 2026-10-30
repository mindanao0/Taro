import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {POSITIONS, PAIRS, elementOf, relation, frameFor, pairReadings, bridgeFor, ASK, topicOf, useFor} from './reading-guide.mjs';
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
assert.ok(out[0].text.endsWith(PAIRS.three[0].mixed), 'mixed orientation note');
assert.equal(pairReadings('three', drawn, d => d.i !== 1).length, 0, 'closed cards must not be read');
assert.ok(frameFor('three', 'p1', 'upright').length > 10 && frameFor('three', 'p1', 'reversed') !== frameFor('three', 'p1', 'upright'));
// card-aware bridge: every card x position x orientation
assert.deepEqual(Object.keys(ASK).sort(), [...keys].sort());
const seen = new Set();
for (const s of spreads) for (const p of s.positions) for (const c of cards) for (const o of ['upright', 'reversed']) {
  const t = bridgeFor(s.id, p.id, o, c), where = `${s.id}:${p.id} ${c.id} ${o}`;
  assert.ok(typeof t === 'string' && t.length >= 20 && t.length <= 160, `length ${where}: ${t}`);
  assert.ok(!/[{}]|undefined/.test(t), `bad token ${where}: ${t}`);
  assert.ok(t.includes(c.name_en) && t.includes(c.keywords_th[0]), `card-aware ${where}: ${t}`);
  assert.equal(bridgeFor(s.id, p.id, o, c), t, 'deterministic');
  if (s.id === 'three' && p.id === 'p1' && o === 'upright') seen.add(t);
}
assert.ok(seen.size >= 20, `only ${seen.size} distinct bridges`);
assert.notEqual(bridgeFor('three', 'p1', 'upright', pick('major-18')), bridgeFor('three', 'p1', 'reversed', pick('major-18')));
// question topic: each topic, plus the traps (heal != love, marry = love not work), empty and tied input
for (const [q, want] of [['เขาจะกลับมาคืนดีกับฉันไหม', 'love'], ['ควรลาออกไปสัมภาษณ์งานใหม่ไหม', 'work'], ['ปีนี้ฉันควรสอบเข้ามหาวิทยาลัยไหม', 'work'],
  ['ช่วงนี้เครียดและท้อ ควรทำอย่างไร', 'self'], ['เราจะแต่งงานกันไหม', 'love'], ['ควรรักษาสุขภาพอย่างไร', 'self'],
  ['', 'general'], [undefined, 'general'], ['ไพ่บอกอะไรฉันบ้าง', 'general'], ['แฟนกับงานอะไรสำคัญกว่า', 'general']]) assert.equal(topicOf(q), want, q);
assert.equal(useFor('love', 'advice'), 'love'); assert.equal(useFor('self', 'work'), 'advice'); assert.equal(useFor('general', 'work'), 'work'); assert.equal(useFor('general', undefined), undefined);
console.log(`PASS: ${keys.length} position frames, ${Object.values(PAIRS).flat().length} pair roles, ${all.length} unique sentences`);
