// AR-2 regression guard (#79): the containment check in scripts/serve.mjs must
// use the platform path separator. With the pre-fix hardcoded '/', Windows
// normalize/join produce backslashes and every request — legitimate or not —
// answered 404. This test boots the server over a freshly prepared package and
// fails on any platform if the containment check is reverted or bypassed.
import { spawn, execFileSync } from 'node:child_process';
import { request } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const spikeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// `request` sends the path verbatim (unlike fetch, which normalizes dot
// segments), so traversal shapes actually reach the server.
const get = (requestPath) => new Promise((resolve, reject) => {
  const req = request({ host: '127.0.0.1', port: 4173, path: requestPath }, (res) => {
    res.resume();
    res.on('end', () => resolve(res.statusCode));
  });
  req.on('error', reject);
  req.end();
});

// The server binds the documented fixed port 4173; a just-freed port can
// briefly refuse a new bind, so booting retries a few times.
async function bootServer() {
  let lastError = null;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const child = spawn(process.execPath, ['scripts/serve.mjs'], { cwd: spikeRoot, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`server did not announce within 5s; stderr: ${stderr}`)), 5000);
        child.stdout.on('data', (chunk) => {
          if (chunk.toString().includes('offline fixture')) { clearTimeout(timer); resolve(); }
        });
        child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited early: ${code}; stderr: ${stderr}`)); });
      });
      return child;
    } catch (error) {
      lastError = error;
      child.kill();
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw lastError;
}

test('serve.mjs serves the activated package and contains traversal', async () => {
  // A ready package is required to boot; the AR-1 eol pin keeps this working
  // on a CRLF checkout.
  execFileSync(process.execPath, ['scripts/prepare-data.mjs'], { cwd: spikeRoot });
  const child = await bootServer();
  try {
    assert.equal(await get('/'), 200, 'GET / must serve index.html');
    assert.equal(await get('/style.json'), 200, 'GET /style.json must be served');
    assert.equal(await get('/glyphs/0-255.json'), 200, 'a nested package file must be served (subdirectory join on Windows)');
    assert.equal(await get('/../source/app.js'), 404, 'dot-segment traversal must be contained');
    assert.equal(await get('/%2e%2e/lib/package.mjs'), 404, 'percent-encoded traversal must be contained');
  } finally {
    child.kill();
  }
});
