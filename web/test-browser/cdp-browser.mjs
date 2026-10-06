// Minimal Chrome DevTools Protocol driver for the web browser proofs
// (G21.03). The repo has no browser-automation dependency by design: this
// module drives a locally installed Chromium (or any DevTools-compatible
// binary via KUDY_CHROMIUM) over its WebSocket endpoint using the WebSocket
// client built into Node ≥ 22. Only the domains the map proofs need are
// used: Target, Page, Runtime, Fetch.
//
// Every command is bounded. A DevTools reply that never arrives, a socket
// that closes, or a Chromium process that exits rejects the in-flight
// command. waitForExpression only checks its deadline between replies, so
// an unbounded send() pins the Node 22 job until the runner's six-hour
// cancel (the G21.03 map test is the only CDP caller in npm test).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const COMMAND_TIMEOUT_MS = 20000;

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

function killChild(child) {
  // Chromium forks renderer and GPU processes. Killing only the parent
  // leaves those children holding the DevTools socket or the harness
  // connection, and the test process never exits. detached puts the
  // browser in its own group so the negative pid reaches the children.
  // Windows has no negative-pid groups; child.kill covers that host.
  if (process.platform !== 'win32' && Number.isInteger(child.pid)) {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* group already gone */ }
  }
  try { child.kill('SIGKILL'); } catch { /* already dead */ }
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
    { detached: true, stdio: ['ignore', 'ignore', 'pipe'] },
  );
  const pending = new Map();
  function failPending(error) {
    // Copy first: reject() deletes the entry, and a live Map iterator can
    // skip the rest — those commands would stay pending.
    for (const entry of [...pending.values()]) entry.reject(error);
  }
  child.on('exit', (code, signal) => {
    failPending(new Error(`chromium exited (${signal || code})`));
  });

  let ws;
  try {
    const wsUrl = await new Promise((resolve, reject) => {
      let buffer = '';
      let capture = true;
      let settled = false;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn(value);
      };
      const timer = setTimeout(
        () => finish(reject, new Error('chromium did not report a DevTools endpoint within 15s')),
        15000,
      );
      child.stderr.on('data', (chunk) => {
        if (!capture) return;
        buffer += String(chunk);
        const match = buffer.match(/DevTools listening on (ws:\/\/\S+)/);
        if (match) {
          capture = false;
          buffer = '';
          finish(resolve, match[1]);
        }
      });
      child.on('exit', (code, signal) => {
        finish(reject, new Error(`chromium exited before the DevTools endpoint appeared (${signal || code})`));
      });
    });

    ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('DevTools WebSocket did not open within 15s'));
      }, 15000);
      ws.addEventListener('open', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      ws.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error('DevTools WebSocket connection failed'));
      }, { once: true });
    });
  } catch (error) {
    try { ws?.close(); } catch { /* socket never opened */ }
    killChild(child);
    rmSync(profileDir, { recursive: true, force: true });
    throw error;
  }

  let nextId = 1;
  const eventHandlers = [];
  ws.addEventListener('close', () => failPending(new Error('DevTools WebSocket closed')));
  ws.addEventListener('error', () => failPending(new Error('DevTools WebSocket error')));
  ws.addEventListener('message', (event) => {
    // Undici has delivered a message event whose data is null when a ping
    // frame is mis-parsed. That throw used to escape the listener and leave
    // the matching command pending forever.
    let message;
    try {
      if (typeof event.data !== 'string') return;
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (!message || typeof message !== 'object') return;
    if (message.id !== undefined && pending.has(message.id)) {
      const entry = pending.get(message.id);
      if (message.error) entry.reject(new Error(`CDP ${entry.method} failed: ${message.error.message}`));
      else entry.resolve(message.result);
    } else if (message.method) {
      // Reply to Fetch.requestPaused outside this callback. Sending from
      // inside the message listener re-enters the socket parser.
      const method = message.method;
      const params = message.params;
      const sessionId = message.sessionId;
      queueMicrotask(() => {
        for (const handler of eventHandlers) handler(method, params, sessionId);
      });
    }
  });

  const browser = {
    // Sends one command; sessionId scopes it to a page (flatten mode).
    // timeoutMs bounds a reply that never comes — the default matches the
    // map proof's own wait, and tests pass a shorter one.
    send(method, params = {}, sessionId, timeoutMs = COMMAND_TIMEOUT_MS) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        let timer;
        const finish = (fn, value) => {
          if (!pending.has(id)) return;
          clearTimeout(timer);
          pending.delete(id);
          fn(value);
        };
        timer = setTimeout(() => {
          finish(reject, new Error(`CDP ${method} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        pending.set(id, {
          method,
          resolve: (value) => finish(resolve, value),
          reject: (error) => finish(reject, error),
        });
        try {
          ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
        } catch (error) {
          finish(reject, error);
        }
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
      let closeTimer;
      let onClose;
      // Chromium can close DevTools before acknowledging Browser.close;
      // cleanup must also finish when the browser stops responding.
      const stopped = new Promise(resolve => {
        onClose = resolve;
        ws.addEventListener('close', onClose, { once: true });
        closeTimer = setTimeout(resolve, 2000);
      });
      try {
        await Promise.race([browser.send('Browser.close'), stopped]);
      } catch {
        // The reply failed or the socket is already closed. Cleanup still runs.
      } finally {
        clearTimeout(closeTimer);
        ws.removeEventListener('close', onClose);
        failPending(new Error('browser closed'));
        try { ws.close(); } catch { /* already closed */ }
        killChild(child);
        rmSync(profileDir, { recursive: true, force: true });
      }
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
