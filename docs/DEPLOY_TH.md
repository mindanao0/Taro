# คู่มือ deploy ตัวเก็บคำถาม (Cloudflare Worker + D1)

ทำบนเครื่องของคุณ (ต้องมี Node.js และบัญชี Cloudflare) ขั้นตอนนี้ไม่บังคับ ถ้าไม่ทำ เว็บจะไม่ส่งข้อมูลออกไปเลย

## 0. ก่อนเริ่ม

```bash
npm i -g wrangler          # ต้องเป็นเวอร์ชัน 4.36 ขึ้นไป (ใช้ rate limit binding)
wrangler --version
wrangler login
```

โดเมนที่ Worker ยอมรับตอนนี้ตั้งไว้ใน `worker/index.js` (`ORIGINS`) คือ `ivoryrosetarot.online` และ `www.` ถ้าใช้โดเมนอื่นให้แก้ก่อน

## 1. สร้างฐานข้อมูล

```bash
wrangler d1 create taro-log
```

คัดลอก `database_id` ที่ได้ไปแทน `REPLACE_WITH_ID_FROM_wrangler_d1_create` ใน `wrangler.toml`

```bash
wrangler d1 migrations apply taro-log --remote
```

## 2. ทดสอบก่อน deploy

```bash
node worker/index.test.mjs
node worker/events.test.mjs   # รัน migrations จริงบน SQLite (ต้องใช้ Node 22.13 ขึ้นไป)
```

## 3. Deploy

```bash
wrangler deploy
```

จะได้ URL แบบ `https://taro-log.<ชื่อบัญชี>.workers.dev` ถ้า deploy แล้วขึ้นว่า `ratelimits` ไม่รู้จัก ให้อัปเดต wrangler ก่อน

## 4. เปิดใช้ในเว็บ

แก้ `const LOG_URL = ''` ใน `index.html` (ราว ๆ บรรทัด 624) ให้เป็น URL ข้างบน แล้ว commit และ push ข้อความท้ายหน้าเว็บจะเปลี่ยนเองเป็น "คำถามที่พิมพ์จะถูกเก็บไว้โดยไม่มีชื่อ อีเมล…"

## 4.1 เปิดบันทึกลำดับการกด (ไม่บังคับ)

Worker เดียวกันรับ `POST /events` ด้วย ตั้ง `const TRACK_URL = ''` ใน `index.html` เป็น `https://taro-log.<ชื่อบัญชี>.workers.dev/events` เมื่อตั้งแล้วท้ายหน้าเว็บจะมีช่องให้ผู้ใช้ติ๊กยินยอม (ค่าเริ่มต้นปิด) ถ้าไม่ติ๊กจะไม่ส่งอะไรเลย ต้องมีหน้านโยบายความเป็นส่วนตัวที่ระบุเรื่องนี้ก่อนเปิดจริง

- ข้อมูลดิบเก็บ 30 วัน แล้ว cron (ตั้งไว้ใน `wrangler.toml` รันทุกวัน 03:17 เวลาไทย) รวมเป็นสถิติรายวันใน `ui_daily_stats` และลบดิบทิ้ง คำถามที่เก็บไว้เกิน 90 วันก็ถูกลบในรอบเดียวกัน
- ตัวอย่างดูสถิติ:

```bash
wrangler d1 execute taro-log --remote --command "SELECT day, type, outcome, pointer, n FROM ui_daily_stats ORDER BY day DESC LIMIT 30"
wrangler d1 execute taro-log --remote --command "SELECT type, outcome, COUNT(*) n FROM ui_events GROUP BY 1, 2 ORDER BY n DESC"
```

- ตัวอย่าง query ลำดับ ("หลังกดพลาดทำอะไรต่อ") อยู่ใน `docs/08_BACKEND_ARCHITECTURE_TH.md` หัวข้อ 4.2
- rate limit 30 ครั้งต่อนาทีต่อ IP (`EVENTS_LIMITER`) รับไม่เกิน 100 events ต่อคำขอ และ 500 events ต่อ session

## 5. ตรวจว่าทำงาน

เปิดเว็บจริง พิมพ์คำถามทดสอบ แล้วเลือกไพ่ จากนั้นดู:

```bash
wrangler d1 execute taro-log --remote --command "SELECT at, spread, q FROM questions ORDER BY id DESC LIMIT 20"
```

ดู log แบบสด: `wrangler tail`

## สิ่งที่ Worker ป้องกันไว้

| เรื่อง | พฤติกรรม |
|---|---|
| วิธีเรียก | รับเฉพาะ POST (อื่น ๆ ได้ 405) |
| ที่มา | ต้องมี `Origin` ตรงโดเมนที่อนุญาต (อื่น ๆ ได้ 403) ข้อนี้กันแค่เบราว์เซอร์ ปลอมจากสคริปต์ได้ จึงมีข้อถัดไป |
| ขนาด | body เกิน 4 KB ได้ 413 อ่านแบบจำกัดไบต์ แม้ไม่มี content-length |
| อัตราการส่ง | คำถาม 5 ครั้ง/นาที/IP และ `/events` 30 ครั้ง/นาที/IP (429) ใช้ IP เป็นคีย์เท่านั้น ไม่เก็บลงฐานข้อมูล |
| ข้อมูล | `q` ต้องเป็นข้อความ ตัด control character และตัดที่ 300 ตัวอักษร `spread` ต้องอยู่ในรายการ |
| CORS | ไม่ต้องใช้ เว็บส่งแบบ `no-cors` (text/plain) ไม่มี preflight และ Worker ไม่ตอบข้อมูลกลับ |

## ข้อควรรู้เรื่องข้อมูลส่วนบุคคล

คำถามเป็นข้อความอิสระ ผู้ใช้อาจพิมพ์ข้อมูลส่วนตัวลงไปเอง หน้าเว็บมีคำเตือนแล้ว ควรลบข้อมูลเก่าเป็นระยะ เช่น

```bash
wrangler d1 execute taro-log --remote --command "DELETE FROM questions WHERE at < date('now','-90 day')"
```

หากเก็บข้อมูลจากผู้ใช้ในไทยหรือยุโรป ควรเพิ่มหน้านโยบายความเป็นส่วนตัว (PDPA/GDPR) ซึ่งตัวโค้ดไม่ได้ทำให้

## ถ้าอยากลบทิ้ง

```bash
wrangler delete taro-log
wrangler d1 delete taro-log
```

แล้วตั้ง `LOG_URL` กลับเป็น `''`
