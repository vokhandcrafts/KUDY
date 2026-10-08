#!/usr/bin/env node
// G21.36 (#592): reproducible Android debug build on a Windows host from the
// published checkout. Procedure and parameters: docs/development_setup.md.
//
//   node tools/android-build/android-build.mjs <preflight|clean|build|stop-owned> --build-root <abs dir> [options]
//
// Every writable path (Gradle home, temp, logs, records) lives under the
// explicit --build-root; JDK/SDK paths are set for the child process only.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { applyCleanup, findCandidates, gitOwnership, planCleanup, resolveRoots } from './scoped-clean.mjs';
import { acquireLock, lockPath } from './checkout-lock.mjs';
import { buildEnv, classifyProcesses, gradleArgs, gradleUserProperties, resolveOptions, taskPaths } from './build-config.mjs';

const checkoutRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const isWindows = process.platform === 'win32';

function listProcesses() {
  if (isWindows) {
    const json = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      'Get-CimInstance Win32_Process | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    return JSON.parse(json).map((p) => ({ pid: p.ProcessId, name: p.Name, commandLine: p.CommandLine }));
  }
  return execFileSync('ps', ['-eo', 'pid=,comm=,args='], { encoding: 'utf8' })
    .split('\n').filter(Boolean)
    .map((line) => line.trim().match(/^(\d+)\s+(\S+)\s+(.*)$/))
    .filter(Boolean)
    .map(([, pid, name, commandLine]) => ({ pid: Number(pid), name: path.basename(name), commandLine }));
}

const short = (proc) => `${proc.pid} ${proc.name} ${proc.commandLine.slice(0, 240)}`;

function processReport(options) {
  return classifyProcesses(listProcesses(), { buildRoot: options.buildRoot, checkoutRoot, selfPid: process.pid });
}

function readProperty(file, key) {
  try {
    const line = fs.readFileSync(file, 'utf8').split(/\r?\n/).find((l) => l.startsWith(`${key}=`));
    return line ? line.slice(key.length + 1).replace(/^"|"$/g, '') : null;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

const listDir = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []);
const pkgVersion = (name) => readJsonVersion(path.join(checkoutRoot, 'node_modules', name, 'package.json'));
function readJsonVersion(file) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).version : null;
}

function versions(options) {
  const javaExe = path.join(options.jdk, 'bin', isWindows ? 'java.exe' : 'java');
  const javaRun = spawnSync(javaExe, ['-version'], { encoding: 'utf8' });
  const npmRun = isWindows
    ? spawnSync('cmd.exe', ['/d', '/c', 'npm', '-v'], { encoding: 'utf8' })
    : spawnSync('npm', ['-v'], { encoding: 'utf8' });
  return {
    host: `${process.platform} ${(isWindows ? execFileSync('cmd.exe', ['/d', '/c', 'ver'], { encoding: 'utf8' }) : '').trim()}`,
    node: process.version,
    npm: (npmRun.stdout || '').trim() || null,
    jdkRelease: readProperty(path.join(options.jdk, 'release'), 'JAVA_VERSION'),
    javaVersion: javaRun.error ? `unavailable: ${javaRun.error.message}` : (javaRun.stderr || '').split(/\r?\n/)[0],
    gradleWrapper: readProperty(path.join(checkoutRoot, 'android', 'gradle', 'wrapper', 'gradle-wrapper.properties'), 'distributionUrl'),
    sdkPlatformTools: readProperty(path.join(options.sdk, 'platform-tools', 'source.properties'), 'Pkg.Revision'),
    sdkEmulator: readProperty(path.join(options.sdk, 'emulator', 'source.properties'), 'Pkg.Revision'),
    sdkPlatforms: listDir(path.join(options.sdk, 'platforms')),
    sdkBuildTools: listDir(path.join(options.sdk, 'build-tools')),
    sdkNdk: listDir(path.join(options.sdk, 'ndk')),
    sdkCmake: listDir(path.join(options.sdk, 'cmake')),
    reactNative: pkgVersion('react-native'),
    expo: pkgVersion('expo'),
    expoDevLauncher: pkgVersion('expo-dev-launcher'),
    expoModulesCore: pkgVersion('expo-modules-core'),
  };
}

function prerequisiteErrors(options, info) {
  const errors = [];
  if (!info.jdkRelease || !info.jdkRelease.startsWith('17')) {
    errors.push(`JDK at ${options.jdk} reports JAVA_VERSION=${info.jdkRelease}; React Native 0.81 builds here with JDK 17`);
  }
  if (!fs.existsSync(path.join(options.sdk, 'platform-tools', isWindows ? 'adb.exe' : 'adb'))) {
    errors.push(`Android SDK at ${options.sdk} has no platform-tools/adb`);
  }
  if (!fs.existsSync(path.join(checkoutRoot, 'android', isWindows ? 'gradlew.bat' : 'gradlew'))) {
    errors.push('android/ is missing: run `npx expo prebuild --platform android --no-install` first');
  }
  return errors;
}

function blockingProcesses(report) {
  const lines = [];
  for (const proc of report.owned) lines.push(`task-owned leftover (stop with stop-owned): ${short(proc)}`);
  for (const proc of report.foreign) lines.push(`build process of another session in this checkout (not stopped): ${short(proc)}`);
  return lines;
}

function preflight(options) {
  const info = versions(options);
  const errors = prerequisiteErrors(options, info);
  const report = processReport(options);
  errors.push(...blockingProcesses(report));
  console.log(JSON.stringify({ checkoutRoot, buildRoot: options.buildRoot, paths: taskPaths(options.buildRoot), versions: info }, null, 2));
  for (const error of errors) console.error(`preflight: ${error}`);
  return { info, errors };
}

// Exit codes: 0 ok, 1 failure, 2 cleanup target refused, 3 active build
// process, 64 usage, 75 checkout locked by another build/clean.
function clean(options, apply) {
  if (apply) {
    // Deleting outputs under a running build loses its results or breaks it,
    // and unlocked files would go silently; refuse instead of racing it.
    const blockers = blockingProcesses(processReport(options));
    if (blockers.length > 0) {
      for (const line of blockers) console.error(`clean: ${line}`);
      console.error('clean: a build process of this checkout or build root is running; nothing was deleted');
      return 3;
    }
  }
  const plan = planCleanup({
    checkoutRoot, buildRoot: options.buildRoot, candidates: findCandidates(checkoutRoot), ownership: gitOwnership(checkoutRoot),
  });
  for (const item of plan.remove) console.log(`${apply ? 'remove' : 'would remove'} ${item.kind} ${item.path}${item.links.length ? ` (+${item.links.length} nested links)` : ''}`);
  for (const item of plan.refused) console.error(`refused ${item.path}: ${item.reason}`);
  if (plan.refused.length > 0) {
    console.error(`clean: ${plan.refused.length} target(s) refused; nothing was deleted. Resolve them by hand, then rerun.`);
    return 2;
  }
  if (!apply) {
    console.log(`clean: dry run, ${plan.remove.length} target(s) planned; rerun with --apply to delete`);
    return 0;
  }
  const result = applyCleanup(plan);
  for (const item of result.failed) console.error(`failed ${item.path}: ${item.code} ${item.message}`);
  if (result.failed.length > 0) {
    const report = processReport(options);
    for (const line of blockingProcesses(report)) console.error(`possible lock holder: ${line}`);
    return 1;
  }
  console.log(`clean: removed ${result.removed.length} target(s)`);
  return 0;
}

function stopOwned(options) {
  const before = processReport(options);
  for (const proc of before.foreign) console.error(`not stopped (not task-owned): ${short(proc)}`);
  for (const proc of before.owned) {
    console.log(`stopping task-owned ${short(proc)}`);
    try {
      process.kill(proc.pid);
    } catch (error) {
      if (error.code !== 'ESRCH') console.error(`stop failed for ${proc.pid}: ${error.code} ${error.message}`);
    }
  }
  const after = processReport(options);
  for (const proc of after.owned) console.error(`still running: ${short(proc)}`);
  return after.owned.length === 0 ? 0 : 1;
}

const quoteForCmd = (arg) => (/[\s]/.test(arg) ? `"${arg}"` : arg);

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
}

function git(args) {
  return execFileSync('git', args, { cwd: checkoutRoot, encoding: 'utf8' }).trim();
}

async function build(options) {
  const { info, errors } = preflight(options);
  if (errors.length > 0) return 1;
  const paths = taskPaths(options.buildRoot);
  for (const dir of Object.values(paths)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(paths.gradleHome, 'gradle.properties'), gradleUserProperties(options));

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logFile = path.join(paths.logs, `assembleDebug-${stamp}.log`);
  const args = gradleArgs(options);
  const wrapper = isWindows ? 'gradlew.bat' : './gradlew';
  const command = `${wrapper} ${args.map(quoteForCmd).join(' ')}`;
  console.log(`build: cwd=${path.join(checkoutRoot, 'android')} command=${command} log=${logFile}`);

  const log = fs.createWriteStream(logFile);
  const started = Date.now();
  const child = spawn(isWindows ? command : wrapper, isWindows ? [] : args, {
    cwd: path.join(checkoutRoot, 'android'), env: buildEnv(options, process.env), shell: isWindows,
  });
  child.stdout.on('data', (chunk) => { log.write(chunk); process.stdout.write(chunk); });
  child.stderr.on('data', (chunk) => { log.write(chunk); process.stderr.write(chunk); });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    console.error(`build: timeout after ${options.timeoutMinutes} min, stopping the build process tree ${child.pid}`);
    if (isWindows) spawnSync('taskkill.exe', ['/T', '/F', '/PID', String(child.pid)], { stdio: 'inherit' });
    else child.kill('SIGTERM');
  }, options.timeoutMinutes * 60_000);
  const exitCode = await new Promise((resolve) => child.on('close', (code) => resolve(code ?? 1)));
  clearTimeout(timer);
  await new Promise((resolve) => log.end(resolve));

  const apkPath = path.join(checkoutRoot, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
  const apk = exitCode === 0 && fs.existsSync(apkPath)
    ? { path: apkPath, bytes: fs.statSync(apkPath).size, sha256: sha256(apkPath) }
    : null;
  const leftovers = processReport(options).owned.map(short);
  const record = {
    command, cwd: path.join(checkoutRoot, 'android'), log: logFile,
    startedAt: new Date(started).toISOString(), durationSeconds: Math.round((Date.now() - started) / 1000),
    exitCode, timedOut, gitHead: git(['rev-parse', 'HEAD']), gitStatus: git(['status', '--short']),
    gradleUserProperties: gradleUserProperties(options), roDepCache: options.roDepCache ?? null,
    versions: info, apk, taskOwnedProcessesAfterBuild: leftovers,
  };
  const recordFile = path.join(paths.records, `assembleDebug-${stamp}.json`);
  fs.writeFileSync(recordFile, `${JSON.stringify(record, null, 2)}\n`);
  console.log(`build: exit=${exitCode} duration=${record.durationSeconds}s record=${recordFile}`);
  if (apk) console.log(`build: apk ${apk.bytes} bytes sha256 ${apk.sha256}`);
  for (const line of leftovers) console.error(`build: task-owned process still running: ${line}`);
  if (exitCode === 0 && !apk) {
    console.error(`build: Gradle exited 0 but ${apkPath} is missing`);
    return 1;
  }
  return exitCode;
}

// Taken before the process checks and held until the operation ends.
async function withCheckoutLock(commandName, operation) {
  const file = lockPath(checkoutRoot);
  const lock = acquireLock(file, commandName);
  if (lock.holder) {
    console.error(`android-build: ${commandName} refused: the checkout is locked by ${JSON.stringify(lock.holder)} (${file})`);
    return 75;
  }
  process.once('exit', lock.release);
  try {
    return await operation();
  } finally {
    lock.release();
  }
}

async function main(argv) {
  const { values, positionals } = parseArgs({
    args: argv, allowPositionals: true,
    options: {
      'build-root': { type: 'string' }, sdk: { type: 'string' }, jdk: { type: 'string' },
      'max-workers': { type: 'string' }, 'gradle-heap': { type: 'string' }, abi: { type: 'string' },
      'timeout-minutes': { type: 'string' }, 'ro-dep-cache': { type: 'string' },
      'rerun-tasks': { type: 'boolean' }, apply: { type: 'boolean' },
    },
  });
  const [commandName] = positionals;
  const resolved = resolveOptions(values, { checkoutRoot, env: process.env });
  if (resolved.errors) {
    for (const error of resolved.errors) console.error(`android-build: ${error}`);
    return 64;
  }
  const { options } = resolved;
  try {
    resolveRoots(options.buildRoot, checkoutRoot);
  } catch (error) {
    console.error(`android-build: ${error.message}`);
    return 64;
  }
  switch (commandName) {
    case 'preflight': return preflight(options).errors.length === 0 ? 0 : 1;
    case 'clean': return values.apply ? withCheckoutLock('clean --apply', () => clean(options, true)) : clean(options, false);
    case 'stop-owned': return stopOwned(options);
    case 'build': return withCheckoutLock('build', () => build(options));
    default:
      console.error('usage: android-build.mjs <preflight|clean|build|stop-owned> --build-root <abs dir> [--sdk <dir>] [--jdk <dir>] [--max-workers 2] [--gradle-heap 3g] [--abi x86_64] [--timeout-minutes 90] [--ro-dep-cache <dir>] [--rerun-tasks] [--apply]');
      return 64;
  }
}

process.exitCode = await main(process.argv.slice(2));
