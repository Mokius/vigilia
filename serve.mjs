// Minimal zero-dependency static server for the U-Box horror experience.
// Serves ES modules with correct MIME so the importmap works. Node >=18.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = process.env.PORT || 8770;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.wasm': 'application/wasm',
};

import { writeFile } from 'node:fs/promises';

createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://x');
    // Dev-only: let the page save a rendered frame to disk for review.
    if (req.method === 'POST' && u.pathname === '/__save') {
      const name = (u.searchParams.get('f') || 'frame.png').replace(/[^a-zA-Z0-9._-]/g, '');
      const chunks = []; for await (const c of req) chunks.push(c);
      await writeFile(join(ROOT, 'docs', name), Buffer.concat(chunks));
      res.writeHead(200).end('saved ' + name); return;
    }
    let p = decodeURIComponent(u.pathname);
    if (p === '/' || p.endsWith('/')) p += 'index.html';
    const full = normalize(join(ROOT, p));
    if (!full.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }
    const s = await stat(full).catch(() => null);
    if (!s || !s.isFile()) { res.writeHead(404).end('not found: ' + p); return; }
    const buf = await readFile(full);
    res.writeHead(200, {
      'Content-Type': MIME[extname(full).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(buf);
  } catch (e) {
    res.writeHead(500).end(String(e));
  }
}).listen(PORT, () => console.log(`VIGILIA dev server → http://localhost:${PORT}`));
