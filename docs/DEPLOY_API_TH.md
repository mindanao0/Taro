# คู่มือ deploy `taro-api` (สมาชิก, ล็อกอิน, ประวัติ, แจ้งเตือน LINE)

ทำบนเครื่องของคุณ (ต้องมี Node.js 22.13 ขึ้นไป และบัญชี Cloudflare) Worker นี้แยกจาก `taro-log` (ตัวเก็บคำถาม) และใช้ฐานข้อมูลคนละตัว โค้ดอยู่ในโฟลเดอร์ `api/` คำสั่ง `wrangler` ทุกคำสั่งรันจากโฟลเดอร์นั้น

ทำเป็นขั้น ๆ ได้ ไม่ต้องตั้งทุกอย่างพร้อมกัน: **ขั้น 1-5 พอสำหรับสมัคร/ล็อกอินด้วยอีเมล** ส่วน Google, LINE, Facebook และแจ้งเตือน LINE ตั้งเพิ่มภายหลังได้ ปุ่มของ provider ไหนที่ยังไม่ได้ตั้ง secret จะไม่แสดงในหน้าเว็บเอง

## 0. ลองในเครื่องก่อน (ไม่ต้องมีบัญชีใด ๆ)

```bash
node api/dev/server.mjs 8787      # API จริงบนฐานข้อมูลชั่วคราวในหน่วยความจำ
python3 -m http.server 8000       # เว็บ (เปิดอีกหน้าต่างหนึ่ง)
```

แก้ `scripts/config.mjs` เป็น `export const API_URL = 'http://localhost:8787';` แล้วเปิด `http://localhost:8000/account.html` อีเมลไม่ถูกส่งจริง ดูลิงก์ที่ `http://localhost:8787/__dev/mails` ข้อมูลหายเมื่อปิดเซิร์ฟเวอร์ (อย่า commit ค่า `API_URL` ที่เป็น localhost)

## 1. บริการอีเมล (Resend)

1. สมัคร Resend แล้วเพิ่มโดเมน `ivoryrosetarot.online`
2. ใส่ DNS record ที่ Resend ให้ (SPF และ DKIM) ใน Cloudflare DNS แล้วรอสถานะ Verified
3. สร้าง API key (สิทธิ์ส่งอีเมลอย่างเดียว)
4. ตรวจ `EMAIL_FROM` ใน `api/wrangler.toml` ให้ตรงกับโดเมนที่ยืนยันแล้ว

## 2. ฐานข้อมูลและตาราง

```bash
cd api
wrangler d1 create taro
```

คัดลอก `database_id` ไปแทน `REPLACE_WITH_ID_FROM_wrangler_d1_create` ใน `api/wrangler.toml`

```bash
wrangler d1 migrations apply taro --remote
```

## 3. ทดสอบก่อน deploy

รันจากโฟลเดอร์หลักของโปรเจกต์:

```bash
node api/test/auth.test.mjs
node api/test/social.test.mjs
node api/test/readings.test.mjs
node api/test/line.test.mjs
```

## 4. Secret

สร้างค่าสุ่มยาว ๆ สำหรับ `COOKIE_SECRET` และ `DAILY_SECRET` (เก็บไว้ อย่าเปลี่ยนบ่อย: เปลี่ยน `DAILY_SECRET` แล้วไพ่ประจำวันของวันที่ผ่านมาจะเปลี่ยนตาม):

```bash
openssl rand -base64 48
```

```bash
cd api
wrangler secret put RESEND_API_KEY
wrangler secret put COOKIE_SECRET
wrangler secret put DAILY_SECRET
```

## 5. Deploy และผูกโดเมน `api.`

```bash
cd api
wrangler deploy
```

เปิดบรรทัด `routes = [...]` ใน `api/wrangler.toml` (เอา `#` ออก) แล้ว deploy อีกครั้ง Cloudflare จะสร้าง DNS record ให้เอง **ต้องเป็นซับโดเมนของเว็บเดียวกัน** ไม่เช่นนั้น cookie จะไม่ใช่ same-site และล็อกอินไม่ติด

จากนั้นแก้ `scripts/config.mjs` เป็น `export const API_URL = 'https://api.ivoryrosetarot.online';` แล้ว commit และ push เว็บจะมีลิงก์ "เข้าสู่ระบบ" ที่เมนู, ไพ่ประจำวัน และหน้า `account.html` (ข้อความขอความยินยอมในหน้าสมัครเป็นข้อความตั้งต้น **ควรมีหน้านโยบายความเป็นส่วนตัวตาม PDPA และให้ผู้เชี่ยวชาญตรวจก่อนเปิดจริง**)

## 6. ล็อกอินด้วย Google

1. Google Cloud Console → สร้างโปรเจกต์ (ใช้บัญชีกลางของโปรเจกต์) → APIs & Services → OAuth consent screen → ตั้งชื่อแอป ลิงก์นโยบายความเป็นส่วนตัว โดเมน
2. Credentials → Create OAuth client ID → Web application
3. Authorized redirect URI: `https://api.ivoryrosetarot.online/auth/google/callback` (ต้องตรงตัวอักษร)
4. ```bash
   cd api
   wrangler secret put GOOGLE_CLIENT_ID
   wrangler secret put GOOGLE_CLIENT_SECRET
   ```

## 7. ล็อกอินด้วย LINE

1. LINE Developers Console → สร้าง Provider ของโปรเจกต์ → สร้าง channel ชนิด **LINE Login** (เลือก Web app)
2. Callback URL: `https://api.ivoryrosetarot.online/auth/line/callback`
3. ขอสิทธิ์ **OpenID Connect** และ **Email address permission** (ต้องยื่นขอในหน้า channel ผู้ใช้บางคนอาจไม่ให้อีเมล ระบบรองรับ)
4. ```bash
   cd api
   wrangler secret put LINE_CHANNEL_ID       # Channel ID
   wrangler secret put LINE_CHANNEL_SECRET   # Channel secret
   ```

## 8. ล็อกอินด้วย Facebook

1. Meta for Developers → Create App → ชนิด Consumer → เพิ่มผลิตภัณฑ์ **Facebook Login**
2. Valid OAuth Redirect URI: `https://api.ivoryrosetarot.online/auth/facebook/callback`
3. ตั้งค่า Privacy Policy URL และช่องทางลบข้อมูลผู้ใช้ (Meta บังคับก่อนเปิดแอปให้สาธารณะ) แล้วสลับแอปเป็น Live
4. ตรวจเวอร์ชัน Graph API ที่ Meta รองรับ ค่าในโค้ดคือ `v21.0` (ตัวแปร `FB_VERSION` ใน `api/lib/social.mjs`)
5. ```bash
   cd api
   wrangler secret put FACEBOOK_APP_ID
   wrangler secret put FACEBOOK_APP_SECRET
   ```

## 9. แจ้งเตือนผ่าน LINE (LINE Official Account)

LINE Notify ปิดบริการแล้ว (ตรวจยืนยันกับ LINE Developers อีกครั้ง) ต้องใช้ Official Account + Messaging API

1. สร้าง LINE Official Account และเปิด Messaging API **ภายใต้ Provider เดียวกับ channel LINE Login ในข้อ 7** (ถ้าคนละ Provider ค่า userId จะไม่ตรงกันและจับคู่ผู้ใช้ไม่ได้)
2. ตั้ง Webhook URL ของ Messaging API เป็น `https://api.ivoryrosetarot.online/line/webhook` แล้วกด Verify และเปิด "Use webhook" (แนะนำปิดข้อความตอบกลับอัตโนมัติของ LINE OA เพื่อไม่ให้ซ้ำ)
3. ออก Channel access token (long-lived) และคัดลอก Channel secret
4. ```bash
   cd api
   wrangler secret put LINE_MESSAGING_TOKEN    # channel access token
   wrangler secret put LINE_MESSAGING_SECRET   # channel secret ของ Messaging API
   ```
5. แก้ `LINE_OA_URL` ใน `api/wrangler.toml` เป็นลิงก์เพิ่มเพื่อนของบัญชีคุณ (รูปแบบ `https://line.me/R/ti/p/@ชื่อ`) แล้ว `wrangler deploy` อีกครั้ง
6. ตรวจโควตาข้อความของแพ็กเกจ LINE OA ที่ใช้ ข้อความ push มีจำนวนจำกัดต่อเดือนตามแพ็กเกจ ค่าเริ่มต้นของผู้ใช้เป็นรายสัปดาห์เพื่อประหยัดโควตา
7. ระบบส่งข้อความรอบละไม่เกิน 40 ราย (cron ทุกชั่วโมง) ถ้ามีผู้ใช้มากกว่านี้ต่อชั่วโมง ข้อความจะทยอยออกในชั่วโมงถัด ๆ ไปของวันเดียวกัน

ทดสอบ: ล็อกอินด้วย LINE ในหน้าเว็บ → หน้าบัญชีมีส่วน "แจ้งเตือนผ่าน LINE" → ติ๊กยินยอม ตั้งเวลา เพิ่มเพื่อน แล้วบันทึก พิมพ์ "หยุด" ในแชตเพื่อทดสอบการยกเลิก

## 10. ตรวจว่าทำงานจริง

ดู log แบบสด: `wrangler tail` (ระบบไม่เขียนอีเมล รหัสผ่าน token หรือลิงก์ลง log เขียนเฉพาะสาเหตุของข้อผิดพลาดและจำนวน)

ดูฟีดแบ็ก:

```bash
wrangler d1 execute taro --remote --command "SELECT created_at, kind, status, body FROM feedback ORDER BY created_at DESC LIMIT 20"
wrangler d1 execute taro --remote --command "UPDATE feedback SET status = 'done' WHERE id = '<id>'"
```

## สิ่งที่ API ป้องกันไว้

| เรื่อง | พฤติกรรม |
|---|---|
| รหัสผ่าน | PBKDF2-SHA256 100,000 รอบ + salt รายคน ยาว 10-128 ตัวอักษร เก็บเฉพาะค่าแฮช (ถ้าจะปรับรอบหรือเปลี่ยนอัลกอริทึม ระบบแฮชใหม่ให้ตอนผู้ใช้ล็อกอิน) |
| Session | cookie `__Host-taro_session` (HttpOnly, Secure, SameSite=Lax) ใน D1 เก็บเฉพาะ hash ของ token อายุ 30 วัน ต่ออายุเมื่อใช้งาน |
| CSRF | คำขอที่เปลี่ยนข้อมูลต้องมี `Origin` ตรงโดเมนที่อนุญาต และ `Content-Type: application/json` |
| CORS | อนุญาตเฉพาะโดเมนเว็บ พร้อม credentials (ไม่ใช้ `*`) |
| เดาบัญชี | สมัครซ้ำ ลืมรหัสผ่าน เพิ่มอีเมลที่มีคนใช้แล้ว และล็อกอินผิด ตอบเหมือนกันทุกกรณี |
| เดารหัสผ่าน | ล็อกอินผิด 10 ครั้งใน 15 นาที (ต่ออีเมล) ถูกล็อก 429 และ rate limit 10 ครั้ง/นาที/IP |
| ลิงก์ในอีเมล | token สุ่ม 256 บิต เก็บเฉพาะ hash ใช้ได้ครั้งเดียว ยืนยันอีเมล 24 ชม. ตั้งรหัสใหม่ 30 นาที ลิงก์เก่าใช้ไม่ได้เมื่อขอใหม่ |
| Social login | Authorization Code + PKCE (Google, LINE) + state + nonce ลงลายเซ็นใน cookie 10 นาที ตรวจ id_token (ลายเซ็น RS256, iss, aud, exp, nonce) |
| ผูกบัญชีอัตโนมัติ | เฉพาะอีเมลที่ provider รับรอง (Google) LINE/Facebook ไม่รับรอง จึงไม่เก็บลง `users.email` และไม่ผูกกับบัญชีเดิม ถ้าบัญชีเดิมที่มีอีเมลนั้นยังไม่ยืนยัน รหัสผ่านและ session ของมันถูกเพิกถอน (กันการจองบัญชีล่วงหน้า) |
| เลิกผูก | ห้ามเลิกวิธีเข้าสู่ระบบสุดท้าย |
| ข้อมูลผู้ใช้ | ทุกคำสั่งกรองด้วยเจ้าของจาก session เสมอ (ไม่รับ user id จากคำขอ) ผู้อื่นเห็น/แก้/ลบไม่ได้ |
| ประวัติการอ่าน | บันทึกได้เมื่อผู้ใช้ให้ความยินยอมเท่านั้น (ตรวจที่เซิร์ฟเวอร์) ตรวจไพ่และตำแหน่งกับสำรับจริง ไม่เกิน 200 ครั้ง/วัน |
| ลบบัญชี | ออกจากระบบทุกเครื่องทันที ข้อมูลลบถาวรหลัง 30 วัน (cron) ส่งออกข้อมูลทั้งหมดได้ที่ `GET /me/export` |
| LINE webhook | ต้องมีลายเซ็น `X-Line-Signature` ที่ถูกต้อง การพิมพ์ "หยุด" บันทึกเป็นการถอนความยินยอม |
| ข้อความ LINE | มีเฉพาะไพ่ประจำวัน (ข้อมูลสาธารณะ) ไม่มีคำถามหรือผลอ่านของผู้ใช้ |
| ล้างข้อมูล | cron ทุกวัน 03:27 เวลาไทย ลบ session หมดอายุ, token ที่ใช้แล้ว/หมดอายุ, audit เกิน 90 วัน, บัญชีที่ลบเกิน 30 วัน |

## ข้อจำกัดที่ควรรู้

- ทดสอบทั้งหมดกับ provider จำลองและ D1 จำลองบน SQLite ยังไม่ได้ลองกับ Google/LINE/Facebook/Resend/D1 จริง ควรทดสอบทีละ provider หลัง deploy
- ค่าตัวเลขของแพลตฟอร์มที่ผมไม่ได้ตรวจกับเอกสารล่าสุด: จำนวนรอบ PBKDF2 สูงสุดของ Workers, เวอร์ชัน Graph API, โควตาข้อความ LINE, เพดาน D1
- ลบบัญชีแล้วอีเมลเดิมสมัครใหม่ไม่ได้จนกว่าจะครบ 30 วัน
