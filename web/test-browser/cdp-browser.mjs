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

const DEVTOOLS_TIMEOUT_MS = 15000;
const COMMAND_TIMEOUT_MS = 15000;
const CLOSE_TIMEOUT_MS = 2000;
const PROFILE_REMOVAL_ATTEMPTS = 5;

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
  const pid = child.pid;
  // detached: true makes Chrome its own process-group leader, so a group
  // signal also reaches helpers that stayed in the group. Crashpad
  // double-forks out of the group; the launch flags stop it being spawned.
  if (typeof pid === 'number') {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error;
    }
  }
  try {
    child.kill('SIGKILL');
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
}

async function removeProfile(profileDir) {
  for (let attempt = 0; attempt < PROFILE_REMOVAL_ATTEMPTS; attempt += 1) {
    try {
      rmSync(profileDir, { recursive: true, force: true });
      return;
    } catch (error) {
      // Chrome can keep writing the profile for a moment after SIGKILL.
      // Throwing here skips the caller's server.close() and the test
      // process stays up for the rest of the job.
      if (attempt === PROFILE_REMOVAL_ATTEMPTS - 1) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (error?.code !== 'ENOTEMPTY' && error?.code !== 'EBUSY') throw error;
    }
  }
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
      // The GPU watchdog can leave Chrome alive without answering DevTools.
      // --disable-crashpad-for-testing crash-loops the network service on
      // Chrome 154 ("FD ownership violation"), so it is not set; close()
      // kills the process group instead.
      '--disable-gpu-watchdog',
      '--in-process-gpu',
      `--user-data-dir=${profileDir}`,
      'about:blank',
    ],
    { detached: true, stdio: ['ignore', 'ignore', 'pipe'] },
  );

  try {
    const wsUrl = await new Promise((resolve, reject) => {
      let buffer = '';
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error('chromium did not report a DevTools endpoint within 15s'));
      }, DEVTOOLS_TIMEOUT_MS);
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn(value);
      };
      child.stderr.on('data', (chunk) => {
        if (settled) return;
        buffer += String(chunk);
        const match = buffer.match(/DevTools listening on (ws:\/\/\S+)/);
        if (match) finish(resolve, match[1]);
      });
      child.on('exit', (code) => {
        finish(reject, new Error(`chromium exited before the DevTools endpoint appeared (code ${code})`));
      });
      child.on('error', (error) => {
        finish(reject, error);
      });
    });

    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error('DevTools WebSocket did not open within 15s'));
      }, DEVTOOLS_TIMEOUT_MS);
      ws.addEventListener('open', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      ws.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error('DevTools WebSocket connection failed'));
      }, { once: true });
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

    function clearPending() {
      for (const entry of pending.values()) clearTimeout(entry.timer);
      pending.clear();
    }

    const browser = {
      // Sends one command; sessionId scopes it to a page (flatten mode).
      // timeoutMs bounds a Chrome that stays up but never replies — the
      // failure mode that held required-checks for six hours.
      send(method, params = {}, sessionId, timeoutMs = COMMAND_TIMEOUT_MS) {
        const id = nextId++;
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            pending.delete(id);
            killChild(child);
            reject(new Error(`CDP ${method} timed out after ${timeoutMs}ms`));
          }, timeoutMs);
          pending.set(id, {
            method,
            timer,
            resolve: (value) => {
              clearTimeout(timer);
              resolve(value);
            },
            reject: (error) => {
              clearTimeout(timer);
              reject(error);
            },
          });
          try {
            ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
          } catch (error) {
            clearTimeout(timer);
            pending.delete(id);
            reject(error);
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
        if (browser.closing) return browser.closing;
        browser.closing = (async () => {
          let closeTimer;
          let onClose;
          // Chromium can close DevTools before acknowledging Browser.close;
          // cleanup must also finish when the browser stops responding.
          const stopped = new Promise(resolve => {
            onClose = resolve;
            ws.addEventListener('close', onClose, { once: true });
            closeTimer = setTimeout(resolve, CLOSE_TIMEOUT_MS);
          });
          try {
            await Promise.race([browser.send('Browser.close'), stopped]);
          } catch {
            killChild(child);
          } finally {
            clearTimeout(closeTimer);
            ws.removeEventListener('close', onClose);
            ws.close();
            clearPending();
            killChild(child);
            await removeProfile(profileDir);
          }
        })();
        return browser.closing;
      },
    };
    return browser;
  } catch (error) {
    killChild(child);
    await removeProfile(profileDir);
    throw error;
  }
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
