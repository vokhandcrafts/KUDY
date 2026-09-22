// Shared zero-dependency static file server for repository spikes and demos.
// Extracted from spikes/G00.02-offline-map/scripts/serve.mjs when the G06.08
// prototype spike needed the same server (universal lesson: a sibling copy in
// the diff is extracted, not pasted).
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';

const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.mjs':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json', '.svg':'image/svg+xml' };

// Containment must compare with the platform separator: on Windows
// normalize/join produce backslashes, so a hardcoded '/' would 404 every
// request (AR-2, #79; same idiom as G00.03 grant-server.mjs).
export function resolveStaticFile(root, pathname) {
  if (pathname.endsWith('/')) pathname += 'index.html';
  const relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
  const file = normalize(join(root, relative));
  if (!file.startsWith(root + sep)) return null;
  return file;
}

export function createStaticServer(root, announce) {
  return createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
      const file = resolveStaticFile(root, pathname);
      if (!file || !(await stat(file)).isFile()) throw new Error('not found');
      response.writeHead(200, { 'content-type': mime[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
      response.end(await readFile(file));
    } catch { response.writeHead(404); response.end('not found'); }
  });
}
