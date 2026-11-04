# คู่มือดูแลระบบหลัง deploy (Runbook)

สำหรับผู้ดูแลที่มีสิทธิ์ใน Cloudflare account คำสั่งทั้งหมดรันจากโฟลเดอร์ `api/` (ฐานข้อมูล `taro`) และมีผลกับข้อมูลจริงเมื่อใส่ `--remote` **ก่อนรันคำสั่งที่แก้หรือลบข้อมูล ให้ `SELECT` ดูแถวเป้าหมายก่อนเสมอ** และอย่าส่งผลลัพธ์ที่มีอีเมลหรือข้อความของผู้ใช้ไปที่อื่น (แชต, ตั๋วงาน) ข้อมูลเหล่านี้อยู่ภายใต้นโยบายความเป็นส่วนตัว

## 1. เช็กสุขภาพระบบ (ทุกสัปดาห์หรือเมื่อมีเรื่องผิดปกติ)

| ดูอะไร | วิธี |
|---|---|
| Worker ตอบไหม | `curl -s https://api.ivoryrosetarot.online/auth/providers` ควรได้ `{"providers":[...]}` |
| ข้อผิดพลาดสด | `wrangler tail` (ระบบไม่เขียนอีเมล รหัสผ่าน หรือลิงก์ลง log) |
| cron ทำงานไหม | Cloudflare dashboard → Workers → `taro-api` → Triggers ดูการรันล่าสุด หรือตรวจว่า `sessions` ที่หมดอายุไม่ค้างสะสม |
| ผู้ใช้และข้อมูลโดยรวม | `wrangler d1 execute taro --remote --command "SELECT (SELECT COUNT(*) FROM users) users, (SELECT COUNT(*) FROM sessions) sessions, (SELECT COUNT(*) FROM readings) readings, (SELECT COUNT(*) FROM feedback WHERE status='new') new_feedback"` |
| อีเมลออกไหม | Resend dashboard → Logs (อีเมลยืนยัน/ตั้งรหัสผ่านที่ไม่ถึงผู้ใช้มักเป็น SPF/DKIM หรือคีย์หมดอายุ) |
| ข้อความ LINE ออกไหม | LINE Official Account Manager → สถิติข้อความ ดูโควตาที่เหลือ และ log ของ Worker มีบรรทัด `line reminders` พร้อม `aborted: 'auth'` ถ้า token ใช้ไม่ได้ |

สัญญาณที่ต้องตามเรื่อง:
- log มี `line reminders {aborted: 'auth'}` → channel access token ของ LINE หมดอายุหรือผิด (ข้อ 4) ไม่มีผู้ใช้คนไหนถูกบล็อก ออก token ใหม่แล้วข้อความจะส่งต่อเองรอบถัดไป
- log มี `PBKDF2 count refused, using fallback` → แพลตฟอร์มปฏิเสธจำนวนรอบสูง ระบบยังใช้งานได้ด้วย 100,000 รอบ ตรวจเอกสาร Cloudflare ล่าสุด
- 429 จำนวนมากใน `/auth/login` → มีคนลองเดารหัสผ่าน ดูข้อ 5

## 2. สำรองและกู้ข้อมูล

- D1 มี Time Travel (กู้ย้อนหลังตามจำนวนวันที่แพ็กเกจกำหนด ตรวจเงื่อนไขล่าสุด): `wrangler d1 time-travel info taro` และ `wrangler d1 time-travel restore taro --timestamp <เวลา>`
- ส่งออกสำรองเป็นไฟล์เอง (เก็บไว้ที่ปลอดภัยและเข้ารหัส): `wrangler d1 export taro --remote --output backup.sql`
- ข้อมูลที่ถูกลบตามคำขอของผู้ใช้จะยังอยู่ในไฟล์สำรองได้ตามรอบที่เก็บ ต้องระบุในนโยบาย (ช่อง `[ ]` ในหัวข้อ "เก็บนานแค่ไหน" ของ `privacy.html`) และ**เมื่อกู้จากสำรอง ให้ลบบัญชีที่ผู้ใช้ขอลบไปแล้วซ้ำอีกครั้ง** (ดู `audit_log` เหตุการณ์ `delete_account` หลังเวลาที่สำรอง)

## 3. หมุนความลับ (secret rotation)

ใส่ค่าใหม่ด้วย `wrangler secret put <ชื่อ>` แล้ว `wrangler deploy` ผลที่เกิดต่อผู้ใช้:

| ความลับ | ผลเมื่อเปลี่ยน | ควรหมุนเมื่อ |
|---|---|---|
| `RESEND_API_KEY` | ไม่มีผลต่อผู้ใช้ | ปีละครั้ง หรือสงสัยว่ารั่ว |
| `COOKIE_SECRET` | คนที่กำลังกดเข้าสู่ระบบด้วย Google/LINE/Facebook อยู่ต้องเริ่มใหม่ (cookie ช่วงสั้น 10 นาที) และตัวนับล็อกเอาต์กับตัวนับอีเมลถูกรีเซ็ต (รหัสแบบมีกุญแจเปลี่ยน) session เดิมของผู้ใช้ **ไม่หลุด** | ปีละครั้ง หรือสงสัยว่ารั่ว |
| `DAILY_SECRET` | ไพ่ประจำวันของ**วันที่ผ่านมาแล้วเปลี่ยนตาม** (คำนวณใหม่ทุกครั้ง ไม่ได้เก็บ) และถ้ามีคนรู้ค่านี้ เขาเดาไพ่ของวันหน้าได้ | หมุนเฉพาะเมื่อรั่ว |
| `GOOGLE_*`, `LINE_CHANNEL_*`, `FACEBOOK_APP_*` | ต้องเปลี่ยนที่ฝั่ง provider พร้อมกัน ระหว่างนั้นปุ่มนั้นล็อกอินไม่ได้ | เมื่อ provider แจ้ง หรือสงสัยว่ารั่ว |
| `LINE_MESSAGING_TOKEN`, `LINE_MESSAGING_SECRET` | ออก token ใหม่ใน LINE Developers ก่อน แล้ว put ทันที (ข้อความเตือนจะหยุดช่วงสั้น ๆ ไม่มีใครถูกบล็อก) ถ้าเปลี่ยน secret webhook จะ 401 จนกว่าค่าตรงกัน | ปีละครั้ง หรือสงสัยว่ารั่ว |

ถ้าสงสัยว่ามีการเข้าบัญชีโดยไม่ได้รับอนุญาตเป็นวงกว้าง ให้ออกจากระบบทุกคนทันที:

```bash
wrangler d1 execute taro --remote --command "DELETE FROM sessions"
```

และลบลิงก์ที่ค้างอยู่ทั้งหมด: `DELETE FROM email_tokens`

## 4. LINE: token หมดอายุหรือเปลี่ยน

1. LINE Developers Console → Messaging API channel → ออก Channel access token ใหม่
2. `wrangler secret put LINE_MESSAGING_TOKEN`
3. ไม่ต้อง deploy ใหม่ ข้อความจะส่งต่อในรอบชั่วโมงถัดไป (ผู้ใช้ที่ครบเวลาแล้วจะได้ในวันเดียวกัน)
4. ตรวจผู้ใช้ที่ถูกปิดเพราะถูกปฏิเสธซ้ำ: `SELECT user_id, fail_count, blocked_at FROM line_subscriptions WHERE blocked_at IS NOT NULL`

## 5. ตามเรื่องบัญชี

ค้นหาผู้ใช้ (ผลลัพธ์มีข้อมูลส่วนบุคคล ระวังที่เก็บ):

```bash
wrangler d1 execute taro --remote --command "SELECT id, email, email_verified, created_at, last_login_at, deleted_at FROM users WHERE email = 'someone@example.com'"
```

ประวัติความปลอดภัยของบัญชีหนึ่ง (เก็บ 90 วัน): `SELECT event, provider, at FROM audit_log WHERE user_id = '<id>' ORDER BY id DESC LIMIT 50`

| สถานการณ์ | ทำอะไร |
|---|---|
| ผู้ใช้บอกว่าบัญชีถูกคนอื่นเข้า | ให้ผู้ใช้ตั้งรหัสผ่านใหม่ผ่านเว็บ (ออกจากระบบทุกเครื่องให้เอง) และ "ออกจากระบบอุปกรณ์อื่นทั้งหมด" ถ้าแก้ไม่ทัน: `DELETE FROM sessions WHERE user_id = '<id>'` และตรวจ `identities` ว่ามีการผูก LINE/Facebook ที่ไม่รู้จักไหม |
| ผู้ใช้ขอลบข้อมูลทางอีเมล (รวมคำขอลบข้อมูล Facebook) | ให้ใช้ปุ่มลบบัญชีในหน้าเว็บถ้าทำได้ ถ้าเข้าไม่ได้ ตรวจยืนยันตัวตนผ่านอีเมลที่ลงทะเบียน แล้ว `UPDATE users SET deleted_at = datetime('now') WHERE id = '<id>'` (ระบบลบถาวรหลัง 30 วัน) หรือลบทันทีด้วย `DELETE FROM users WHERE id = '<id>'` (ตารางที่ผูกกับผู้ใช้ลบตามเอง) ตอบผู้ขอภายในเวลาที่ประกาศในนโยบาย |
| ผู้ใช้ขอสำเนาข้อมูล | ให้ใช้ปุ่ม "ดาวน์โหลดข้อมูลทั้งหมดของฉัน" |
| ผู้ใช้ถูกล็อกเพราะลองรหัสผิด | รอ 15 นาที หรือให้ใช้ลืมรหัสผ่าน ตัวนับล้างตัวเองตามเวลา (ลบแถวเร็วกว่านั้นต้องรู้ค่ารหัสแบบมีกุญแจ จึงทำด้วยมือไม่ได้ ไม่ต้องทำ) |
| ผู้ใช้ไม่ได้รับอีเมลยืนยัน | ดู Resend Logs และให้กด "ส่งอีเมลยืนยันอีกครั้ง" ในหน้าบัญชี (จำกัด 3 ครั้งต่อชั่วโมง) |

## 6. จัดการความเห็นที่ส่งมา

```bash
wrangler d1 execute taro --remote --command "SELECT id, created_at, kind, page, body FROM feedback WHERE status = 'new' ORDER BY created_at"
wrangler d1 execute taro --remote --command "UPDATE feedback SET status = 'done' WHERE id = '<id>'"
```

ข้อความถูกลบเองหลัง 365 วัน

## 7. เหตุข้อมูลรั่วไหล

หากสงสัยว่าข้อมูลผู้ใช้รั่ว (ฐานข้อมูล, ไฟล์สำรอง, secret, บัญชี Cloudflare ถูกเข้า):

1. **หยุดเลือดก่อน:** หมุนความลับที่เกี่ยวข้อง (ข้อ 3), ลบ session ทั้งหมด, เปลี่ยนรหัสผ่านและตรวจ 2FA ของบัญชี Cloudflare/Resend/Google/LINE/Facebook ที่ใช้ดูแล
2. **ประเมินขอบเขต:** ข้อมูลอะไร ของใคร ช่วงเวลาไหน (`audit_log` เก็บ 90 วัน และ Cloudflare มี audit log ของบัญชี) รหัสผ่านถูกเก็บเป็นแฮชแบบ PBKDF2 ส่วนคำถามและโน้ตของผู้ใช้เก็บเป็นข้อความธรรมดา ซึ่งอาจมีเรื่องอ่อนไหว
3. **แจ้ง:** ตามนโยบายความเป็นส่วนตัว หากมีความเสี่ยงต่อสิทธิของเจ้าของข้อมูล ต้องแจ้งสำนักงานคณะกรรมการคุ้มครองข้อมูลส่วนบุคคลภายใน **72 ชั่วโมง**นับแต่ทราบเหตุ และแจ้งเจ้าของข้อมูลเมื่อมีความเสี่ยงสูง ให้ปรึกษาผู้เชี่ยวชาญกฎหมายทันที
4. **บันทึกเหตุการณ์** ว่าเกิดอะไร ตรวจพบเมื่อไหร่ แก้อย่างไร เพื่อใช้ปรับปรุงและแสดงต่อหน่วยงาน

## 8. ปรับระบบ

- **เพิ่ม migration:** สร้างไฟล์ใหม่ใน `api/migrations/` เลขถัดไป (ห้ามแก้ไฟล์ที่ deploy แล้ว) ทดสอบกับ `wrangler d1 migrations apply taro --local` และรัน `npm test` แล้วค่อย `--remote`
- **เปลี่ยนข้อความนโยบาย/ข้อกำหนด:** แก้ `privacy.html`/`terms.html` แล้วเปลี่ยน `POLICY_VERSION` ใน `scripts/config.mjs` ผู้ใช้ที่ล็อกอินอยู่จะถูกขอให้รับทราบอีกครั้ง `npm test` ตรวจว่าตัวเลขระยะเวลาเก็บข้อมูลในนโยบายตรงกับโค้ด และตารางข้อมูลทุกตารางถูกกล่าวถึง
- **ก่อนเปิดจริงหรือหลังแก้ใหญ่:** `node scripts/launch-check.mjs`, `npm test`, `npm run test:workerd`, `npm run test:e2e`, `npm run test:a11y`
- **แพ็กเกจ Workers:** การแฮชรหัสผ่านใช้เวลา CPU ต่อคำขอมากกว่าที่แพ็กเกจฟรีรองรับ (ตามที่ผมทราบ) ควรใช้แพ็กเกจเสียเงิน ตรวจเงื่อนไขล่าสุดของ Cloudflare
