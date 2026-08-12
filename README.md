# Passly Vault

Password Manager และระบบบริหารคำขอรหัสผ่านสำหรับ Fern Clinic

## ฟังก์ชันหลัก

- Vault สำหรับ Login, Secure Note, Card และ Identity
- เข้ารหัสข้อมูลด้วย AES-GCM 256-bit
- แปลงรหัสล็อกด้วย SHA-512 ขนาด 64 ไบต์ แล้วสร้างกุญแจด้วย PBKDF2-SHA256 600,000 รอบ
- รองรับ PIN ตัวเลขไทย/อังกฤษ ช่องว่าง และขีดคั่น พร้อมเปิด Vault รูปแบบเดิมได้
- Folder, Favorites, Collections และ Trash
- รายชื่อสมาชิก กลุ่ม บทบาท และการกำหนด Collection
- Password / Passphrase Generator
- รายงานรหัสอ่อน รหัสซ้ำ รหัสเก่า และข้อมูลไม่ครบ
- Activity Log และ Encrypted Backup
- Snapshot สำรองอัตโนมัติและกู้คืนเมื่อการบันทึกสะดุดระหว่าง Sleep
- ซิงก์ Encrypted Vault ข้ามคอมพิวเตอร์และโทรศัพท์ผ่าน PostgreSQL แบบมี Revision ป้องกันข้อมูลเก่าทับข้อมูลใหม่
- รองรับรหัสเข้าใช้งานที่มี Unicode/ภาษาไทยแบบคงรูปเดียวกัน
- นำเข้ารายการจาก `.xlsx`, `.csv` และ `.json` ภายในเบราว์เซอร์
- รับคำขอจากกลุ่ม LINE และแจกข้อมูลจาก Vault
- ช่องทางรับคำขอใหม่มีเฉพาะ LINE กลุ่ม “บัญชี 1” ไม่รับ Event จาก Lark หรือหน้าเว็บ
- Passly Secure Share: ลิงก์เข้ารหัสที่ต้องใช้ Share PIN
- ส่งลิงก์ Passly Share และ PIN เป็น 2 ข้อความกลับเข้ากลุ่ม LINE ต้นทาง

## รูปแบบการเก็บข้อมูล

Vault ถูกเข้ารหัสและเก็บสำเนาใน `localStorage` ของเบราว์เซอร์ผู้ดูแล เมื่อกำหนด
`DATABASE_URL` ระบบจะซิงก์เฉพาะ Encrypted Envelope ไปยัง PostgreSQL เพื่อใช้ข้ามอุปกรณ์
Server ตรวจรับเฉพาะฟิลด์ของ AES-GCM Envelope และไม่สามารถถอดรหัสข้อมูลได้
ข้อมูล Password แบบอ่านได้และ PIN จริงจะไม่ถูกบันทึกใน Server หรือ GitHub เมื่อเข้าสู่ระบบ เบราว์เซอร์จะส่ง
PIN ผ่าน HTTPS ไปตรวจเทียบกับค่า Scrypt Hash บน Server และรับ Session Cookie
แบบ `HttpOnly` ก่อนใช้ PIN เดียวกันถอดรหัส Vault ภายในเบราว์เซอร์

กุญแจถอดรหัสอยู่ในหน่วยความจำเฉพาะเวลาที่เข้าสู่ระบบ Passly ไม่มี Auto-lock
เมื่อกดออกจากระบบ ปิดหน้าเว็บ หรือรีโหลดหน้าเว็บ ผู้ใช้ต้องกรอกรหัสผ่านหรือ PIN ใหม่
Passly อนุญาตให้ปลดล็อกได้ครั้งละหนึ่งแท็บ เพื่อป้องกัน Vault สองแท็บบันทึกทับกัน
ตอนสร้างหรือเปลี่ยน PIN ระบบจะจับค่าจากช่องกรอกเพียงครั้งเดียวก่อนตรวจ Server
และล็อกช่องกรอกชั่วคราว เพื่อป้องกัน Password Manager เปลี่ยนค่าระหว่างสร้างกุญแจ
Vault รูปแบบเดิมจะถูกอัปเกรดเป็นการแปลงรหัส SHA-512 ขนาด 64 ไบต์โดยอัตโนมัติ
หลังจากเข้าสู่ระบบสำเร็จครั้งแรก โดยยังคงใช้ AES-GCM 256-bit เข้ารหัสข้อมูล
ก่อนระบบ Sleep หรือซ่อนหน้าเว็บ Passly จะส่งงานบันทึก Snapshot ล่าสุด และจะรอให้
งานเข้ารหัสเสร็จก่อนล้างกุญแจออกจากหน่วยความจำ หาก Snapshot ล่าสุดเสียหาย
ระบบจะลองกู้คืน Snapshot ที่เข้ารหัสก่อนหน้าโดยอัตโนมัติ

หากต้องสร้าง Vault ใหม่จากหน้าล็อก Passly จะดาวน์โหลดและเก็บ Vault เดิมเป็น
Backup เข้ารหัสก่อนเสมอ ไฟล์ดังกล่าวสามารถนำกลับมากู้คืนได้ภายหลังเมื่อมีรหัสเดิม
หากมี Vault เดิมเก็บอยู่ในเบราว์เซอร์แล้ว การ Reset ซ้ำจะไม่เขียนทับ Archive รุ่นเก่า
และสามารถกดกู้คืน Archive รุ่นนั้นได้จากหน้าล็อก

การซิงก์ใช้เลข Revision แบบ Optimistic Concurrency หากอีกอุปกรณ์บันทึกข้อมูลรุ่นใหม่กว่า
Passly จะหยุดอัปโหลดจากเครื่องเก่าและแจ้งให้ออกจากระบบแล้วเข้าใหม่ เพื่อไม่ให้ข้อมูลถูกเขียนทับ
สำเนาในอุปกรณ์ยังคงใช้เปิดแบบ Offline ได้ แต่จะระบุสถานะว่าไม่สามารถซิงก์ได้

> สำหรับข้อมูล Password จริง ควรใช้ PostgreSQL แบบถาวรที่มี Backup ไม่ควรใช้ Free PostgreSQL
> ของ Render เป็นคลังหลัก เพราะฐานข้อมูล Free หมดอายุหลัง 30 วัน

## นำเข้าจากไฟล์เดิม

Passly รองรับ Workbook `User Pass` ที่มีคอลัมน์:

- `User name`
- `Pass Word`
- `Password Last`
- `Platform`
- `วัตถุประสงค์การใช้งาน`
- `Owner`
- `อัปเดตรหัสล่าสุด`
- `หมายเหตุ`
- `ลิงค์`

ไฟล์ถูกอ่านในเบราว์เซอร์และเข้ารหัสก่อนบันทึกลง Vault โดยระบบจะข้ามรายการซ้ำ
ที่มี Platform, Username และ URL ตรงกัน

## Passly Secure Share

1. ผู้ดูแลอนุมัติคำขอ
2. เลือก Login จาก Vault
3. Passly เข้ารหัส Username และ Password ด้วย PIN แบบ PBKDF2 + AES-GCM
4. Ciphertext อยู่ใน URL fragment และไม่ถูกส่งเป็นข้อมูลให้ Server
5. Server ใช้ LINE Push API ส่งลิงก์เข้ารหัสกลับไปยังกลุ่มต้นทางของคำขอ
6. ส่ง Share PIN เป็นข้อความ LINE แยกจากข้อความลิงก์
7. ผู้รับเปิด `share.html` และกรอก PIN เพื่อถอดรหัสบนอุปกรณ์

วันหมดอายุของ Secure Share ถูกตรวจบนหน้าเว็บผู้รับ ลิงก์แบบไม่ใช้ฐานข้อมูล
ไม่สามารถบังคับเปิดได้ครั้งเดียวหรือเพิกถอนย้อนหลังได้

ลิงก์ที่ส่งเข้า LINE ใช้ `share.html?p=<encrypted-payload>` เพื่อให้ LINE in-app browser
บนโทรศัพท์รักษาข้อมูลเข้ารหัสไว้ครบ หน้า Share จะรับ payload แล้วล้าง query ออกจาก
แถบที่อยู่ทันที และยังเปิดลิงก์รุ่นเดิมที่ใช้ URL fragment ได้

## เริ่มใช้งาน

```powershell
npm start
```

เปิด `http://localhost:3030` แล้วสร้างรหัสผ่านหรือ PIN ครั้งแรก

ตั้งค่า `DATABASE_URL` เป็น Internal Database URL ของ PostgreSQL ใน Render Environment
จากนั้น Deploy ใหม่ เครื่องที่มี Vault เดิมต้องเข้าสู่ระบบหนึ่งครั้งเพื่ออัปโหลด Encrypted Vault
ก่อนเปิด Passly บนโทรศัพท์และเข้าสู่ระบบด้วย PIN เดียวกัน

ตรวจโค้ดและทดสอบระบบล็อก/กู้คืน Vault:

```powershell
npm run check
npm test
```

## Environment variables

- `PASSLY_ADMIN_PIN_HASH` — Scrypt Hash ของ PIN ผู้ดูแล เก็บเป็น Secret บน Render เท่านั้น
- `LINE_CHANNEL_SECRET` — ตรวจสอบลายเซ็น LINE webhook
- `LINE_CHANNEL_ACCESS_TOKEN` — ส่งเมนูและข้อความตอบกลับใน LINE
- `LINE_ALLOWED_GROUP_ID` — จำกัดเฉพาะกลุ่ม “บัญชี 1”
- `LINE_GROUP_NAME` — ชื่อกลุ่มที่แสดงในระบบ
- `PORT` — ค่าเริ่มต้น `3030`
- `DATA_DIR` — ที่เก็บคำขอจาก LINE ค่าเริ่มต้น `./data`

LINE Webhook:

```text
https://YOUR-DOMAIN/api/line/webhook
```

หลังผู้ดูแลอนุมัติ Passly จะส่ง Secure Share กลับด้วย LINE เท่านั้น โดยใช้
`lineGroupId` ที่บันทึกจากคำขอต้นทาง ไม่สามารถเลือกส่งไปยังกลุ่มอื่นจากหน้าเว็บได้

## Deploy บน Render

Repository มี `render.yaml` สำหรับ Render Web Service และใช้ `npm start`
เป็นคำสั่งเริ่มระบบ ตั้งค่า Environment variables บน Render โดยไม่บันทึก
ค่ารหัสลง GitHub

`/api/requests` และ `/api/line/deliver` เปิดใช้ได้หลังตรวจ PIN สำเร็จเท่านั้น
Server จำกัดการลอง PIN ผิดซ้ำและออก Session Cookie อายุ 12 ชั่วโมง โดยการหมดอายุ
ของ Session ฝั่ง Server จะไม่ล็อก Vault ที่เปิดอยู่ในเบราว์เซอร์โดยอัตโนมัติ

> Render Free ใช้ filesystem ชั่วคราว คำขอจาก LINE อาจถูกล้างเมื่อ service
> restart หรือ deploy ใหม่ ส่วน Vault ในเบราว์เซอร์จะไม่ถูกล้างตาม Server
