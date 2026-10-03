// Minimal Chrome DevTools Protocol driver for the web browser proofs
// (G21.03). The repo has no browser-automation dependency by design: this
// module drives a locally installed Chromium (or any DevTools-compatible
// binary via KUDY_CHROMIUM) over its WebSocket endpoint using the WebSocket
// client built into Node ≥ 22. Only the domains the map proofs need are
// used: Target, Page, Runtime, Fetch.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Common Chromium/Chrome binary locations; CI and dev hosts differ, the
// KUDY_CHROMIUM override wins. Returns null when the host has none — the
// caller must skip visibly (implementation-rules 7), never pass silently.
export function findChromiumBinary() {
  const candidates = [
    process.env.KUDY_CHROMIUM,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/sbin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
  ].filter((candidate) => typeof candidate === 'string' && candidate.length > 0);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export async function launchBrowser(binary) {
  const profileDir = mkdtempSync(path.join(tmpdir(), 'kudy-web-browser-'));
  const child = spawn(
    binary,
    [
      '--headless',
      '--remote-debugging-port=0',
      '--remote-allow-origins=*',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      // The map needs WebGL; on headless hosts that means software GL.
      '--enable-unsafe-swiftshader',
      '--use-angle=swiftshader',
      `--user-data-dir=${profileDir}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  const wsUrl = await new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => reject(new Error('chromium did not report a DevTools endpoint within 15s')), 15000);
    child.stderr.on('data', (chunk) => {
      buffer += String(chunk);
      const match = buffer.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`chromium exited before the DevTools endpoint appeared (code ${code})`));
    });
  });

  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('DevTools WebSocket connection failed')), { once: true });
  });

  let nextId = 1;
  const pending = new Map();
  const eventHandlers = [];
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id !== undefined && pending.has(message.id)) {
      const entry = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) entry.reject(new Error(`CDP ${entry.method} failed: ${message.error.message}`));
      else entry.resolve(message.result);
    } else if (message.method) {
      for (const handler of eventHandlers) handler(message.method, message.params, message.sessionId);
    }
  });

  const browser = {
    // Sends one command; sessionId scopes it to a page (flatten mode).
    send(method, params = {}, sessionId) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject, method });
        ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      });
    },
    onEvent(handler) {
      eventHandlers.push(handler);
    },
    async newPage() {
      const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
      return sessionId;
    },
    async close() {
      try {
        await browser.send('Browser.close');
      } catch {
        child.kill('SIGKILL');
      }
      ws.close();
      child.kill('SIGKILL');
      rmSync(profileDir, { recursive: true, force: true });
    },
  };
  return browser;
}

// Evaluates an expression and returns its JSON value; a page exception
// becomes a test error here, never a silent undefined.
export async function evaluateValue(browser, sessionId, expression) {
  const result = await browser.send(
    'Runtime.evaluate',
    { expression, returnByValue: true, awaitPromise: true },
    sessionId,
  );
  if (result.exceptionDetails) {
    const detail = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text;
    throw new Error(`page evaluate failed: ${detail}`);
  }
  return result.result.value;
}

export async function waitForExpression(browser, sessionId, expression, { timeoutMs = 20000, intervalMs = 100 } = {}) {
  const started = Date.now();
  for (;;) {
    const value = await evaluateValue(browser, sessionId, expression);
    if (value) return;
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for: ${expression}`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
