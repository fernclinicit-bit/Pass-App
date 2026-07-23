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
  if (!secret) return true;
  const expected = crypto.createHmac('sha256', secret).update(raw).digest('base64');
  const actualBuffer = Buffer.from(signature || '');
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function parseLineRequest(event) {
  if (event.type !== 'message' || event.message?.type !== 'text') return null;
  const text = event.message.text.trim();
  const isRequest = /ขอ\s*(รหัส|password|pass)|password\s*request/i.test(text);
  if (!isRequest) return null;
  const clean = text
    .replace(/ขอ\s*(รหัส|password|pass)\s*/i, '')
    .replace(/password\s*request\s*/i, '')
    .trim();
  const [systemPart, ...reasonParts] = clean.split(/\n|เหตุผล\s*[:：]?/i);
  return {
    id: `line-${event.webhookEventId || event.message.id}`,
    name: `LINE User ${String(event.source?.userId || '').slice(-6)}`,
    email: event.source?.userId || 'LINE',
    system: systemPart || 'ไม่ระบุระบบ',
    reason: reasonParts.join(' ').trim() || text,
    date: new Date(event.timestamp || Date.now()).toISOString().slice(0, 10),
    receivedAt: new Date(event.timestamp || Date.now()).toISOString(),
    status: 'pending',
    urgent: /ด่วน|urgent/i.test(text),
    source: 'LINE',
    lineUserId: event.source?.userId || null,
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
  const incoming = (payload.events || []).map(parseLineRequest).filter(Boolean);
  for (const item of incoming) {
    if (!known.has(item.id)) current.unshift(item);
  }
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

http.createServer(async (req, res) => {
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
      return send(res, 200, JSON.stringify({ ok: true, lineConfigured: Boolean(process.env.LINE_CHANNEL_SECRET) }));
    }

    const target = req.url === '/' ? '/index.html' : req.url.split('?')[0];
    const file = path.resolve(root, '.' + target);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
    }
    send(res, 200, fs.readFileSync(file), types[path.extname(file)] || 'application/octet-stream');
  } catch (error) {
    send(res, 400, JSON.stringify({ ok: false, error: error.message }));
  }
}).listen(port, () => console.log(`Passly: http://localhost:${port}`));
