// =============================================================================
// shotserver.mjs — receives framebuffer captures from the running page.
//
// Run:  node tools/shotserver.mjs
// Then, from the page:  fetch('http://127.0.0.1:8791/shot?name=foo', {method:'POST', body: dataURL})
//
// WHY THIS EXISTS. With the Browser pane hidden the browser never composites, so
// requestAnimationFrame does not fire and the normal screenshot path returns a
// black frame or times out. Rendering can still be driven manually from a script
// and read back with gl.readPixels — the only missing piece was a way to get the
// bytes onto disk without pushing a base64 blob through the conversation. This is
// that piece: a POST endpoint that writes shots into tools/shots/.
// =============================================================================
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'shots');
mkdirSync(OUT, { recursive: true });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
  if (req.method !== 'POST') { res.writeHead(405, CORS); return res.end('POST only'); }

  const url = new URL(req.url, 'http://localhost');
  // Sanitised: this writes files, and the name arrives from the page.
  const name = (url.searchParams.get('name') || 'shot').replace(/[^a-zA-Z0-9_-]/g, '');
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8');
    const comma = body.indexOf(',');
    const b64 = comma >= 0 && body.startsWith('data:') ? body.slice(comma + 1) : body;
    const ext = body.startsWith('data:image/png') ? 'png' : 'jpg';
    const file = join(OUT, `${name}.${ext}`);
    try {
      writeFileSync(file, Buffer.from(b64, 'base64'));
      console.log('wrote', file, Buffer.from(b64, 'base64').length, 'bytes');
      res.writeHead(200, { ...CORS, 'Content-Type': 'text/plain' });
      res.end(file);
    } catch (e) {
      console.error('FAILED', e.message);
      res.writeHead(500, CORS); res.end(String(e.message));
    }
  });
}).listen(8791, '127.0.0.1', () => console.log('shotserver on http://127.0.0.1:8791'));
