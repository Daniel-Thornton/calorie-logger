'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');
const url  = require('url');

const PORT       = 8787;
const OLLAMA_URL = 'http://localhost:11434';
const LOG_FILE   = path.join(__dirname, 'calorie-log.json');

// ── Persistence ──

function loadLog() {
    try { return JSON.parse(fs.readFileSync(LOG_FILE, 'utf8')); }
    catch { return {}; }
}

function saveLog(log) {
    fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2), 'utf8');
}

// ── Helpers ──

const CORS_HEADERS = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age':       '86400'
};

function json(res, status, data) {
    const body = JSON.stringify(data);
    res.writeHead(status, { 'Content-Type': 'application/json', ...CORS_HEADERS });
    res.end(body);
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => { try { resolve(JSON.parse(body)); } catch { reject(); } });
        req.on('error', reject);
    });
}

// ── Ollama proxy ──

function proxyToOllama(req, res) {
    const ollamaUrl = new URL(req.url, OLLAMA_URL);
    const options = {
        hostname: ollamaUrl.hostname,
        port:     Number(ollamaUrl.port) || 11434,
        path:     ollamaUrl.pathname + (ollamaUrl.search || ''),
        method:   req.method,
        headers:  { ...req.headers, host: ollamaUrl.host }
    };

    const proxy = http.request(options, ollamaRes => {
        // Strip any CORS headers Ollama sends — we add our own to avoid duplicates
        const headers = Object.fromEntries(
            Object.entries(ollamaRes.headers).filter(([k]) => !k.toLowerCase().startsWith('access-control-'))
        );
        res.writeHead(ollamaRes.statusCode, { ...headers, ...CORS_HEADERS });
        ollamaRes.pipe(res);
    });

    proxy.on('error', () => json(res, 502, { error: 'Ollama is not reachable on this PC.' }));
    req.pipe(proxy);
}

// ── Router ──

const server = http.createServer(async (req, res) => {
    const { pathname } = url.parse(req.url);

    if (req.method === 'OPTIONS') {
        res.writeHead(204, CORS_HEADERS);
        res.end();
        return;
    }

    // Proxy all Ollama API calls
    if (pathname.startsWith('/api/')) {
        proxyToOllama(req, res);
        return;
    }

    // GET /log — full log
    if (pathname === '/log' && req.method === 'GET') {
        json(res, 200, loadLog());
        return;
    }

    // PUT /log — replace entire log
    if (pathname === '/log' && req.method === 'PUT') {
        try {
            const data = await readBody(req);
            if (typeof data !== 'object' || Array.isArray(data)) throw new Error();
            saveLog(data);
            json(res, 200, { ok: true });
        } catch {
            json(res, 400, { error: 'Invalid log data.' });
        }
        return;
    }

    // POST /log — add entry { date, entry }
    if (pathname === '/log' && req.method === 'POST') {
        try {
            const { date, entry } = await readBody(req);
            if (!date || !entry) throw new Error();
            const log = loadLog();
            if (!log[date]) log[date] = [];
            log[date].push(entry);
            saveLog(log);
            json(res, 200, { ok: true });
        } catch {
            json(res, 400, { error: 'Invalid request body.' });
        }
        return;
    }

    // DELETE /log/:date/:id — remove entry
    const del = pathname.match(/^\/log\/([^/]+)\/(\d+)$/);
    if (del && req.method === 'DELETE') {
        const [, date, idStr] = del;
        const log = loadLog();
        if (log[date]) {
            log[date] = log[date].filter(e => e.id !== Number(idStr));
            saveLog(log);
        }
        json(res, 200, { ok: true });
        return;
    }

    res.writeHead(404, CORS_HEADERS);
    res.end('Not found');
});

server.listen(PORT, '127.0.0.1', () => {
    console.log('');
    console.log('  Calorie Logger server running');
    console.log(`  Listening on http://localhost:${PORT}`);
    console.log(`  Log file: ${LOG_FILE}`);
    console.log('');
    console.log('  Point your Cloudflare tunnel at:');
    console.log(`  http://localhost:${PORT}`);
    console.log('');
});
