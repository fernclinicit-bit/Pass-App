const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = __dirname;
const port = process.env.PORT || 3030;
const dataDir = process.env.DATA_DIR || path.join(root, 'data');
const requestFile = path.join(dataDir, 'requests.json');
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  });
  res.end(body);
}

function readBody(req, limit = 50_000) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > limit) reject(new Error('Request body is too large'));
    });
    req.on('end', () => resolve(raw));
    req.on('error', reject);
  });
}

function readRequests() {
  try {
    return JSON.parse(fs.readFileSync(requestFile, 'utf8'));
  } catch {
    return [];
  }
}

function writeRequests(requests) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(requestFile, JSON.stringify(requests.slice(0, 500), null, 2));
}

function verifyLineSignature(raw, signature) {
  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!secret) return process.env.NODE_ENV !== 'production';
  const expected = crypto.createHmac('sha256', secret).update(raw).digest('base64');
  const actualBuffer = Buffer.from(signature || '');
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

const requestSystems = [
  'Google Workspace',
  'Microsoft',
  'Instagram',
  'Facebook',
  'TikTok',
  'TikTok Ads',
  'Adobe',
  'CapCut',
  'Apple ID',
  'Gmail',
  'CCTV',
  'Network',
];

function isAllowedLineGroup(event) {
  if (event.source?.type !== 'group') return false;
  const allowedGroupId = process.env.LINE_ALLOWED_GROUP_ID;
  return !allowedGroupId || event.source.groupId === allowedGroupId;
}

function lineRequestMenu() {
  return {
    type: 'text',
    text: 'เลือกบัญชีที่ต้องการขอ Password',
    quickReply: {
      items: requestSystems.map((system) => ({
        type: 'action',
        action: {
          type: 'postback',
          label: system.slice(0, 20),
          data: new URLSearchParams({ action: 'request', system }).toString(),
          displayText: `ขอ Password: ${system}`,
        },
      })),
    },
  };
}

async function replyLine(replyToken, messages) {
  const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!accessToken || !replyToken) return false;
  const response = await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ replyToken, messages }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`LINE reply failed: ${response.status} ${detail}`);
  }
  return true;
}

async function getLineMemberName(event) {
  const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const groupId = event.source?.groupId;
  const userId = event.source?.userId;
  if (!accessToken || !groupId || !userId) return null;
  try {
    const response = await fetch(
      `https://api.line.me/v2/bot/group/${encodeURIComponent(groupId)}/member/${encodeURIComponent(userId)}`,
      { headers: { 'Authorization': `Bearer ${accessToken}` } },
    );
    if (!response.ok) return null;
    const profile = await response.json();
    return profile.displayName || null;
  } catch {
    return null;
  }
}

function parseLineRequest(event) {
  let systemPart = '';
  let reason = '';
  let sourceMessageId = event.webhookEventId;

  if (event.type === 'postback') {
    const data = new URLSearchParams(event.postback?.data || '');
    if (data.get('action') !== 'request') return null;
    systemPart = data.get('system') || 'ไม่ระบุระบบ';
    reason = 'สมาชิกกดขอ Password จากเมนูในกลุ่ม LINE';
  } else if (event.type === 'message' && event.message?.type === 'text') {
    const text = event.message.text.trim();
    const isRequest = /ขอ\s*(รหัส|password|pass)|password\s*request/i.test(text);
    if (!isRequest) return null;
    const clean = text
      .replace(/ขอ\s*(รหัส|password|pass)\s*/i, '')
      .replace(/password\s*request\s*/i, '')
      .trim();
    if (!clean) return null;
    const [system, ...reasonParts] = clean.split(/\n|เหตุผล\s*[:：]?/i);
    systemPart = system;
    reason = reasonParts.join(' ').trim() || text;
    sourceMessageId = event.message.id;
  } else {
    return null;
  }

  return {
    id: `line-${event.webhookEventId || sourceMessageId}`,
    name: `LINE User ${String(event.source?.userId || '').slice(-6)}`,
    email: event.source?.userId || 'LINE',
    system: systemPart || 'ไม่ระบุระบบ',
    reason,
    date: new Date(event.timestamp || Date.now()).toISOString().slice(0, 10),
    receivedAt: new Date(event.timestamp || Date.now()).toISOString(),
    status: 'pending',
    urgent: false,
    source: 'LINE',
    lineUserId: event.source?.userId || null,
    lineGroupId: event.source?.groupId || null,
    lineGroupName: process.env.LINE_GROUP_NAME || 'บัญชี 1',
  };
}

async function handleLineWebhook(req, res) {
  const raw = await readBody(req);
  if (!verifyLineSignature(raw, req.headers['x-line-signature'])) {
    return send(res, 401, JSON.stringify({ ok: false, error: 'Invalid LINE signature' }));
  }
  const payload = JSON.parse(raw || '{}');
  const current = readRequests();
  const known = new Set(current.map((item) => item.id));
  const incoming = [];

  for (const event of payload.events || []) {
    if (!isAllowedLineGroup(event)) continue;
    const text = event.message?.type === 'text' ? event.message.text.trim() : '';
    const shouldShowMenu =
      event.type === 'join' ||
      /^(เมนู|ขอรหัส|ขอ password|password)$/i.test(text);

    if (shouldShowMenu) {
      await replyLine(event.replyToken, [lineRequestMenu()]);
      continue;
    }

    const item = parseLineRequest(event);
    if (!item || known.has(item.id)) continue;
    item.name = await getLineMemberName(event) || item.name;
    incoming.push(item);
    known.add(item.id);
    await replyLine(event.replyToken, [{
      type: 'text',
      text: `รับคำขอ ${item.system} แล้ว ✅\nผู้ดูแลจะตรวจสอบผ่านหน้าเว็บ`,
    }]);
  }

  current.unshift(...incoming.filter((item) => !current.some((saved) => saved.id === item.id)));
  if (incoming.length) writeRequests(current);
  send(res, 200, JSON.stringify({ ok: true, received: incoming.length }));
}

async function handleLark(req, res) {
  const data = JSON.parse(await readBody(req) || '{}');
  const webhook = process.env.LARK_WEBHOOK_URL || data.webhook;
  if (!/^https:\/\/open\.larksuite\.com\/open-apis\/bot\/v2\/hook\//.test(webhook || '')) {
    throw new Error('Lark webhook ไม่ถูกต้อง');
  }
  const response = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ msg_type: 'text', content: { text: String(data.text || '') } }),
  });
  const result = await response.json();
  if (!response.ok || (result.code && result.code !== 0)) {
    throw new Error(result.msg || result.StatusMessage || 'Lark API error');
  }
  send(res, 200, JSON.stringify({ ok: true }));
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && req.url === '/api/line/webhook') {
      return await handleLineWebhook(req, res);
    }
    if (req.method === 'GET' && req.url === '/api/requests') {
      return send(res, 200, JSON.stringify({ requests: readRequests() }));
    }
    if (req.method === 'POST' && req.url === '/api/lark') {
      return await handleLark(req, res);
    }
    if (req.method === 'GET' && req.url === '/api/health') {
      return send(res, 200, JSON.stringify({
        ok: true,
        lineConfigured: Boolean(process.env.LINE_CHANNEL_SECRET),
        lineReplyConfigured: Boolean(process.env.LINE_CHANNEL_ACCESS_TOKEN),
        lineGroupRestricted: Boolean(process.env.LINE_ALLOWED_GROUP_ID),
        larkConfigured: Boolean(process.env.LARK_WEBHOOK_URL),
      }));
    }

    const target = req.url === '/' ? '/index.html' : req.url.split('?')[0];
    const file = path.resolve(root, '.' + target);
    const relative = path.relative(root, file);
    if (relative.startsWith('..') || path.isAbsolute(relative) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
    }
    send(res, 200, fs.readFileSync(file), types[path.extname(file)] || 'application/octet-stream');
  } catch (error) {
    send(res, 400, JSON.stringify({ ok: false, error: error.message }));
  }
});

server.listen(port, () => console.log(`Passly: http://localhost:${port}`));
module.exports = server;
