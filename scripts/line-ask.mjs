/** Follow-up answers in the LINE chat after the daily card. No AI and no generation: the topic model and a few keyword rules only pick
 *  WHICH hand-written text of today's card to show (card fields + data/seo_extra.json). Pure and DOM-free, shared by the Worker and the tests. */
import {topicFor} from './topic-model.mjs';

const SAFETY = /ฆ่าตัวตาย|อยากตาย|ไม่อยากมีชีวิต|ไม่อยากอยู่|ทำร้ายตัวเอง|จบชีวิต|หายไปจากโลก|suicide|kill myself/i;
const LOTTERY = /หวย|เลขเด็ด|เลขท้าย|สลาก|ถูกรางวัล|แทงบอล|พนัน/;
const MONEY = /เงิน|หนี้|รายได้|ออม|ลงทุน|ค่าใช้จ่าย|กำไร|ขายของ/;
const HEALTH = /สุขภาพ|เครียด|เหนื่อย|นอนไม่หลับ|หมดไฟ|ท้อแท้|ท้อใจ|กังวล|ร่างกาย/;
const MEDICAL = /ป่วย|โรค|มะเร็ง|ผ่าตัด|ตั้งครรภ์|ซึมเศร้า|อาการ|โรงพยาบาล|กินยา|ทานยา|ไปหาหมอ/;
const LEGAL = /ฟ้อง|คดี|ศาล|กฎหมาย|ตำรวจ|ทนาย/;
const OTHER = /(เขา|เธอ|เค้า|แฟน|คนนั้น|คนคุย|หัวหน้า).*(คิด|รู้สึก|รัก|คิดถึง|ชอบ|เกลียด)/;
const TIMING = /เมื่อไหร่|เมื่อไร|กี่วัน|กี่เดือน|กี่ปี|วันไหน|เดือนไหน|ปีไหน/;
const YESNO = /(ไหม|มั้ย|หรือเปล่า|รึเปล่า|หรือไม่|ป่ะ)\s*[?？]?\s*$/;

export const MAX_ASKS = 3;
export const SAFETY_REPLY = 'ฟังแล้วเป็นห่วงคุณนะ เรื่องนี้หนักเกินกว่าที่ไพ่จะช่วยได้ ถ้ากำลังคิดทำร้ายตัวเองหรือรู้สึกไม่ปลอดภัย โทรสายด่วนสุขภาพจิต 1323 ได้ตลอด 24 ชั่วโมง ถ้าฉุกเฉินโทร 1669 และลองบอกคนที่ไว้ใจให้มาอยู่ใกล้ ๆ ตอนนี้ คุณไม่ต้องอยู่กับเรื่องนี้คนเดียว';
export const LOTTERY_REPLY = 'ไพ่ไม่ใช่เครื่องมือเลือกเลขหรือเสี่ยงโชค ลองถามเรื่องที่ชวนทบทวนตัวเองแทน เช่น วันนี้ควรใส่ใจอะไรในเรื่องงาน ความรัก หรือการเงิน';
const NAME = {love: 'ความรัก', work: 'การงานและการเรียน', money: 'การเงิน', health: 'สุขภาพและพลังใจ', advice: 'เรื่องที่ถาม'};

/** question: what the visitor typed; n: which follow-up this is (1..MAX_ASKS). Returns {kind: 'safety' | 'boundary' | 'reading', text}.
 *  Only 'reading' uses up one of the day's questions. extra = {money_th, health_th} of the card. */
export function answer({card, extra = {}, question, n, model, webUrl}) {
  const q = String(question ?? '').slice(0, 300);
  if (SAFETY.test(q)) return {kind: 'safety', text: SAFETY_REPLY};
  if (LOTTERY.test(q)) return {kind: 'boundary', text: LOTTERY_REPLY};
  const topic = topicFor(model, q);
  const lead = topic === 'love' ? 'love' : MONEY.test(q) ? 'money' : topic === 'work' ? 'work' : HEALTH.test(q) ? 'health' : 'advice';
  const field = {love: card.love_th, work: card.work_th, money: extra.money_th, health: extra.health_th, advice: card.advice_th};
  const [head, body] = n <= 1 ? [`ถ้ามองเรื่อง${NAME[lead]}`, field[lead]]
    : n === 2 ? ['อีกมุมหนึ่ง', lead === 'advice' ? card.upright_th : card.advice_th]
    : ['ไว้ชวนคิดต่อ', `${card.reflection_th}\nคำสำคัญของไพ่ใบนี้: ${card.keywords_th.join(' · ')}`];
  const note = OTHER.test(q) ? 'ไพ่อ่านใจคนอื่นไม่ได้ ลองมองจากฝั่งของคุณเองแทน\n'
    : TIMING.test(q) ? 'ไพ่บอกเวลาไม่ได้ แต่บอกได้ว่าตอนนี้ควรใส่ใจอะไร\n'
    : YESNO.test(q) ? 'ไพ่ไม่ตอบว่าใช่หรือไม่ใช่ แต่ชวนมองแบบนี้\n' : '';
  const tail = MEDICAL.test(q) ? '\n\nเรื่องสุขภาพกายควรปรึกษาแพทย์ ไพ่ช่วยได้แค่ชวนคิดเรื่องใจ' : LEGAL.test(q) ? '\n\nเรื่องกฎหมายควรปรึกษาผู้เชี่ยวชาญ ไพ่ช่วยได้แค่ชวนคิด' : '';
  const left = MAX_ASKS - n;
  const foot = left > 0 ? `ถามต่อได้อีก ${left} ข้อวันนี้` : `นี่เป็นข้อสุดท้ายของวันนี้ พรุ่งนี้มีไพ่ใบใหม่ หรือเปิดไพ่เองได้ที่ ${webUrl}/\n(ใช้ทบทวนตัวเอง ไม่ใช่คำทำนาย)`;
  return {kind: 'reading', text: `จากไพ่ประจำวัน ${card.name_th} (${card.name_en})\n${note}${head}: ${body}${tail}\n\n${foot}`};
}
