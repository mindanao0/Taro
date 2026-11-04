// Keeps privacy.html honest: the version, the retention periods and the list of stored data must match the code.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {POLICY_VERSION} from './config.mjs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const privacy = read('privacy.html'), terms = read('terms.html'), account = read('account.html'), index = read('index.html');
const num = (src, re, label) => { const m = src.match(re); assert.ok(m, 'could not find ' + label); return Number(m[1]); };

// the version text shown before JavaScript runs matches the configured one
for (const [name, html] of [['privacy', privacy], ['terms', terms]]) assert.ok(html.includes(`<span id="version">${POLICY_VERSION}</span>`), `${name}.html default version differs from POLICY_VERSION`);

// retention periods stated in the policy equal the ones the code enforces
const worker = read('worker/index.js'), apiIndex = read('api/index.js'), session = read('api/lib/session.mjs');
const rows = [
  ['raw click events', num(worker, /RAW_DAYS = (\d+)/, 'RAW_DAYS'), /ลำดับการกด \(ข้อมูลดิบ\)<\/td><td><strong>(\d+) วัน/],
  ['questions', num(worker, /QUESTION_DAYS = (\d+)/, 'QUESTION_DAYS'), /ข้อความคำถามที่ไม่ได้สมัครสมาชิก<\/td><td><strong>(\d+) วัน/],
  ['sessions', num(session, /SESSION_DAYS = (\d+)/, 'SESSION_DAYS'), /อุปกรณ์ที่เข้าสู่ระบบอยู่<\/td><td>ไม่เกิน <strong>(\d+) วัน/],
];
for (const [label, days, re] of rows) assert.equal(num(privacy, re, label + ' in policy'), days, `${label}: policy says a different number of days than the code`);
assert.equal(num(apiIndex, /DELETE FROM audit_log WHERE at < \?'\)\.bind\(new Date\(now\.getTime\(\) - (\d+) \*/, 'audit retention'), num(privacy, /บันทึกเหตุการณ์ด้านความปลอดภัย<\/td><td><strong>(\d+) วัน/, 'audit in policy'));
assert.equal(num(apiIndex, /deleted_at < \?'\)\.bind\(new Date\(now\.getTime\(\) - (\d+) \*/, 'deletion grace'), num(privacy, /ข้อมูลจะถูกลบถาวรหลังผ่านไป <strong>(\d+) วัน/, 'grace in policy'));
assert.equal(num(apiIndex, /DELETE FROM feedback WHERE created_at < \?'\)\.bind\(new Date\(now\.getTime\(\) - (\d+) \*/, 'feedback retention'), num(privacy, /ความเห็นที่ส่งมา<\/td><td><strong>(\d+) วัน/, 'feedback in policy'));

// every table the migrations create is covered by a sentence in the policy (add the table here, and to the policy, when you add one)
const covered = {
  users: 'ข้อมูลบัญชี', identities: 'รหัสประจำตัวของคุณที่ผู้ให้บริการนั้นออกให้', credentials: 'ค่าที่แฮชแล้ว', sessions: 'อุปกรณ์ที่เข้าสู่ระบบอยู่', email_tokens: 'ลิงก์ในอีเมลใช้ได้ครั้งเดียว',
  audit_log: 'บันทึกเหตุการณ์ด้านความปลอดภัย', consents: 'ความยินยอมของคุณ', deck_versions: null, readings: 'ประวัติการอ่านไพ่', reading_cards: 'ไพ่ในแต่ละตำแหน่ง', reading_notes: 'โน้ตส่วนตัว',
  favorites: 'ไพ่โปรด', line_subscriptions: 'แจ้งเตือนผ่าน LINE', feedback: 'ความเห็นที่ส่งมา', questions: 'ข้อความคำถาม', ui_sessions: 'ลำดับการกด', ui_events: 'ลำดับการกด', ui_daily_stats: 'สถิติรวมรายวัน'
};   // deck_versions holds no personal data
import {readdirSync} from 'node:fs';
const tables = new Set();
for (const dir of ['api/migrations', 'migrations']) for (const f of readdirSync(new URL('../' + dir + '/', import.meta.url))) for (const m of read(`${dir}/${f}`).matchAll(/CREATE TABLE (?:IF NOT EXISTS )?(\w+)/g)) tables.add(m[1]);
for (const t of tables) { assert.ok(t in covered, `table ${t} is not covered in scripts/policy.test.mjs: does privacy.html describe it?`); if (covered[t]) assert.ok(privacy.includes(covered[t]), `privacy.html no longer mentions "${covered[t]}" (table ${t})`); }

// the pages link to each other and sign-up points at both documents
assert.match(account, /terms\.html[\s\S]*privacy\.html/); assert.match(index, /href="privacy\.html"[\s\S]*href="terms\.html"/);
assert.match(privacy, /id="delete"/); assert.match(terms, /privacy\.html#delete/);
assert.ok(account.includes('terms_version: POLICY_VERSION'), 'sign-up sends the accepted version');

const open = (privacy.match(/class="todo"/g) || []).length + (terms.match(/class="todo"/g) || []).length;
console.log(`PASS: policy matches code (version ${POLICY_VERSION}, retention periods, ${tables.size} tables covered)` + (open ? ` · ${open} placeholders still to fill before launch` : ''));
