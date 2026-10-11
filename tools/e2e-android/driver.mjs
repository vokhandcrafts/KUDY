// G23.03 (issue #661) — zero-dependency Android E2E driver. The repo has no
// device-automation dependency by design: this module drives a booted Android
// emulator through the `adb` binary only (G21.03 set the same principle for
// browsers via web/test-browser/cdp-browser.mjs). It owns every adb
// interaction of the suite: install, launch, uiautomator dumps, taps by
// testID/text, Back, background/foreground, force-stop, geo fix and failure
// screenshots. Waits poll real device state with a deadline — never fixed
// sleeps — and every failure carries the selector, the command or the dump
// that explains it (criterion 1).
//
// The dump protocol follows tools/android-build/emulator-scenarios.ps1
// (G21.36): the previous device-side dump file is removed before each dump,
// a failed dump is retried, and a dump whose file never appears is never
// evaluated — an old screen must not read as the expected one.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ADB_TIMEOUT_MS = 15000;
const INSTALL_TIMEOUT_MS = 300000;
const DUMP_TIMEOUT_MS = 15000;
const DUMP_ATTEMPTS = 3;
const DUMP_DEVICE_PATH = '/sdcard/kudy-e2e-ui.xml';
const POLL_INTERVAL_MS = 500;
const ARTIFACT_BASENAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export class DriverError extends Error {
  constructor(message, ids = {}) {
    super(message);
    this.name = 'DriverError';
    this.ids = ids;
  }
}

const quoteShell = (value) => `'${String(value).replaceAll("'", `'\\''`)}'`;

// The adb binary: KUDY_ADB wins, then ANDROID_HOME/platform-tools, then the
// host PATH. Returns the resolved path or null — the caller must skip
// visibly (implementation-rules 7), never pass silently.
export function resolveAdb(env = process.env) {
  const exe = process.platform === 'win32' ? 'adb.exe' : 'adb';
  const candidates = [];
  if (typeof env.KUDY_ADB === 'string' && env.KUDY_ADB.length > 0) candidates.push(env.KUDY_ADB);
  if (typeof env.ANDROID_HOME === 'string' && env.ANDROID_HOME.length > 0) {
    candidates.push(path.join(env.ANDROID_HOME, 'platform-tools', exe));
  }
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  const probe = spawnSync(exe, ['version'], { encoding: 'utf8', timeout: ADB_TIMEOUT_MS });
  if (!probe.error) return exe;
  return null;
}

// Booted devices only (`device` state); offline/unauthorized targets are not
// drivable and must not be picked. Returns serials, e.g. ['emulator-5554'].
export async function listBootedDevices(adbPath, { timeoutMs = ADB_TIMEOUT_MS } = {}) {
  const result = await execAdb(adbPath, null, ['devices'], { timeoutMs });
  return parseDevicesOutput(result.stdout);
}

export function parseDevicesOutput(stdout) {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /\s+device$/.test(line) && !line.startsWith('List of'))
    .map((line) => line.split(/\s+/)[0]);
}

function execAdb(adbPath, serial, args, { timeoutMs = ADB_TIMEOUT_MS, capture } = {}) {
  const full = serial === null ? args : ['-s', serial, ...args];
  return new Promise((resolve, reject) => {
    const child = spawn(adbPath, full, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new DriverError(`adb timed out after ${timeoutMs} ms: adb ${full.join(' ')}`));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => stdout.push(capture ? chunk : chunk.toString('utf8')));
    child.stderr.on('data', (chunk) => stderr.push(chunk.toString('utf8')));
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new DriverError(`adb failed to start: ${error.message} (adb ${full.join(' ')})`));
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const out = capture ? Buffer.concat(stdout) : stdout.join('');
      const err = stderr.join('');
      if (code !== 0) {
        reject(
          new DriverError(
            `adb exited with code ${code}: adb ${full.join(' ')}\nstderr: ${err.trim() || '(empty)'}`,
            { command: `adb ${full.join(' ')}` },
          ),
        );
        return;
      }
      resolve({ stdout: out, stderr: err });
    });
  });
}

// Minimal entity decode for the five XML built-ins uiautomator writes.
function decodeXmlEntities(value) {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}

// Parse one `<node …>` opening tag body with a quote-aware scan: attribute
// values may legally contain `>`, so the tag ends only at a `>` outside
// quotes. Corrupt input yields fewer nodes and diagnostics, never a throw
// (implementation-rules 14).
function parseNodeTag(xml, start) {
  let inQuote = false;
  for (let i = start; i < xml.length; i += 1) {
    const ch = xml[i];
    if (ch === '"') inQuote = !inQuote;
    if (ch === '>' && !inQuote) return xml.slice(start, i);
  }
  return null;
}

const ATTR_RE = /([A-Za-z_][\w.-]*)="([^"]*)"/g;

function parseAttributes(tagBody) {
  const attrs = {};
  for (const match of tagBody.matchAll(ATTR_RE)) {
    attrs[match[1]] = decodeXmlEntities(match[2]);
  }
  return attrs;
}

// "[x1,y1][x2,y2]" → { x, y } centre; null when the dump carries no bounds.
export function nodeCenter(bounds) {
  const match = /\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/.exec(bounds ?? '');
  if (!match) return null;
  const x1 = Number(match[1]);
  const y1 = Number(match[2]);
  const x2 = Number(match[3]);
  const y2 = Number(match[4]);
  return { x: Math.round((x1 + x2) / 2), y: Math.round((y1 + y2) / 2) };
}

// Flat list of the dump's nodes: resource-id (the RN testID), text,
// content-desc, class, clickable flag and centre. Hierarchy is not needed by
// any selector this suite uses.
export function parseDump(xml) {
  if (typeof xml !== 'string') return [];
  const nodes = [];
  let cursor = 0;
  for (;;) {
    const start = xml.indexOf('<node', cursor);
    if (start === -1) break;
    const tagBody = parseNodeTag(xml, start + 5);
    if (tagBody === null) {
      // Unterminated tag: stop with what was parsed so far.
      break;
    }
    cursor = start + 5 + tagBody.length + 1;
    const attrs = parseAttributes(tagBody);
    nodes.push({
      resourceId: attrs['resource-id'] ?? '',
      text: attrs.text ?? '',
      contentDesc: attrs['content-desc'] ?? '',
      cls: attrs.class ?? '',
      clickable: attrs.clickable === 'true',
      bounds: attrs.bounds ?? '',
      center: nodeCenter(attrs.bounds),
    });
  }
  return nodes;
}

function matches(node, selector) {
  if (typeof selector.testID === 'string') return node.resourceId === selector.testID;
  if (typeof selector.text === 'string') return node.text === selector.text;
  if (typeof selector.textContains === 'string') return node.text.includes(selector.textContains);
  if (typeof selector.contentDesc === 'string') return node.contentDesc === selector.contentDesc;
  return false;
}

// The single selector semantics of the suite: exact testID/resource-id,
// exact text or content-desc, substring text. Exported so the unit tests
// exercise the same lookup the waits use (implementation-rules 15).
export function findNode(nodes, selector) {
  return nodes.find((candidate) => matches(candidate, selector));
}

export function describeSelector(selector) {
  if (typeof selector.testID === 'string') return `testID "${selector.testID}"`;
  if (typeof selector.text === 'string') return `text "${selector.text}"`;
  if (typeof selector.textContains === 'string') return `text containing "${selector.textContains}"`;
  if (typeof selector.contentDesc === 'string') return `content-desc "${selector.contentDesc}"`;
  return JSON.stringify(selector);
}

// One booted emulator or device. Every device touch of the suite goes
// through this class — the runner never spawns adb on its own.
export class E2eDriver {
  constructor({ adbPath, serial, artifactsDir, pkg } = {}) {
    if (typeof adbPath !== 'string' || adbPath.length === 0) throw new DriverError('E2eDriver: adbPath required');
    if (typeof serial !== 'string' || serial.length === 0) throw new DriverError('E2eDriver: serial required');
    if (typeof artifactsDir !== 'string' || artifactsDir.length === 0) {
      throw new DriverError('E2eDriver: artifactsDir required');
    }
    this.adbPath = adbPath;
    this.serial = serial;
    this.artifactsDir = artifactsDir;
    this.pkg = pkg;
    fs.mkdirSync(artifactsDir, { recursive: true });
  }

  async exec(args, options = {}) {
    return execAdb(this.adbPath, this.serial, args, options);
  }

  artifactPath(basename) {
    if (!ARTIFACT_BASENAME.test(basename)) {
      throw new DriverError(`artifact basename rejected: ${JSON.stringify(basename)}`);
    }
    return path.join(this.artifactsDir, basename);
  }

  async install(apkPath) {
    const result = await this.exec(['install', '-r', '-g', apkPath], { timeoutMs: INSTALL_TIMEOUT_MS });
    if (!result.stdout.includes('Success')) {
      throw new DriverError(`install did not report Success: ${result.stdout.trim() || '(empty stdout)'}`);
    }
  }

  async isPackageInstalled(pkg) {
    const result = await this.exec(['shell', 'pm', 'list', 'packages', pkg]);
    return result.stdout.split(/\r?\n/).includes(`package:${pkg}`);
  }

  // Deep-link launch. The URL is passed to the device shell as one
  // single-quoted word — adb shell re-parses the command line on the device.
  async launchDeepLink(url) {
    const result = await this.exec(['shell', `am start -a android.intent.action.VIEW -d ${quoteShell(url)}`]);
    const out = result.stdout.trim();
    if (/^(Error|Security exception|Exception)/m.test(out)) {
      throw new DriverError(`launch failed for ${url}: ${out.split(/\r?\n/)[0]}`);
    }
    return out;
  }

  async foregroundApp(pkg) {
    const result = await this.exec(['shell', 'monkey', '-p', pkg, '-c', 'android.intent.category.LAUNCHER', '1']);
    if (/^\*\* Error/i.test(result.stdout.trim())) {
      throw new DriverError(`foreground failed for ${pkg}: ${result.stdout.trim().split(/\r?\n/)[0]}`);
    }
  }

  async back() {
    await this.exec(['shell', 'input', 'keyevent', '4']);
  }

  async background() {
    await this.exec(['shell', 'input', 'keyevent', '3']);
  }

  async forceStop(pkg) {
    await this.exec(['shell', 'am', 'force-stop', pkg]);
  }

  // adb emu console: longitude first, latitude second.
  async geoFix(latitude, longitude) {
    await this.exec(['emu', 'geo', 'fix', String(longitude), String(latitude)]);
  }

  // Dump the current UI hierarchy to a local file. The device-side file is
  // removed first and the local one never pre-exists, so a dump can only be
  // this screen's (G21.36 protocol).
  async dump(basename, { timeoutMs = DUMP_TIMEOUT_MS } = {}) {
    const localPath = this.artifactPath(basename);
    fs.rmSync(localPath, { force: true });
    await this.exec(['shell', 'rm', '-f', DUMP_DEVICE_PATH], { timeoutMs: 5000 }).catch((error) => {
      // A missing file makes rm fail on some images; the dump below still
      // decides. Surface the reason instead of swallowing it.
      fs.appendFileSync(this.artifactPath('driver.log'), `rm before dump: ${error.message}\n`);
    });
    let lastError = null;
    for (let attempt = 1; attempt <= DUMP_ATTEMPTS; attempt += 1) {
      try {
        await this.exec(['shell', 'uiautomator', 'dump', DUMP_DEVICE_PATH], { timeoutMs });
        await this.exec(['pull', DUMP_DEVICE_PATH, localPath], { timeoutMs });
        const xml = fs.readFileSync(localPath, 'utf8');
        if (xml.includes('<node')) return { localPath, xml };
        lastError = new DriverError(`dump at ${localPath} has no <node> content (${xml.length} bytes)`);
      } catch (error) {
        lastError = error;
      }
    }
    throw new DriverError(`uiautomator dump failed after ${DUMP_ATTEMPTS} attempts: ${lastError?.message ?? 'unknown'}`);
  }

  async screenshot(basename) {
    const localPath = this.artifactPath(basename);
    const png = await this.exec(['exec-out', 'screencap', '-p'], { capture: true, timeoutMs: 30000 });
    if (png.stdout.length < 100) {
      throw new DriverError(`screenshot at ${localPath} is too small (${png.stdout.length} bytes)`);
    }
    fs.writeFileSync(localPath, png.stdout);
    return localPath;
  }

  // Condition wait: poll fresh dumps until the selector is present or the
  // deadline passes. The rolling dump file always holds the LAST observed
  // screen, so a timeout names the selector and where to look.
  async waitFor(selector, { timeoutMs = 30000, dumpBasename = 'last-wait-dump.xml' } = {}) {
    const startedAt = Date.now();
    let lastDumpPath = null;
    for (;;) {
      const dump = await this.dump(dumpBasename, { timeoutMs: DUMP_TIMEOUT_MS });
      lastDumpPath = dump.localPath;
      const node = findNode(parseDump(dump.xml), selector);
      if (node) return node;
      if (Date.now() - startedAt >= timeoutMs) {
        throw new DriverError(
          `timeout after ${timeoutMs} ms waiting for ${describeSelector(selector)}; ` +
            `last UI dump: ${lastDumpPath} (screenshot with .screenshot() for the same moment)`,
          { selector: describeSelector(selector), dump: lastDumpPath },
        );
      }
      await pollDelay();
    }
  }

  async tapNode(node) {
    const center = node.center ?? nodeCenter(node.bounds);
    if (!center) throw new DriverError(`node has no bounds to tap: ${JSON.stringify(node)}`);
    await this.exec(['shell', 'input', 'tap', String(center.x), String(center.y)]);
  }

  async tapSelector(selector, options = {}) {
    const node = await this.waitFor(selector, options);
    await this.tapNode(node);
    return node;
  }
}

async function pollDelay() {
  await new Promise((resolve) => {
    setTimeout(resolve, POLL_INTERVAL_MS);
  });
}
