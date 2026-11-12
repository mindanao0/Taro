// LINE follow-up answers: routing by topic/keywords, safety first, one note per question, three different angles, no question text echoed back.  node scripts/line-ask.test.mjs
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {answer, MAX_ASKS, SAFETY_REPLY} from './line-ask.mjs';
const j = f => JSON.parse(readFileSync(new URL('../data/' + f, import.meta.url)));
const cards = j('cards.public.json').cards, extras = j('seo_extra.json'), model = j('topic_model.json');
const card = cards.find(c => c.id === 'major-06'), extra = extras[card.id], web = 'https://ivoryrosetarot.online';
const ask = (question, n = 1, lastTopic) => answer({card, extra, question, n, model, webUrl: web, lastTopic});

// safety comes first and is not a reading: no card text, no use of the day's quota
for (const q of ['อยากตาย', 'ไม่อยากอยู่แล้ว ทำยังไงดี', 'ทำร้ายตัวเอง']) { const r = ask(q); assert.equal(r.kind, 'safety'); assert.equal(r.text, SAFETY_REPLY); assert.ok(r.text.includes('1323')); }
assert.equal(ask('เลขเด็ดวันนี้อะไร').kind, 'boundary'); assert.equal(ask('ซื้อหวยดีไหม').kind, 'boundary');

// the lead text follows the topic (model, then keywords)
assert.ok(ask('คนที่คุยอยู่จริงจังกับฉันแค่ไหน').text.includes(card.love_th));
assert.ok(ask('ควรลาออกไปทำงานใหม่ดีไหม').text.includes(card.work_th));
assert.ok(ask('เดือนนี้ควรเก็บเงินยังไง').text.includes(extra.money_th));
assert.ok(ask('ช่วงนี้เหนื่อยและเครียดมาก').text.includes(extra.health_th));
assert.ok(ask('วันนี้ควรทำอะไรดี').text.includes(card.advice_th), 'no topic: the card\'s own advice');

// the thread: same topic again shows another side, then the final reflection; a new topic leads with that topic
const [a1, a2, a3] = [ask('ความรักของฉันเป็นยังไง', 1), ask('ความรักของฉันเป็นยังไง', 2, 'love'), ask('ความรักของฉันเป็นยังไง', 3, 'love')];
assert.ok(a1.text.includes(card.love_th) && a1.text.includes('ถามต่อได้อีก 2 ข้อ') && a1.topic === 'love');
assert.ok(a2.text.includes(card.advice_th) && a2.text.includes('อีกมุมหนึ่ง') && !a2.text.includes(card.love_th) && a2.text.includes('ถามต่อได้อีก 1 ข้อ'));
assert.ok(a3.text.includes(card.reflection_th) && a3.text.includes(card.keywords_th[0]) && a3.text.includes(web) && !a3.text.includes('ถามต่อได้') && !a3.quick, 'the last one says it is the last, no more buttons');
assert.equal(new Set([a1.text, a2.text, a3.text]).size, 3); assert.equal(MAX_ASKS, 3);
assert.ok(ask('แล้วเรื่องงานล่ะ', 2, 'love').text.includes(card.work_th), 'a new topic leads with that topic');
const last = ask('ถามเรื่องการงาน', 3, 'love'); assert.ok(last.text.includes(card.work_th) && last.text.includes(card.keywords_th[0]) && last.text.includes('นี่เป็นข้อสุดท้าย') && !last.quick, 'the last question still answers a new topic, then closes');
for (const more of ['ทำไม', 'ขอมุมอื่น', 'อธิบายเพิ่ม', 'แล้วไงต่อ?']) { const r = ask(more, 2, 'work'); assert.equal(r.kind, 'reading', more); assert.equal(r.topic, 'work', 'stays on the thread\'s topic'); assert.ok(r.text.includes('อีกมุมหนึ่ง'), more); }
assert.equal(ask('ทำไม', 1).topic, 'advice', 'nothing to continue: the card\'s own advice');

// buttons: pressing a topic label is a question about that topic, and the offered buttons are the other topics
for (const [label, field] of [['ถามเรื่องความรัก', card.love_th], ['ถามเรื่องการงาน', card.work_th], ['ถามเรื่องการเงิน', extra.money_th], ['ถามเรื่องใจและสุขภาพ', extra.health_th]]) { const r = ask(label); assert.equal(r.kind, 'reading', label); assert.ok(r.text.includes(field), label); assert.ok(!r.quick.includes(label)); }
const q1 = ask('ความรักของฉันเป็นยังไง').quick; assert.ok(q1.includes('ขอมุมอื่น') && q1.every(l => [...l].length <= 20) && q1.length <= 4);
for (const label of q1) assert.equal(ask(label, 2, 'love').kind, 'reading', `every button we offer is understood: ${label}`);

// small talk is answered kindly and costs nothing; it is only small talk when that is the whole message
assert.equal(ask('สวัสดี').kind, 'smalltalk'); assert.ok(ask('สวัสดี').text.includes(card.name_th) && ask('สวัสดี').quick);
assert.equal(ask('ขอบคุณค่ะ').kind, 'smalltalk'); assert.equal(ask('ขอบคุณมากนะ', 3).kind, 'smalltalk'); assert.ok(ask('ขอบคุณ', 4).text.includes('พรุ่งนี้') && !ask('ขอบคุณ', 4).quick, 'all used: nothing more to offer'); assert.ok(ask('ขอบคุณ', 2).text.includes('ถามได้อีก 2 ข้อ'), 'the count is what is left before the next question'); assert.ok(ask('สวัสดี', 4).text.includes('ถามครบแล้ว'));
assert.equal(ask('พอแล้ว').kind, 'smalltalk'); assert.equal(ask('พอแล้ว').quick, undefined);
assert.equal(ask('ขอบคุณ แล้วเรื่องงานล่ะ').kind, 'reading'); assert.equal(ask('สวัสดี อยากถามเรื่องงาน').kind, 'reading');

// wording varies between questions but is stable for the same one
assert.equal(ask('ความรักเป็นยังไง').text, ask('ความรักเป็นยังไง').text);
assert.ok(new Set(['ก', 'กข', 'กขค', 'กขคง'].map(x => ask('ความรัก ' + x).text.split('\n')[0])).size >= 2, 'different openers');

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
console.log('PASS: LINE follow-ups (safety first, topic routing, thread memory, buttons, small talk, reframes, no echo, all 78 cards x 3)');
