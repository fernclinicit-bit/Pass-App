# Passly Vault

Password Manager และระบบบริหารคำขอรหัสผ่านสำหรับ Fern Clinic

## ฟังก์ชันหลัก

- Vault สำหรับ Login, Secure Note, Card และ Identity
- เข้ารหัสข้อมูลด้วย AES-GCM 256-bit
- สร้างกุญแจจาก Master Password ด้วย PBKDF2-SHA256 600,000 รอบ
- Folder, Favorites, Collections และ Trash
- รายชื่อสมาชิก กลุ่ม บทบาท และการกำหนด Collection
- Password / Passphrase Generator
- รายงานรหัสอ่อน รหัสซ้ำ รหัสเก่า และข้อมูลไม่ครบ
- Activity Log และ Encrypted Backup
- นำเข้ารายการจาก `.xlsx`, `.csv` และ `.json` ภายในเบราว์เซอร์
- รับคำขอจากกลุ่ม LINE และแจกข้อมูลจาก Vault
- Passly Secure Share: ลิงก์เข้ารหัสที่ต้องใช้ PIN แยกช่องทาง
- ส่งลิงก์ Passly Share เข้า Lark Chat

## รูปแบบการเก็บข้อมูล

Vault ถูกเข้ารหัสและเก็บใน `localStorage` ของเบราว์เซอร์ผู้ดูแล ข้อมูลที่ไม่ได้
เข้ารหัสและ Master Password จะไม่ถูกส่งไปยัง Server หรือ GitHub

กุญแจถอดรหัสอยู่ในหน่วยความจำเฉพาะเวลาที่ Vault ปลดล็อก เมื่อกด Lock,
ปิดหน้าเว็บ หรือครบเวลา Auto-lock ผู้ใช้ต้องกรอก Master Password ใหม่

เวอร์ชันนี้เป็น Vault ต่ออุปกรณ์ ยังไม่ซิงก์ข้อมูลข้ามเครื่องและยังไม่มีระบบบัญชี
ผู้ใช้ส่วนกลาง การใช้งานหลายผู้ดูแลควรเพิ่ม Authentication และฐานข้อมูลถาวรก่อน
ใช้งานจริงในระดับองค์กร

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
5. ส่งลิงก์ผ่าน Lark หรือช่องทางส่วนตัว
6. ส่ง PIN ให้ผู้รับผ่านอีกช่องทางหนึ่ง
7. ผู้รับเปิด `share.html` และกรอก PIN เพื่อถอดรหัสบนอุปกรณ์

วันหมดอายุของ Secure Share ถูกตรวจบนหน้าเว็บผู้รับ ลิงก์แบบไม่ใช้ฐานข้อมูล
ไม่สามารถบังคับเปิดได้ครั้งเดียวหรือเพิกถอนย้อนหลังได้

## เริ่มใช้งาน

```powershell
npm start
```

เปิด `http://localhost:3030` แล้วสร้าง Master Password ครั้งแรก

## Environment variables

- `LINE_CHANNEL_SECRET` — ตรวจสอบลายเซ็น LINE webhook
- `LINE_CHANNEL_ACCESS_TOKEN` — ส่งเมนูและข้อความตอบกลับใน LINE
- `LINE_ALLOWED_GROUP_ID` — จำกัดเฉพาะกลุ่ม “บัญชี 1”
- `LINE_GROUP_NAME` — ชื่อกลุ่มที่แสดงในระบบ
- `LARK_WEBHOOK_URL` — Lark Custom Bot webhook ฝั่ง Server
- `PORT` — ค่าเริ่มต้น `3030`
- `DATA_DIR` — ที่เก็บคำขอจาก LINE ค่าเริ่มต้น `./data`

LINE Webhook:

```text
https://YOUR-DOMAIN/api/line/webhook
```

## Deploy บน Render

Repository มี `render.yaml` สำหรับ Render Web Service และใช้ `npm start`
เป็นคำสั่งเริ่มระบบ ตั้งค่า Environment variables บน Render โดยไม่บันทึก
ค่ารหัสลง GitHub

> Render Free ใช้ filesystem ชั่วคราว คำขอจาก LINE อาจถูกล้างเมื่อ service
> restart หรือ deploy ใหม่ ส่วน Vault ในเบราว์เซอร์จะไม่ถูกล้างตาม Server
