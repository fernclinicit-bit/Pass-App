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
