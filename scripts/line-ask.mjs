/** Follow-up chat in LINE after the daily card. No AI and no generation: the topic model and keyword rules only pick WHICH hand-written text of
 *  today's card to show (card fields + data/seo_extra.json). What makes it feel like a conversation: it remembers the topic of the day's thread
 *  (a word like "love", never the text), varies its wording, understands short replies ("why?", "another angle", thanks) and offers tap buttons.
 *  Pure and DOM-free, shared by the Worker and the tests. */
import {topicFor} from './topic-model.mjs';
import {topicOf} from './reading-guide.mjs';

const SAFETY = /ฆ่าตัวตาย|อยากตาย|ไม่อยากมีชีวิต|ไม่อยากอยู่|ทำร้ายตัวเอง|จบชีวิต|หายไปจากโลก|suicide|kill myself/i;
const LOTTERY = /หวย|เลขเด็ด|เลขท้าย|สลาก|ถูกรางวัล|แทงบอล|พนัน/;
const MONEY = /เงิน|หนี้|รายได้|ออม|ลงทุน|ค่าใช้จ่าย|กำไร|ขายของ/;
const HEALTH = /สุขภาพ|เครียด|เหนื่อย|นอนไม่หลับ|หมดไฟ|ท้อแท้|ท้อใจ|กังวล|ร่างกาย/;
const MEDICAL = /ป่วย|โรค|มะเร็ง|ผ่าตัด|ตั้งครรภ์|ซึมเศร้า|อาการ|โรงพยาบาล|กินยา|ทานยา|ไปหาหมอ/;
const LEGAL = /ฟ้อง|คดี|ศาล|กฎหมาย|ตำรวจ|ทนาย/;
const OTHER = /(เขา|เธอ|เค้า|แฟน|คนนั้น|คนคุย|หัวหน้า).*(คิด|รู้สึก|รัก|คิดถึง|ชอบ|เกลียด)/;
const TIMING = /เมื่อไหร่|เมื่อไร|กี่วัน|กี่เดือน|กี่ปี|วันไหน|เดือนไหน|ปีไหน/;
const YESNO = /(ไหม|มั้ย|หรือเปล่า|รึเปล่า|หรือไม่|ป่ะ)\s*[?？]?\s*$/;
// short messages that are not questions about the card
const END = '[\\sค่ะครับนะจ้าคะมาก!.]*$';
const GREET = new RegExp('^(สวัสดี|หวัดดี|ดีจ้า|ดีค่ะ|ดีครับ|hello|hi|hey)' + END, 'i'), THANKS = new RegExp('^(ขอบคุณ|ขอบใจ|thanks?|thx)' + END, 'i'), BYE = new RegExp('^(บาย|ลาก่อน|ไปก่อน|พอแล้ว|แค่นี้|ไม่มีแล้ว|bye)' + END, 'i');   // only when the whole message is that, so "thanks, and about work?" is still a question
// "why?", "another angle", "tell me more": stay on the topic of the thread
const MORE = /^(ทำไม|แล้วไง|แล้วไงต่อ|ต่อ|แล้วล่ะ|ยังไง|หมายความว่า|อธิบายเพิ่ม|เพิ่มเติม|มุมอื่น|ขอมุมอื่น)\s*(ว่า)?\s*[?？]?$/;

export const MAX_ASKS = 3;
export const TOPIC_BUTTONS = {love: 'ถามเรื่องความรัก', work: 'ถามเรื่องการงาน', money: 'ถามเรื่องการเงิน', health: 'ถามเรื่องใจและสุขภาพ'};   // LINE quick-reply labels are at most 20 characters
const BUTTON_OF = Object.entries(TOPIC_BUTTONS).map(([k, label]) => [label, k]);
const NAME = {love: 'ความรัก', work: 'การงานและการเรียน', money: 'การเงิน', health: 'สุขภาพและพลังใจ', advice: 'เรื่องที่ถาม'};
export const SAFETY_REPLY = 'ฟังแล้วเป็นห่วงคุณนะ เรื่องนี้หนักเกินกว่าที่ไพ่จะช่วยได้ ถ้ากำลังคิดทำร้ายตัวเองหรือรู้สึกไม่ปลอดภัย โทรสายด่วนสุขภาพจิต 1323 ได้ตลอด 24 ชั่วโมง ถ้าฉุกเฉินโทร 1669 และลองบอกคนที่ไว้ใจให้มาอยู่ใกล้ ๆ ตอนนี้ คุณไม่ต้องอยู่กับเรื่องนี้คนเดียว';
export const LOTTERY_REPLY = 'ไพ่ไม่ใช่เครื่องมือเลือกเลขหรือเสี่ยงโชค ลองถามเรื่องที่ชวนทบทวนตัวเองแทน เช่น วันนี้ควรใส่ใจอะไรในเรื่องงาน ความรัก หรือการเงิน';

const pick = (list, seed) => list[seed % list.length];   // same input, same wording (testable); different inputs vary

/** question: what was typed; n: which question of the day this would be (1..MAX_ASKS); lastTopic: topic key remembered from the thread, if any.
 *  Returns {kind: 'safety' | 'boundary' | 'smalltalk' | 'reading', text, topic, foot, quick}. Only 'reading' uses up one of the day's questions;
 *  foot is the "N left" line (text already ends with it), quick = labels for LINE quick-reply buttons. */
export function answer({card, extra = {}, question, n, model, webUrl, lastTopic}) {
  const q = String(question ?? '').trim().slice(0, 300), left = Math.max(0, MAX_ASKS - n), remaining = left + 1;   // left: after this question; remaining: before it (what small talk reports)
  if (SAFETY.test(q)) return {kind: 'safety', text: SAFETY_REPLY};
  if (LOTTERY.test(q)) return {kind: 'boundary', text: LOTTERY_REPLY};
  const topics = Object.keys(TOPIC_BUTTONS), buttons = except => ['ขอมุมอื่น', ...topics.filter(k => k !== except).map(k => TOPIC_BUTTONS[k])].slice(0, 4);
  if (q.length <= 24 && !BUTTON_OF.some(([l]) => q.startsWith(l)) && !MORE.test(q)) {
    const chat = THANKS.test(q) ? `ยินดีนะ ${n <= MAX_ASKS ? `ถ้ายังอยากคุยต่อ ถามได้อีก ${remaining} ข้อวันนี้` : 'พรุ่งนี้มีไพ่ใบใหม่รออยู่'} ขอให้วันนี้เป็นวันที่ดีกับตัวเอง`
      : BYE.test(q) ? 'ไว้คุยกันใหม่พรุ่งนี้นะ ดูแลตัวเองด้วย'
      : GREET.test(q) ? `สวัสดี วันนี้ไพ่ของคุณคือ ${card.name_th} อยากถามอะไรกับใบนี้ พิมพ์มาได้เลย หรือเลือกหัวข้อด้านล่าง ${n <= MAX_ASKS ? `ถามได้อีก ${remaining} ข้อ` : 'วันนี้ถามครบแล้ว'}` : null;
    if (chat) return {kind: 'smalltalk', text: chat, quick: n <= MAX_ASKS && !BYE.test(q) ? buttons() : undefined};
  }
  const pressed = BUTTON_OF.find(([l]) => q.startsWith(l))?.[1];
  // a short message that names its topic ("and work?") goes by the keyword: filler words like "แล้ว...ล่ะ" mislead the model on short text
  const kw = topicOf(q), topic = kw !== 'general' && q.length <= 20 ? kw : topicFor(model, q);
  const lead = pressed ? pressed : MORE.test(q) ? lastTopic || 'advice'
    : topic === 'love' ? 'love' : MONEY.test(q) ? 'money' : topic === 'work' ? 'work' : HEALTH.test(q) ? 'health' : 'advice';
  const field = {love: card.love_th, work: card.work_th, money: extra.money_th, health: extra.health_th, advice: card.advice_th};
  const again = lead === lastTopic;   // same topic as the thread so far: show another side of the card instead of repeating
  const [head, body] = again && n >= MAX_ASKS ? ['ไว้ชวนคิดต่อ', `${card.reflection_th}\nคำสำคัญของไพ่ใบนี้: ${card.keywords_th.join(' · ')}`]   // the last one closes the thread with the card's own question, unless they just asked about something new
    : again ? ['อีกมุมหนึ่ง', lead === 'advice' ? card.upright_th : card.advice_th]
    : [`ถ้ามองเรื่อง${NAME[lead]}`, n >= MAX_ASKS ? `${field[lead]}\nคำสำคัญของไพ่ใบนี้: ${card.keywords_th.join(' · ')}` : field[lead]];
  const name = `${card.name_th} (${card.name_en})`, seed = n + q.length;
  const opener = n <= 1 ? pick([`ขอดูจากไพ่ประจำวัน ${name} นะ`, `ไพ่ของวันนี้คือ ${name} ลองดูในมุมที่ถามนะ`, `ได้เลย ไพ่ใบของวันนี้คือ ${name}`], seed)
    : pick([`ยังเป็นใบเดิม ${card.name_th} นะ`, `กลับมาที่ ${card.name_th} อีกครั้ง`, `ใบเดิมของวันนี้ ${card.name_th}`], seed);
  const note = OTHER.test(q) ? 'ไพ่อ่านใจคนอื่นไม่ได้ ลองมองจากฝั่งของคุณเองแทน\n'
    : TIMING.test(q) ? 'ไพ่บอกเวลาไม่ได้ แต่บอกได้ว่าตอนนี้ควรใส่ใจอะไร\n'
    : YESNO.test(q) ? 'ไพ่ไม่ตอบว่าใช่หรือไม่ใช่ แต่ชวนมองแบบนี้\n' : '';
  const tail = MEDICAL.test(q) ? '\n\nเรื่องสุขภาพกายควรปรึกษาแพทย์ ไพ่ช่วยได้แค่ชวนคิดเรื่องใจ' : LEGAL.test(q) ? '\n\nเรื่องกฎหมายควรปรึกษาผู้เชี่ยวชาญ ไพ่ช่วยได้แค่ชวนคิด' : '';
  const foot = left > 0 ? `ถามต่อได้อีก ${left} ข้อวันนี้ หรือกดปุ่มด้านล่าง` : `นี่เป็นข้อสุดท้ายของวันนี้ พรุ่งนี้มีไพ่ใบใหม่ หรือเปิดไพ่เองได้ที่ ${webUrl}/\n(ใช้ทบทวนตัวเอง ไม่ใช่คำทำนาย)`;
  return {kind: 'reading', topic: lead, foot, quick: left > 0 ? buttons(lead) : undefined, text: `${opener}\n${note}${head}: ${body}${tail}\n\n${foot}`};
}
