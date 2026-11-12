// LINE follow-up answers: routing by topic/keywords, safety first, one note per question, three different angles, no question text echoed back.  node scripts/line-ask.test.mjs
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {answer, MAX_ASKS, SAFETY_REPLY} from './line-ask.mjs';
const j = f => JSON.parse(readFileSync(new URL('../data/' + f, import.meta.url)));
const cards = j('cards.public.json').cards, extras = j('seo_extra.json'), model = j('topic_model.json');
const card = cards.find(c => c.id === 'major-06'), extra = extras[card.id], web = 'https://ivoryrosetarot.online';
const ask = (question, n = 1) => answer({card, extra, question, n, model, webUrl: web});

// safety comes first and is not a reading: no card text, no use of the day's quota
for (const q of ['อยากตาย', 'ไม่อยากอยู่แล้ว ทำยังไงดี', 'ทำร้ายตัวเอง']) { const r = ask(q); assert.equal(r.kind, 'safety'); assert.equal(r.text, SAFETY_REPLY); assert.ok(r.text.includes('1323')); }
assert.equal(ask('เลขเด็ดวันนี้อะไร').kind, 'boundary'); assert.equal(ask('ซื้อหวยดีไหม').kind, 'boundary');

// the lead text follows the topic (model, then keywords)
assert.ok(ask('คนที่คุยอยู่จริงจังกับฉันแค่ไหน').text.includes(card.love_th));
assert.ok(ask('ควรลาออกไปทำงานใหม่ดีไหม').text.includes(card.work_th));
assert.ok(ask('เดือนนี้ควรเก็บเงินยังไง').text.includes(extra.money_th));
assert.ok(ask('ช่วงนี้เหนื่อยและเครียดมาก').text.includes(extra.health_th));
assert.ok(ask('วันนี้ควรทำอะไรดี').text.includes(card.advice_th), 'no topic: the card\'s own advice');

// three different angles for the same card, with the remaining count
const [a1, a2, a3] = [1, 2, 3].map(n => ask('ความรักของฉันเป็นยังไง', n).text);
assert.ok(a1.includes(card.love_th) && a1.includes('ถามต่อได้อีก 2 ข้อ'));
assert.ok(a2.includes(card.advice_th) && !a2.includes(card.love_th) && a2.includes('ถามต่อได้อีก 1 ข้อ'));
assert.ok(a3.includes(card.reflection_th) && a3.includes(card.keywords_th[0]) && a3.includes(web) && !a3.includes('ถามต่อได้'), 'the last one says it is the last');
assert.equal(new Set([a1, a2, a3]).size, 3); assert.equal(MAX_ASKS, 3);

// questions the cards cannot answer are reframed, once each
assert.ok(ask('เขาคิดยังไงกับฉัน').text.includes('ไพ่อ่านใจคนอื่นไม่ได้'));
assert.ok(ask('เมื่อไหร่จะได้เจอคนที่ใช่').text.includes('ไพ่บอกเวลาไม่ได้'));
assert.ok(ask('เราจะกลับมาคบกันไหม').text.includes('ไพ่ไม่ตอบว่าใช่หรือไม่ใช่'));
assert.ok(!ask('วันนี้ควรทำอะไรดี').text.includes('ไพ่ไม่ตอบ') && !ask('วันนี้ควรทำอะไรดี').text.includes('ไพ่บอกเวลา'));
assert.ok(ask('ป่วยเป็นมะเร็งจะหายไหม').text.includes('ปรึกษาแพทย์'));
assert.ok(ask('ควรฟ้องบริษัทไหม').text.includes('ผู้เชี่ยวชาญ'));

// never echoes the question back (it is not kept anywhere), tolerates junk and long input
const secret = 'ชื่อลับสุดยอด1234';
assert.ok(!ask(`${secret} รักกันไหม`).text.includes(secret));
for (const q of ['', '   ', '?', undefined, 'a'.repeat(5000), '😀😀😀']) assert.equal(ask(q).kind, 'reading');
assert.ok(cards.every(c => extras[c.id]), 'every card has its money/health text');
for (const c of cards) for (const n of [1, 2, 3]) { const t = answer({card: c, extra: extras[c.id], question: 'เรื่องงานและเงิน', n, model, webUrl: web}).text; assert.ok(t.length < 1500 && !t.includes('undefined'), `${c.id} n=${n}`); }
console.log('PASS: LINE follow-ups (safety first, topic routing, 3 angles per card, reframes, no echo, all 78 cards x 3)');
