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
wrangler d1 execute taro-log --remote --file worker/schema.sql
```

## 2. ทดสอบก่อน deploy

```bash
node worker/index.test.mjs
```

## 3. Deploy

```bash
wrangler deploy
```

จะได้ URL แบบ `https://taro-log.<ชื่อบัญชี>.workers.dev` ถ้า deploy แล้วขึ้นว่า `ratelimits` ไม่รู้จัก ให้อัปเดต wrangler ก่อน

## 4. เปิดใช้ในเว็บ

แก้ `const LOG_URL = ''` ใน `index.html` (ราว ๆ บรรทัด 624) ให้เป็น URL ข้างบน แล้ว commit และ push ข้อความท้ายหน้าเว็บจะเปลี่ยนเองเป็น "คำถามที่พิมพ์จะถูกเก็บไว้โดยไม่มีชื่อ อีเมล…"

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
| อัตราการส่ง | 5 ครั้งต่อ 60 วินาทีต่อ IP (429) ใช้ IP เป็นคีย์เท่านั้น ไม่เก็บลงฐานข้อมูล |
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
