# คู่มือ deploy `taro-api` (สมัคร/ล็อกอินด้วยอีเมล)

ทำบนเครื่องของคุณ (ต้องมี Node.js และบัญชี Cloudflare) Worker นี้แยกจาก `taro-log` (ตัวเก็บคำถาม) และใช้ฐานข้อมูลคนละตัว โค้ดอยู่ในโฟลเดอร์ `api/` ทุกคำสั่งรันจากโฟลเดอร์นั้น

## 0. เตรียมบริการอีเมล (Resend)

1. สมัคร Resend แล้วเพิ่มโดเมน `ivoryrosetarot.online`
2. ใส่ DNS record ที่ Resend ให้ (SPF และ DKIM) ใน Cloudflare DNS แล้วรอสถานะ Verified
3. สร้าง API key (สิทธิ์ส่งอีเมลอย่างเดียว)
4. ตรวจ `EMAIL_FROM` ใน `api/wrangler.toml` ให้ตรงกับโดเมนที่ยืนยันแล้ว

## 1. สร้างฐานข้อมูลและตารางบัญชี

```bash
cd api
wrangler d1 create taro
```

คัดลอก `database_id` ไปแทน `REPLACE_WITH_ID_FROM_wrangler_d1_create` ใน `api/wrangler.toml`

```bash
wrangler d1 migrations apply taro --remote
```

## 2. ทดสอบก่อน deploy

```bash
node api/test/auth.test.mjs   # รันจากโฟลเดอร์หลักของโปรเจกต์ ต้องใช้ Node 22.13 ขึ้นไป
```

## 3. ใส่ secret และ deploy

```bash
cd api
wrangler secret put RESEND_API_KEY
wrangler deploy
```

## 4. ผูกโดเมน `api.`

เปิดบรรทัด `routes = [...]` ใน `api/wrangler.toml` (เอา `#` ออก) แล้ว deploy อีกครั้ง Cloudflare จะสร้าง DNS record ให้เอง ต้องเป็นซับโดเมนของเว็บเดียวกัน ไม่เช่นนั้น cookie จะไม่ใช่ same-site และล็อกอินไม่ติด

## 5. ตรวจว่าทำงานจริง

ลองด้วย curl (เปลี่ยนอีเมลเป็นของคุณ) ต้องส่ง `Origin` ให้ตรงโดเมนที่อนุญาต ไม่เช่นนั้นจะได้ 403

```bash
curl -i -X POST https://api.ivoryrosetarot.online/auth/register \
  -H 'origin: https://ivoryrosetarot.online' -H 'content-type: application/json' \
  -d '{"email":"you@example.com","password":"a long test passphrase"}'
```

ควรได้ `201` และมีอีเมลยืนยันเข้ามา ลิงก์ในอีเมลชี้ไปที่ `https://ivoryrosetarot.online/account.html#verify=...` **หน้า `account.html` ยังไม่ได้ทำ** (อยู่ในเฟส UI) จึงยังกดลิงก์ไม่ได้ ระหว่างนี้ยืนยันด้วย curl ได้:

```bash
curl -i -X POST https://api.ivoryrosetarot.online/auth/verify-email \
  -H 'origin: https://ivoryrosetarot.online' -H 'content-type: application/json' \
  -d '{"token":"<ค่าหลัง #verify= ในลิงก์>"}'
```

ดู log แบบสด: `wrangler tail` (ระบบไม่เขียนอีเมล รหัสผ่าน หรือลิงก์ลง log)

## สิ่งที่ API ป้องกันไว้

| เรื่อง | พฤติกรรม |
|---|---|
| รหัสผ่าน | PBKDF2-SHA256 100,000 รอบ + salt รายคน ยาว 10-128 ตัวอักษร เก็บเฉพาะค่าแฮช |
| Session | cookie `__Host-taro_session` (HttpOnly, Secure, SameSite=Lax) ใน D1 เก็บเฉพาะ hash ของ token อายุ 30 วัน ต่ออายุเมื่อใช้งาน |
| CSRF | POST ต้องมี `Origin` ตรงโดเมนที่อนุญาต และ `Content-Type: application/json` |
| CORS | อนุญาตเฉพาะโดเมนเว็บ พร้อม credentials (ไม่ใช้ `*`) |
| เดาบัญชี | สมัครซ้ำ ลืมรหัสผ่าน และล็อกอินผิด ตอบเหมือนกันทุกกรณี ไม่บอกว่าอีเมลมีในระบบหรือไม่ |
| เดารหัสผ่าน | ล็อกอินผิด 10 ครั้งใน 15 นาที (ต่ออีเมล) ถูกล็อก 429 และ rate limit 10 ครั้ง/นาที/IP |
| ลิงก์ในอีเมล | token สุ่ม 256 บิต เก็บเฉพาะ hash ใช้ได้ครั้งเดียว ยืนยันอีเมล 24 ชม. ตั้งรหัสใหม่ 30 นาที ลิงก์เก่าใช้ไม่ได้เมื่อขอใหม่ |
| ตั้งรหัสใหม่/เปลี่ยนรหัส | ออกจากระบบทุกอุปกรณ์ (เปลี่ยนรหัสขณะล็อกอินอยู่ จะคงเครื่องนี้ไว้) |
| ล้างข้อมูล | cron ทุกวัน 03:27 เวลาไทย ลบ session หมดอายุ, token ที่ใช้แล้ว/หมดอายุ, audit เกิน 90 วัน |

## ยังไม่มี (เฟสถัดไป)

ล็อกอินด้วย Google/LINE/Facebook, หน้าเว็บ `account.html`, ลบบัญชี/ส่งออกข้อมูล, ตาราง `consents`/`readings` ตามแผนใน `docs/07` และ `docs/08`
