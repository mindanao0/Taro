import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read = f => JSON.parse(readFileSync(new URL(f, import.meta.url)));
const {roles, cards} = read('../data/position_meanings_major.json');
const {spreads} = read('../data/spreads.json');
const major = read('../data/cards.public.json').cards.filter(c => c.arcana === 'major');

// every spread position maps to a role
const keys = spreads.flatMap(s => s.positions.map(p => `${s.id}:${p.id}`));
assert.equal(keys.length, 19);
for (const k of keys) assert.ok(roles[k], `no role for ${k}`);
assert.deepEqual(Object.keys(roles).sort(), [...keys].sort(), 'extra role keys');

// 22 cards x 14 roles x {up, rev}
const roleNames = [...new Set(Object.values(roles))];
assert.equal(roleNames.length, 14);
assert.equal(major.length, 22);
const all = [];
for (const c of major) for (const r of roleNames) for (const o of ['up', 'rev']) {
  const t = cards[c.id]?.[r]?.[o], at = `${c.id}/${r}/${o}`;
  assert.equal(typeof t, 'string', `missing ${at}`);
  assert.ok(t.trim() === t && t.length >= 25 && t.length <= 220, `length ${t.length}: ${at}`);
  assert.ok(!/[{}]/.test(t), `placeholder: ${at}`);
  all.push(t);
}
assert.equal(all.length, 616);
assert.equal(new Set(all).size, all.length, 'duplicate text');
assert.deepEqual(Object.keys(cards).sort(), major.map(c => c.id).sort(), 'extra cards');
console.log(`PASS: ${keys.length} position keys, ${roleNames.length} roles, ${all.length} unique texts`);
