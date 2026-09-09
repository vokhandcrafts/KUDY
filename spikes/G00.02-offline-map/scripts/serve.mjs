import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verify } from '../lib/package.mjs';

const root = resolve(fileURLToPath(new URL('../runtime/active/', import.meta.url)));
await verify(root);
const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json', '.svg':'image/svg+xml' };
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    const relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
    const file = normalize(join(root, relative));
    if (!file.startsWith(`${root}/`) || !(await stat(file)).isFile()) throw new Error('not found');
    response.writeHead(200, { 'content-type': mime[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    response.end(await readFile(file));
  } catch { response.writeHead(404); response.end('not found'); }
});
server.listen(4173, '127.0.0.1', () => console.log('offline fixture: http://127.0.0.1:4173'));
