/**
 * Serves the browser-check page (page + real client bundle + proxied host API)
 * on a fixed loopback port, and writes the page to disk for inspection.
 *
 * Rendering is done by a separate --dump-dom/--screenshot browser run
 * orchestrated from the shell: this process cannot capture a child's stdout
 * (piped stdio is blocked under the file sandbox), while file redirection works.
 *
 * Run: node test/check-server.mjs <port> <outDir>
 * Prints one line `CHECK-SERVER-READY <origin>` after listening.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';

const port = Number(process.argv[2] || 0);
const outDir = process.argv[3] || '.';
const DSH = process.env.DSH_WEB_URL || 'http://127.0.0.1:3080';
const BUNDLE = new URL('../lib/client.js', import.meta.url);
const PAGE_SOURCE = new URL('./check-page.html', import.meta.url);

mkdirSync(outDir, { recursive: true });
const bundleBytes = readFileSync(BUNDLE);
const pageHtml = readFileSync(PAGE_SOURCE);

/* The page is served verbatim to the browser and also written out for eyeballing. */
writeFileSync(join(outDir, 'served-page.html'), pageHtml);

const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        res.end(pageHtml);
        return;
    }
    if (url.pathname === '/client.js') {
        res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store', 'content-length': bundleBytes.length });
        res.end(bundleBytes);
        return;
    }
    if (url.pathname.startsWith('/api/')) {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = chunks.length === 0 ? undefined : Buffer.concat(chunks);
        try {
            const upstream = await fetch(DSH + url.pathname + url.search, {
                method: req.method,
                headers: body === undefined ? undefined : { 'content-type': req.headers['content-type'] || 'application/json' },
                body,
            });
            const text = await upstream.text();
            res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') || 'application/json' });
            res.end(text);
        } catch (error) {
            res.writeHead(502, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: String(error && error.message ? error.message : error) }));
        }
        return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
});

server.listen(port, '127.0.0.1', () => {
    const origin = `http://127.0.0.1:${server.address().port}`;
    console.log('CHECK-SERVER-READY ' + origin);
    console.log('page written to ' + join(outDir, 'served-page.html'));
});
