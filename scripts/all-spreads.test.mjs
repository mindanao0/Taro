import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createReading,meaningFor} from './reading-core.mjs';
import {frameFor,bridgeFor,pairReadings} from './reading-guide.mjs';
const cards=JSON.parse(readFileSync('data/cards.json')).cards, spreads=JSON.parse(readFileSync('data/spreads.json')).spreads;
for(const spread of spreads) for(const orientation of ['upright','reversed']) {
  const reading=createReading(cards,spread,{reversed:orientation==='reversed',randomInt:n=>n-1});
  assert.equal(reading.cards.length,spread.positions.length);
  for(const r of reading.cards){r.orientation=orientation; const card=cards.find(c=>c.id===r.card_id); assert.ok(meaningFor(card,orientation)); assert.ok(frameFor(spread.id,r.position_id,orientation)); assert.ok(bridgeFor(spread.id,r.position_id,orientation,card));}
  const drawn=reading.cards.map(r=>({...r,card:cards.find(c=>c.id===r.card_id)}));
  for(const pair of pairReadings(spread.id,drawn)) assert.ok(pair.text);
}
console.log('PASS: all four spreads and both orientations');
