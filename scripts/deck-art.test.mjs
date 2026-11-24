import assert from 'node:assert/strict';
import {readFileSync, statSync} from 'node:fs';
import {createReading} from './reading-core.mjs';
import {DECKS, DEFAULT_DECK, CHRISTMAS_DECK, initialDeck, artFor} from './deck-art.mjs';
const root = new URL('../', import.meta.url);
const {cards} = JSON.parse(readFileSync(new URL('data/cards.public.json', root)));
for (const [q, saved, expect] of [[null,null,DEFAULT_DECK],[null,CHRISTMAS_DECK,CHRISTMAS_DECK],[DEFAULT_DECK,CHRISTMAS_DECK,DEFAULT_DECK],['__proto__','constructor',DEFAULT_DECK],['../private',CHRISTMAS_DECK,CHRISTMAS_DECK]]) assert.equal(initialDeck(q,saved),expect);
const spread = JSON.parse(readFileSync(new URL('data/spreads.json', root))).spreads[0];
assert.equal(createReading(cards,spread,{deckId:CHRISTMAS_DECK}).deck_id,CHRISTMAS_DECK);
assert.equal(createReading(cards,spread).deck_id,DEFAULT_DECK);
assert.throws(()=>createReading(cards,spread,{deckId:'not-a-deck'}));
const images = new Set();
for (const c of cards) {
 assert.equal(artFor(DEFAULT_DECK, c), c);
 const x = artFor(CHRISTMAS_DECK, c);
 assert.equal(c.id,x.id);
 for(const k of Object.keys(c)) if (!['image','image_web','alt_th'].includes(k)) assert.deepEqual(x[k], c[k]);
 assert.notEqual(c.image_web,x.image_web); assert.match(x.alt_th,/Christmas Wish/);
 assert.ok(!x.image_web.includes('draft')); assert.match(x.image_web,/^assets\/christmas-wish\/previews\//);
 const b=readFileSync(new URL(x.image_web,root)); assert.equal(b.subarray(0,4).toString(),'RIFF'); assert.equal(b.subarray(8,12).toString(),'WEBP');
 images.add(x.image_web);
}
assert.equal(images.size,78);
assert.ok(statSync(new URL(DECKS[CHRISTMAS_DECK].back,root)).size < 60_000);
assert.throws(()=>artFor(CHRISTMAS_DECK,{id:'major-22'}));assert.throws(()=>artFor(CHRISTMAS_DECK,{id:'cups-00'}));
console.log('PASS: 78 unique Christmas Wish WebP cards, unchanged common meanings, default and URL handling, optimized seasonal back');
