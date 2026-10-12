// G23.03 (issue #661) — the one command behind `npm run e2e:android`: a
// smoke suite that proves the app starts and navigates on an Android
// emulator. Nothing here restates another tool's internals: the fixture
// catalog is built and served by the existing G23.01 tool
// (tools/e2e-origin/serve-e2e-origin.mjs) spawned verbatim, the JS bundle is
// served by the documented dev path (`expo start --dev-client`) and every
// device touch goes through the G23.03 driver (tools/e2e-android/driver.mjs)
// — the wiring is composed, not copied (implementation-rules 2/3).
//
//   npm run e2e:android                            # smoke: phases A + B
//   npm run e2e:android -- --suite locales         # G23.07
//   node tools/e2e-android/run-e2e.mjs --serial emulator-5558
//   node tools/e2e-android/run-e2e.mjs --apk <path> --metro-port 8083
//
// Environment: KUDY_E2E_SERIAL picks the emulator on a shared host (the
// runner never spawns or kills an emulator); KUDY_E2E_APK overrides the
// dev-client APK; KUDY_E2E_SKIP_INSTALL=1 reuses the installed app. Without
// adb, a booted emulator or an APK the suite skips visibly with the reason
// and never reports a pass (criterion 5).
//
// Phases: A — no catalog origin (the honest unavailable states, criterion
// 3); B — the G23.01 origin (the fixture guide card, criterion 4). The
// origin env is baked into the JS bundle by Metro, so each phase runs its
// own Metro lifecycle. Every case starts from a force-stopped cold start so
// cases stay independent; the unknown-deep-link case alone reuses the
// running app, because "Back returns to Explore" needs Explore in the back
// stack.
import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { DriverError, E2eDriver, findNode, listBootedDevices, parseDump, resolveAdb } from './driver.mjs';
import { runLocalesSuite } from './locales.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ORIGIN_TOOL = path.join(REPO_ROOT, 'tools', 'e2e-origin', 'serve-e2e-origin.mjs');
const ARTIFACTS_ROOT = path.join(REPO_ROOT, 'tools', 'e2e-android', 'artifacts');
const DEFAULT_APK = path.join(REPO_ROOT, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
const METRO_READY_TIMEOUT_MS = 120000;
const METRO_START_RETRIES = 2;
const SERVER_READY_TIMEOUT_MS = 60000;
const FIRST_BUNDLE_TIMEOUT_MS = 420000;
const BUNDLE_TIMEOUT_MS = 180000;
const CASE_TIMEOUT_MS = 30000;
const APP_JSON = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'app.json'), 'utf8'));
const APP_PACKAGE = APP_JSON.expo.android.package;
const FIXTURE_GUIDE_ROUTE_ID = 'e2e-free-guide';

const require = createRequire(import.meta.url);
const EXPO_CLI = require.resolve('expo/bin/cli');

const sleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

// ---------- reporting ----------

let passCount = 0;
let failCount = 0;

const pass = (name) => {
  passCount += 1;
  console.log(`PASS ${name}`);
};

const fail = (name, message) => {
  failCount += 1;
  const lines = message.split(/\r?\n/);
  console.log(`FAIL ${name} — ${lines[0]}`);
  for (const line of lines.slice(1)) console.log(`     ${line}`);
};

const info = (message) => console.log(`-- ${message}`);

// ---------- prerequisite resolution (suite-level skip) ----------

async function resolveTarget({ serial, apk }) {
  const adbPath = resolveAdb();
  if (adbPath === null) return { skip: 'adb not found (set KUDY_ADB or ANDROID_HOME, or install platform-tools)' };

  const devices = await listBootedDevices(adbPath);
  const emulators = devices.filter((name) => /^emulator-\d+$/.test(name));
  let chosen = serial ?? process.env.KUDY_E2E_SERIAL ?? null;
  if (chosen === null) {
    if (emulators.length === 0) {
      return {
        skip: `no booted emulator found (boot one and optionally set KUDY_E2E_SERIAL); adb devices: [${devices.join(', ') || 'none'}]`,
      };
    }
    if (emulators.length > 1) {
      return { skip: `several emulators are booted ([${emulators.join(', ')}]) — set KUDY_E2E_SERIAL to pick one` };
    }
    chosen = emulators[0];
  } else if (!devices.includes(chosen)) {
    return { skip: `serial ${chosen} is not a booted device; adb devices: [${devices.join(', ') || 'none'}]` };
  }

  const apkPath = apk ?? process.env.KUDY_E2E_APK ?? DEFAULT_APK;
  const skipInstall = process.env.KUDY_E2E_SKIP_INSTALL === '1';
  if (!skipInstall && !fs.existsSync(apkPath)) {
    return {
      skip:
        `dev-client APK not found: ${apkPath} (build it with the G21.36 tool, point ` +
        `KUDY_E2E_APK at one, or set KUDY_E2E_SKIP_INSTALL=1 to reuse the installed app)`,
    };
  }
  return { adbPath, serial: chosen, apkPath, skipInstall };
}

// ---------- child process lifecycle ----------

function pollHttpOk(url, timeoutMs) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const request = http.get(url, { timeout: 2000 }, (response) => {
        response.resume();
        if (response.statusCode === 200) {
          resolve();
          return;
        }
        retry();
      });
      request.on('error', retry);
      request.on('timeout', () => {
        request.destroy();
        retry();
      });
    };
    const retry = () => {
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new DriverError(`timeout after ${timeoutMs} ms waiting for ${url} to answer 200`));
        return;
      }
      setTimeout(attempt, 500).unref();
    };
    attempt();
  });
}

// Metro and the origin server run in their own process groups and are
// stopped by group id — the listening PID's whole tree, per
// implementation-rules 11 (never shell job pids). Windows uses the same
// owned-PID tree cleanup as tools/android-build/emulator-scenarios.ps1.
function startGroupProcess(command, args, { cwd, env, logPath }) {
  const log = fs.openSync(logPath, 'a');
  fs.appendFileSync(log, `$ ${command} ${args.join(' ')}\n`);
  const child = spawn(command, args, {
    cwd,
    env,
    detached: true,
    windowsHide: true,
    stdio: ['ignore', log, log],
  });
  fs.closeSync(log);
  return child;
}

export async function stopGroupProcess(child, port, label) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    const exited = new Promise((resolve) => child.once('exit', resolve));
    execFileSync('taskkill.exe', ['/T', '/F', '/PID', String(child.pid)], { encoding: 'utf8' });
    await exited;
    await waitForPortClosed(port, 10000);
    return;
  }
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch (error) {
    fs.appendFileSync(path.join(ARTIFACTS_ROOT, 'runner.log'), `${label} stop: ${error.message}\n`);
  }
  await sleep(1000);
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    // The group is already gone — that is the desired end state.
  }
  await waitForPortClosed(port, 10000);
}

function waitForPortClosed(port, timeoutMs) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const request = http.get({ host: '127.0.0.1', port, path: '/', timeout: 500 }, (response) => {
        response.resume();
        retry();
      });
      request.on('error', () => {
        resolve();
      });
      request.on('timeout', () => {
        request.destroy();
        retry();
      });
    };
    const retry = () => {
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new DriverError(`port ${port} is still listening after cleanup`));
        return;
      }
      setTimeout(attempt, 300).unref();
    };
    attempt();
  });
}

async function startMetro({ port, env, logPath }) {
  for (let attempt = 1; attempt <= METRO_START_RETRIES; attempt += 1) {
    const child = startGroupProcess(
      process.execPath,
      [EXPO_CLI, 'start', '--dev-client', '--port', String(port), '--max-workers', '2'],
      {
        cwd: REPO_ROOT,
        env: { ...process.env, CI: '1', EXPO_NO_TELEMETRY: '1', ...env },
        logPath,
      },
    );
    const exited = new Promise((resolve) => {
      child.on('close', (code) => {
        resolve(`Metro exited early with code ${code} (log: ${logPath})`);
      });
    });
    const ready = pollHttpOk(`http://127.0.0.1:${port}/status`, METRO_READY_TIMEOUT_MS).then(() => null);
    const outcome = await Promise.race([ready, exited]);
    if (outcome === null) return child;
    await stopGroupProcess(child, port, 'metro');
    if (attempt === METRO_START_RETRIES) throw new DriverError(`${outcome} — after ${METRO_START_RETRIES} attempts`);
    info(`Metro start attempt ${attempt} failed (${outcome}); retrying once`);
  }
  throw new DriverError('Metro start: unreachable state');
}

async function startOriginServer({ port, logPath, outDir }) {
  const child = startGroupProcess(process.execPath, [ORIGIN_TOOL, '--port', String(port), ...(outDir ? ['--out', outDir] : [])], {
    cwd: REPO_ROOT,
    env: { ...process.env, EXPO_NO_TELEMETRY: '1' },
    logPath,
  });
  try {
    await pollHttpOk(`http://127.0.0.1:${port}/catalog.json`, SERVER_READY_TIMEOUT_MS);
    return child;
  } catch (error) {
    await stopGroupProcess(child, port, 'origin');
    throw new DriverError(`${error.message} (origin log: ${logPath})`);
  }
}

// ---------- case plumbing ----------

const devClientUrl = (metroPort) =>
  `kudy://expo-development-client/?url=${encodeURIComponent(`http://localhost:${metroPort}`)}`;

async function coldStart(driver, url, { timeoutMs, caseSlug }) {
  await driver.forceStop(APP_PACKAGE);
  await driver.launchDeepLink(url);
  // Condition wait over fresh dumps. The dev client's one-time onboarding
  // sheet ("This is the developer menu … Continue") is its own focused
  // window and hides the app's tree, so while it is up the wait presses
  // Back to dismiss it; "Continue" is the sheet's own button caption.
  const startedAt = Date.now();
  for (;;) {
    const dump = await driver.dump(`dump-${caseSlug}.xml`);
    const nodes = parseDump(dump.xml);
    if (findNode(nodes, { testID: 'screen-Explore' })) return;
    if (findNode(nodes, { text: 'Continue' })) await driver.back();
    if (Date.now() - startedAt >= timeoutMs) {
      throw new DriverError(
        `timeout after ${timeoutMs} ms waiting for screen-Explore on cold start; last UI dump: ${dump.localPath}`,
      );
    }
    await sleep(500);
  }
}

async function saveArtifacts(driver, caseSlug) {
  const dir = path.join(driver.artifactsDir, caseSlug);
  fs.mkdirSync(dir, { recursive: true });
  const dumpPath = driver.artifactPath('last-wait-dump.xml');
  if (fs.existsSync(dumpPath)) fs.copyFileSync(dumpPath, path.join(dir, 'final-dump.xml'));
  const shot = await driver.screenshot('failure.png');
  fs.renameSync(shot, path.join(dir, 'failure.png'));
  return dir;
}

async function runCase(name, caseSlug, driver, fn) {
  info(name);
  try {
    await fn();
    pass(name);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      const dir = await saveArtifacts(driver, caseSlug);
      fail(name, `${message}\nartifacts: ${dir}`);
    } catch (artifactError) {
      fail(name, `${message}\n(artifact capture failed: ${artifactError.message})`);
    }
  }
}

async function backToExplore(driver, caseSlug) {
  await driver.back();
  await driver.waitFor({ testID: 'screen-Explore' }, { timeoutMs: CASE_TIMEOUT_MS, dumpBasename: `dump-${caseSlug}.xml` });
}

// ---------- smoke phases ----------

async function phaseA(driver, metroPort) {
  const url = devClientUrl(metroPort);

  await runCase('cold start reaches Explore', 'cold-start', driver, () =>
    coldStart(driver, url, { timeoutMs: FIRST_BUNDLE_TIMEOUT_MS, caseSlug: 'cold-start' }),
  );

  for (const [name, slug, linkId, screenId] of [
    ['Nearby opens and Back returns to Explore', 'tab-nearby', 'link-nearby', 'screen-Map'],
    ['What-to-do opens and Back returns to Explore', 'tab-discovery', 'link-discovery', 'screen-Discovery'],
    ['KUDY opens and Back returns to Explore', 'tab-kudy', 'link-kudy', 'screen-KUDY'],
  ]) {
    await runCase(name, slug, driver, async () => {
      await coldStart(driver, url, { timeoutMs: BUNDLE_TIMEOUT_MS, caseSlug: slug });
      await driver.tapSelector({ testID: linkId }, { timeoutMs: CASE_TIMEOUT_MS, dumpBasename: `dump-${slug}-link.xml` });
      await driver.waitFor({ testID: screenId }, { timeoutMs: CASE_TIMEOUT_MS, dumpBasename: `dump-${slug}.xml` });
      await backToExplore(driver, slug);
    });
  }

  await runCase('unknown deep link shows not-found and Back returns to Explore', 'not-found', driver, async () => {
    await coldStart(driver, url, { timeoutMs: BUNDLE_TIMEOUT_MS, caseSlug: 'not-found' });
    await driver.launchDeepLink('kudy://e2e-no-such-screen');
    await driver.waitFor(
      { testID: 'screen-Not found' },
      { timeoutMs: CASE_TIMEOUT_MS, dumpBasename: 'dump-not-found.xml' },
    );
    await backToExplore(driver, 'not-found');
  });

  for (const [name, slug, link, screenId, markerId] of [
    ['guide route shows its unavailable state', 'unavailable-route', 'kudy://route/e2e-missing', 'screen-Route preview', 'route-unavailable'],
    ['run shows its unavailable state', 'unavailable-run', 'kudy://run/e2e-missing', 'screen-Run', 'run-unavailable'],
    ['place shows its unavailable state', 'unavailable-place', 'kudy://place/e2e-missing', 'screen-Place detail', 'place-unavailable'],
    ['collection shows its unavailable state', 'unavailable-collection', 'kudy://collection/e2e-missing', 'screen-Collection', 'city-message'],
    ['city guides shows its unavailable state', 'unavailable-guides', 'kudy://city/e2e-city/guides', 'screen-Guides', 'city-message'],
  ]) {
    await runCase(name, slug, driver, async () => {
      // Cold-start the dev client first, then fire the route link at the
      // running app: a cold deep link straight into a route is intercepted
      // by the dev client's launcher (the bundle is not selected yet), so
      // the honest unavailable state is reached warm — the way a link
      // arrives while the user has the app open.
      await coldStart(driver, url, { timeoutMs: BUNDLE_TIMEOUT_MS, caseSlug: slug });
      await driver.launchDeepLink(link);
      await driver.waitFor({ testID: screenId }, { timeoutMs: CASE_TIMEOUT_MS, dumpBasename: `dump-${slug}.xml` });
      await driver.waitFor({ testID: markerId }, { timeoutMs: CASE_TIMEOUT_MS, dumpBasename: `dump-${slug}-marker.xml` });
    });
  }
}

async function phaseB(driver, metroPort) {
  const url = devClientUrl(metroPort);
  await runCase(
    'with the G23.01 origin the catalog loads and the fixture guide card is visible',
    'origin-catalog',
    driver,
    async () => {
      await coldStart(driver, url, { timeoutMs: FIRST_BUNDLE_TIMEOUT_MS, caseSlug: 'origin-catalog' });
      await driver.waitFor(
        { testID: `guide-card-${FIXTURE_GUIDE_ROUTE_ID}` },
        { timeoutMs: CASE_TIMEOUT_MS, dumpBasename: 'dump-origin-guide-card.xml' },
      );
    },
  );
}

// ---------- main ----------

async function main() {
  const argv = process.argv.slice(2);
  const argValue = (flag) => {
    const index = argv.indexOf(flag);
    return index === -1 ? null : argv[index + 1];
  };
  const suite = argValue('--suite') ?? 'smoke';
  if (!['smoke', 'locales'].includes(suite)) {
    console.error(`unknown suite: ${suite} (known suites: smoke, locales)`);
    process.exit(2);
  }
  const metroPort = Number(argValue('--metro-port') ?? 8083);
  const originPort = Number(argValue('--origin-port') ?? 8792);

  const runId = new Date().toISOString().replaceAll(/[:.]/g, '-');
  const runDir = path.join(ARTIFACTS_ROOT, runId);
  fs.mkdirSync(runDir, { recursive: true });

  const target = await resolveTarget({ serial: argValue('--serial'), apk: argValue('--apk') });
  if (target.skip !== undefined) {
    console.log(`SKIP e2e:android ${suite} — ${target.skip}`);
    process.exit(0);
  }
  const { adbPath, serial, apkPath, skipInstall } = target;
  info(`adb: ${adbPath}; serial: ${serial}; apk: ${apkPath}${skipInstall ? ' (install skipped)' : ''}`);

  const driver = new E2eDriver({ adbPath, serial, artifactsDir: runDir, pkg: APP_PACKAGE });

  if (!skipInstall) {
    info(`installing ${APP_PACKAGE} from ${apkPath} …`);
    await driver.install(apkPath);
  } else if (!(await driver.isPackageInstalled(APP_PACKAGE))) {
    console.log(`SKIP e2e:android ${suite} — ${APP_PACKAGE} is not installed on ${serial} and KUDY_E2E_SKIP_INSTALL=1 was set`);
    process.exit(0);
  }
  if (fs.existsSync(apkPath)) {
    const sha = crypto.createHash('sha256').update(fs.readFileSync(apkPath)).digest('hex');
    info(`APK SHA-256: ${sha}`);
  }

  let metro = null;
  let origin = null;
  try {
    if (suite === 'locales') {
      origin = await startOriginServer({ port: originPort, logPath: path.join(runDir, 'origin-locales.log'), outDir: path.join(runDir, 'origin') });
      metro = await startMetro({ port: metroPort,
        env: { EXPO_PUBLIC_CATALOG_ORIGIN: `http://10.0.2.2:${originPort}` }, logPath: path.join(runDir, 'metro-locales.log') });
      await driver.exec(['reverse', `tcp:${metroPort}`, `tcp:${metroPort}`]);
      await runLocalesSuite({ driver, url: devClientUrl(metroPort), runCase, coldStart });
    } else {
      info('phase A: no catalog origin — starting Metro');
      metro = await startMetro({ port: metroPort, env: {}, logPath: path.join(runDir, 'metro-a.log') });
      await driver.exec(['reverse', '--remove', `tcp:${metroPort}`]).catch((error) => {
        fs.appendFileSync(path.join(runDir, 'runner.log'), `reverse remove: ${error.message}\n`);
      });
      await driver.exec(['reverse', `tcp:${metroPort}`, `tcp:${metroPort}`]);
      await phaseA(driver, metroPort);

      info('phase B: G23.01 origin — starting origin and Metro with EXPO_PUBLIC_CATALOG_ORIGIN');
      origin = await startOriginServer({ port: originPort, logPath: path.join(runDir, 'origin-b.log') });
      await stopGroupProcess(metro, metroPort, 'metro-a');
      metro = await startMetro({
        port: metroPort,
        env: { EXPO_PUBLIC_CATALOG_ORIGIN: `http://10.0.2.2:${originPort}` },
        logPath: path.join(runDir, 'metro-b.log'),
      });
      await driver.exec(['reverse', `tcp:${metroPort}`, `tcp:${metroPort}`]);
      await phaseB(driver, metroPort);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failCount += 1;
    console.log(`FAIL suite infrastructure — ${message.split(/\r?\n/)[0]}`);
  } finally {
    const cleanup = await Promise.allSettled([
      metro === null ? Promise.resolve() : stopGroupProcess(metro, metroPort, 'metro'),
      origin === null ? Promise.resolve() : stopGroupProcess(origin, originPort, 'origin'),
    ]);
    for (const result of cleanup) {
      if (result.status === 'rejected') fail('suite cleanup', String(result.reason));
    }
    await driver.exec(['reverse', '--remove', `tcp:${metroPort}`]).catch((error) => {
      fs.appendFileSync(path.join(runDir, 'runner.log'), `reverse remove: ${error.message}\n`);
    });
  }

  console.log(`\n${suite}: ${passCount} passed, ${failCount} failed (artifacts: ${runDir})`);
  process.exit(failCount > 0 ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
