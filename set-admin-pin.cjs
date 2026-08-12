const fs = require('fs');
const readline = require('readline');
const pinAuth = require('./pin-auth.cjs');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question('ตั้งค่ารหัส PIN สำหรับผู้ดูแล (Admin PIN): ', async (pin) => {
  if (pin.length < 4) {
    console.log('PIN ต้องมีความยาวอย่างน้อย 4 ตัว');
    process.exit(1);
  }
  try {
    const hash = await pinAuth.createPinHash(pin);
    let env = '';
    if (fs.existsSync('.env')) {
      env = fs.readFileSync('.env', 'utf8');
      env = env.split('\n').filter(line => !line.startsWith('PASSLY_ADMIN_PIN_HASH=')).join('\n');
    }
    env = env.trim() + '\nPASSLY_ADMIN_PIN_HASH=' + hash + '\n';
    fs.writeFileSync('.env', env);
    console.log('\n✅ บันทึก Admin PIN ลงในไฟล์ .env เรียบร้อยแล้ว!');
    console.log('⚠️ อย่าลืมไป ปิดหน้าต่างเซิร์ฟเวอร์สีดำอันเดิม แล้วเปิด start.bat ใหม่อีกครั้งนะครับ');
  } catch (err) {
    console.error('Error:', err);
  }
  rl.close();
});
