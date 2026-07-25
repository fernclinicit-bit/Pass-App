# Passly

ระบบรับคำขอ Password จาก LINE Official Account และแจ้งเตือนผู้ดูแลบนเว็บ

## การทำงาน

1. ผู้ใช้ส่งข้อความหา LINE OA เช่น:

   ```
   ขอรหัส Google Workspace
   เหตุผล: ใช้งานเอกสารของทีม Marketing
   ```

2. LINE Messaging API ส่ง webhook มาที่ `/api/line/webhook`
3. หน้าเว็บดึงคำขอใหม่และแสดงการแจ้งเตือน
4. ผู้ดูแลอนุมัติ แก้ไข ปฏิเสธ หรือส่ง Password ผ่าน Lark

## เริ่มใช้งาน

```powershell
$env:LINE_CHANNEL_SECRET="your-channel-secret"
npm start
```

เปิด `http://localhost:3030`

## Environment variables

- `LINE_CHANNEL_SECRET` — Channel secret จาก LINE Developers Console
- `LARK_WEBHOOK_URL` — Lark Custom Bot webhook (ถ้าใช้ส่ง Password ผ่าน Lark)
- `PORT` — พอร์ตของเว็บ ค่าเริ่มต้น `3030`
- `DATA_DIR` — ที่เก็บคำขอจาก LINE ค่าเริ่มต้น `./data`

ตั้งค่า Webhook URL ใน LINE Developers Console เป็น:

```
https://YOUR-DOMAIN/api/line/webhook
```

ไฟล์ข้อมูลคำขอและค่า secret ถูกตัดออกจาก Git ผ่าน `.gitignore`

## ใช้งานในกลุ่ม LINE “บัญชี 1”

1. เปิด `Allow bot to join group chats` ใน LINE Developers Console
2. เชิญ LINE Official Account เข้ากลุ่ม “บัญชี 1”
3. เมื่อบอตเข้ากลุ่ม บอตจะส่งปุ่ม Quick Reply สำหรับเลือกระบบ
4. หากปุ่มหาย ให้สมาชิกพิมพ์ `เมนู` หรือ `ขอรหัส`
5. เมื่อสมาชิกกดชื่อระบบ คำขอจะขึ้นหน้าเว็บและบอตตอบยืนยันในกลุ่ม

กำหนด Environment variables:

- `LINE_CHANNEL_SECRET` — ตรวจสอบว่า webhook มาจาก LINE จริง
- `LINE_CHANNEL_ACCESS_TOKEN` — ใช้ส่งเมนูและข้อความตอบกลับ
- `LINE_ALLOWED_GROUP_ID` — จำกัดให้รับเฉพาะกลุ่ม “บัญชี 1”
- `LINE_GROUP_NAME` — ชื่อกลุ่มที่แสดงบนเว็บ

## Deploy บน Render

โปรเจกต์มี `render.yaml` สำหรับสร้าง Web Service:

1. เปิด Render Blueprint จาก repository นี้
2. เมื่อ deploy สำเร็จ เพิ่ม `LINE_CHANNEL_SECRET` และ `LARK_WEBHOOK_URL`
   ในหน้า Environment ของบริการ
3. ตั้งค่า LINE Webhook URL เป็น
   `https://YOUR-SERVICE.onrender.com/api/line/webhook`

เมื่อยังไม่ได้ตั้ง `LINE_CHANNEL_SECRET` ระบบ production จะปฏิเสธ LINE webhook
เพื่อป้องกันคำขอปลอม แต่หน้าเว็บยังเปิดใช้งานได้ตามปกติ

> แผน Free เก็บไฟล์คำขอใน filesystem ชั่วคราว ข้อมูลอาจถูกล้างเมื่อ service restart หรือ deploy ใหม่
