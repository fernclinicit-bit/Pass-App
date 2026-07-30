const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  SESSION_TTL_MS,
  createSessionToken,
  verifyPinHash,
  verifySessionToken,
} = require('./pin-auth.cjs');

const root = __dirname;
const port = process.env.PORT || 3030;
const dataDir = process.env.DATA_DIR || path.join(root, 'data');
const requestFile = path.join(dataDir, 'requests.json');
const lineApiBaseUrl = (process.env.LINE_API_BASE_URL || 'https://api.line.me').replace(/\/+$/, '');
const adminPinHash = String(process.env.PASSLY_ADMIN_PIN_HASH || '').trim();
const adminSessionCookie = 'passly_admin_session';
const authWindowMs = 15 * 60 * 1000;
const authAttemptLimit = 5;
const maxShareExpiryMs = 30 * 24 * 60 * 60 * 1000;
const authAttempts = new Map();
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

function send(res, code, body, type = 'application/json; charset=utf-8', extraHeaders = {}) {
  res.writeHead(code, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    ...extraHeaders,
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

function parseCookies(req) {
  const cookies = {};
  for (const item of String(req.headers.cookie || '').split(';')) {
    const separator = item.indexOf('=');
    if (separator < 1) continue;
    const name = item.slice(0, separator).trim();
    const value = item.slice(separator + 1).trim();
    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      cookies[name] = '';
    }
  }
  return cookies;
}

function clientAddress(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown')
    .split(',')[0]
    .trim()
    .slice(0, 120);
}

function sessionCookie(req, token, maxAgeSeconds = Math.floor(SESSION_TTL_MS / 1000)) {
  const secure = process.env.NODE_ENV === 'production'
    || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
  return [
    `${adminSessionCookie}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${maxAgeSeconds}`,
    secure ? 'Secure' : '',
  ].filter(Boolean).join('; ');
}

function isAdminAuthenticated(req) {
  if (!adminPinHash) return false;
  return verifySessionToken(parseCookies(req)[adminSessionCookie], adminPinHash);
}

function requireAdminSession(req, res) {
  if (!adminPinHash) {
    send(res, 503, JSON.stringify({
      ok: false,
      error: 'ยังไม่ได้ตั้งค่า PIN สำหรับผู้ดูแลบน Server',
    }));
    return false;
  }
  if (!isAdminAuthenticated(req)) {
    send(res, 401, JSON.stringify({
      ok: false,
      error: 'กรุณาเข้าสู่ระบบ Passly อีกครั้ง',
    }));
    return false;
  }
  return true;
}

function activeAuthAttempt(address, now = Date.now()) {
  const state = authAttempts.get(address);
  if (!state || state.resetAt <= now) {
    authAttempts.delete(address);
    return null;
  }
  return state;
}

function recordFailedAuth(address, now = Date.now()) {
  const current = activeAuthAttempt(address, now) || {
    count: 0,
    resetAt: now + authWindowMs,
  };
  current.count += 1;
  authAttempts.set(address, current);
  if (authAttempts.size > 10_000) authAttempts.delete(authAttempts.keys().next().value);
  return current;
}

function rateLimitResponse(res, state, now = Date.now()) {
  const retryAfter = Math.max(1, Math.ceil((state.resetAt - now) / 1000));
  send(
    res,
    429,
    JSON.stringify({
      ok: false,
      error: 'ลอง PIN ไม่ถูกต้องหลายครั้ง กรุณารอสักครู่แล้วลองใหม่',
      retryAfter,
    }),
    'application/json; charset=utf-8',
    { 'Retry-After': String(retryAfter) },
  );
}

async function handleAdminPinAuth(req, res) {
  if (!adminPinHash) {
    return send(res, 503, JSON.stringify({
      ok: false,
      error: 'ยังไม่ได้ตั้งค่า PIN สำหรับผู้ดูแลบน Server',
    }));
  }

  const address = clientAddress(req);
  const activeAttempt = activeAuthAttempt(address);
  if (activeAttempt?.count >= authAttemptLimit) return rateLimitResponse(res, activeAttempt);

  const data = JSON.parse(await readBody(req, 2_000) || '{}');
  const pin = typeof data.pin === 'string' ? data.pin : '';
  const valid = await verifyPinHash(pin, adminPinHash);
  if (!valid) {
    const failed = recordFailedAuth(address);
    if (failed.count >= authAttemptLimit) return rateLimitResponse(res, failed);
    return send(res, 401, JSON.stringify({
      ok: false,
      error: 'PIN ไม่ถูกต้อง',
      attemptsRemaining: authAttemptLimit - failed.count,
    }));
  }

  authAttempts.delete(address);
  const token = createSessionToken(adminPinHash);
  return send(
    res,
    200,
    JSON.stringify({ ok: true, expiresIn: Math.floor(SESSION_TTL_MS / 1000) }),
    'application/json; charset=utf-8',
    { 'Set-Cookie': sessionCookie(req, token) },
  );
}

function handleAdminLogout(req, res) {
  send(
    res,
    200,
    JSON.stringify({ ok: true }),
    'application/json; charset=utf-8',
    { 'Set-Cookie': sessionCookie(req, '', 0) },
  );
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
  const response = await fetch(`${lineApiBaseUrl}/v2/bot/message/reply`, {
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

async function pushLine(to, messages) {
  const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!accessToken) throw new Error('ยังไม่ได้ตั้งค่า LINE_CHANNEL_ACCESS_TOKEN');
  const response = await fetch(`${lineApiBaseUrl}/v2/bot/message/push`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ to, messages }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`LINE push failed: ${response.status} ${detail}`);
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
      `${lineApiBaseUrl}/v2/bot/group/${encodeURIComponent(groupId)}/member/${encodeURIComponent(userId)}`,
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

function validatedShareUrl(req, value) {
  const shareUrl = new URL(String(value || ''));
  const expectedHost = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  if (shareUrl.host !== expectedHost || shareUrl.pathname !== '/share.html' || !shareUrl.hash) {
    throw new Error('ลิงก์ Passly Share ไม่ถูกต้อง');
  }
  const isLoopback = shareUrl.hostname === '127.0.0.1' || shareUrl.hostname === 'localhost' || shareUrl.hostname === '::1';
  if (process.env.NODE_ENV === 'production' && !isLoopback && shareUrl.protocol !== 'https:') {
    throw new Error('ลิงก์ Passly Share ต้องใช้ HTTPS');
  }
  if (shareUrl.href.length > 4_000) throw new Error('ลิงก์ Passly Share ยาวเกินไป');
  return shareUrl.href;
}

async function handleLineDelivery(req, res) {
  const data = JSON.parse(await readBody(req) || '{}');
  const requests = readRequests();
  const request = requests.find((item) => item.id === String(data.requestId || ''));
  if (!request || request.source !== 'LINE') {
    return send(res, 404, JSON.stringify({ ok: false, error: 'ไม่พบคำขอ LINE นี้ กรุณาให้ผู้ใช้ส่งคำขอใหม่' }));
  }

  const groupId = String(request.lineGroupId || '');
  const allowedGroupId = process.env.LINE_ALLOWED_GROUP_ID;
  if (!groupId.startsWith('C') || (allowedGroupId && groupId !== allowedGroupId)) {
    return send(res, 403, JSON.stringify({ ok: false, error: 'กลุ่ม LINE ของคำขอนี้ไม่ได้รับอนุญาต' }));
  }

  const pin = String(data.pin || '').trim();
  const itemName = String(data.itemName || request.system || 'บัญชีที่ร้องขอ').trim().slice(0, 100);
  const expiresAt = new Date(data.expiresAt);
  if (!/^[A-Za-z0-9]{4,32}$/.test(pin)) throw new Error('Share PIN ไม่ถูกต้อง');
  if (!itemName) throw new Error('ไม่พบชื่อรายการที่จะแจก');
  if (Number.isNaN(expiresAt.getTime()) || expiresAt <= new Date() || expiresAt > new Date(Date.now() + maxShareExpiryMs)) {
    throw new Error('วันหมดอายุของลิงก์ต้องอยู่ในอนาคตและไม่เกิน 30 วัน');
  }

  const shareUrl = validatedShareUrl(req, data.shareUrl);
  const expiryText = new Intl.DateTimeFormat('th-TH', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Bangkok',
  }).format(expiresAt);
  const linkMessage = [
    '[Passly] ข้อมูลเข้าใช้งานพร้อมแล้ว',
    `ผู้รับ: ${request.name}`,
    `ระบบ: ${itemName}`,
    `หมดอายุ: ${expiryText}`,
    `เปิดข้อมูล: ${shareUrl}`,
  ].join('\n');
  const pinMessage = [
    `[Passly] Share PIN: ${pin}`,
    `สำหรับคำขอ ${itemName}`,
    'ใช้ PIN นี้เปิดลิงก์ Passly ในข้อความก่อนหน้า',
  ].join('\n');
  if (linkMessage.length > 5_000 || pinMessage.length > 5_000) {
    throw new Error('ข้อความ LINE ยาวเกินขีดจำกัด');
  }

  await pushLine(groupId, [
    { type: 'text', text: linkMessage },
    { type: 'text', text: pinMessage },
  ]);

  request.status = 'delivered';
  request.deliveredAt = new Date().toISOString();
  request.deliveryMethod = 'line-secure-share';
  writeRequests(requests);
  send(res, 200, JSON.stringify({ ok: true, deliveredTo: 'LINE' }));
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && req.url === '/api/auth/pin') {
      return await handleAdminPinAuth(req, res);
    }
    if (req.method === 'GET' && req.url === '/api/auth/status') {
      return send(res, 200, JSON.stringify({
        ok: true,
        configured: Boolean(adminPinHash),
        authenticated: isAdminAuthenticated(req),
      }));
    }
    if (req.method === 'POST' && req.url === '/api/auth/logout') {
      return handleAdminLogout(req, res);
    }
    if (req.method === 'POST' && req.url === '/api/line/webhook') {
      return await handleLineWebhook(req, res);
    }
    if (req.method === 'GET' && req.url === '/api/requests') {
      if (!requireAdminSession(req, res)) return;
      return send(res, 200, JSON.stringify({ requests: readRequests() }));
    }
    if (req.method === 'POST' && req.url === '/api/line/deliver') {
      if (!requireAdminSession(req, res)) return;
      return await handleLineDelivery(req, res);
    }
    if (req.method === 'GET' && req.url === '/api/health') {
      return send(res, 200, JSON.stringify({
        ok: true,
        adminPinConfigured: Boolean(adminPinHash),
        lineConfigured: Boolean(process.env.LINE_CHANNEL_SECRET),
        lineReplyConfigured: Boolean(process.env.LINE_CHANNEL_ACCESS_TOKEN),
        lineGroupRestricted: Boolean(process.env.LINE_ALLOWED_GROUP_ID),
        requestChannel: 'LINE',
        deliveryChannel: 'LINE',
        larkInboundEnabled: false,
        larkConfigured: false,
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
