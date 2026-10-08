// G21.36 (#592), review findings [key: emulator-port-ownership],
// [key: scenario-failure-exit-zero] and [key: stale-ui-dump-on-failure]: the
// scenario driver refuses busy emulator/Metro ports before it starts anything,
// acts on a port only while its listener belongs to a process it started,
// exits non-zero unless every expected check ran and passed, and never
// evaluates a UI dump older than the current attempt. [key: build-output-link-escape]:
// it writes into the build root only through its own directories and files.
// Windows PowerShell only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const skip = process.platform === 'win32' ? false : 'needs Windows PowerShell and Get-NetTCPConnection';
const script = path.join(here, 'emulator-scenarios.ps1');
const guards = path.join(here, 'emulator-guards.ps1');

const powershell = (args) => spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', ...args],
  { encoding: 'utf8', timeout: 120_000 });
const psQuote = (value) => `'${value.replaceAll("'", "''")}'`;

async function listen(t) {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  return server.address().port;
}

// The SDK has no emulator or adb: a run that got past the port check would
// fail differently, and nothing can be started.
const scenarioRun = (base, ports) => powershell(['-File', script, '-BuildRoot', base, '-Sdk', path.join(base, 'no-sdk'),
  '-AvdHome', path.join(base, 'avd'), '-AndroidUserHome', path.join(base, 'user'), '-Avd', 'NONE',
  '-Apk', path.join(base, 'missing.apk'), '-EmuPort', String(ports.emu), '-MetroPort', String(ports.metro)]);

function runScenarios(t, ports) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'g2136-emu-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const result = scenarioRun(base, ports);
  const results = JSON.parse(fs.readFileSync(path.join(base, 'evidence', 'android', 'results.json'), 'utf8').replace(/^\uFEFF/, ''));
  return { result, results };
}

test('emulator-scenarios: a busy Metro port is refused before anything starts, exit code 1', { skip }, async (t) => {
  const metro = await listen(t);
  const { result, results } = runScenarios(t, { emu: 5680, metro });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, new RegExp(`port\\(s\\) already in use: ${metro}`));
  assert.doesNotMatch(result.stdout, /emulator pid=|metro pid=/);
  assert.match(results.fatal, /already in use/);
  assert.equal(results.exitCode, 1);
});

test('emulator-scenarios: a busy emulator console or adb port is refused', { skip }, async (t) => {
  const consolePort = await listen(t);
  const first = runScenarios(t, { emu: consolePort, metro: 8099 });
  assert.equal(first.result.status, 1, first.result.stdout + first.result.stderr);
  assert.match(first.result.stdout, new RegExp(`already in use: ${consolePort}\\b`));
  assert.doesNotMatch(first.result.stdout, /emulator pid=/);

  const adbPort = await listen(t);
  const second = runScenarios(t, { emu: adbPort - 1, metro: 8099 });
  assert.equal(second.result.status, 1);
  assert.match(second.result.stdout, new RegExp(`already in use: .*\\b${adbPort}\\b`));
});

function linkFixture(t) {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'g2136-emu-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const foreign = path.join(base, 'foreign');
  fs.mkdirSync(foreign);
  fs.writeFileSync(path.join(foreign, 'results.json'), 'KEEP\n');
  fs.writeFileSync(path.join(foreign, 'emulator.out.log'), 'KEEP\n');
  const root = path.join(base, 'build-root');
  const files = () => Object.fromEntries(fs.readdirSync(foreign).map((name) => [name, fs.readFileSync(path.join(foreign, name), 'utf8')]));
  return { root, foreign, files };
}

function assertRefusedBeforeWriting(result, f, before, reason) {
  assert.equal(result.status, 73, result.stdout + result.stderr);
  assert.match(result.stdout, new RegExp(`REFUSED build output path: own-paths: refused: .*${reason}`));
  assert.doesNotMatch(result.stdout, /== ports|emulator pid=|metro pid=/, 'refused before anything else ran');
  assert.deepEqual(f.files(), before, 'the foreign directory is unchanged');
}

for (const rel of ['tmp', 'logs', 'evidence', 'evidence\\android']) {
  test(`emulator-scenarios: ${rel} as a junction out of the build root is refused before the first write, exit 73`, { skip }, (t) => {
    const f = linkFixture(t);
    fs.mkdirSync(path.dirname(path.join(f.root, rel)), { recursive: true });
    fs.symlinkSync(f.foreign, path.join(f.root, rel), 'junction');
    const before = f.files();
    assertRefusedBeforeWriting(scenarioRun(f.root, { emu: 5680, metro: 8099 }), f, before, 'is a link to');
  });
}

for (const [kind, rel] of [['hard link', 'evidence\\android\\results.json'], ['hard link', 'logs\\emulator.out.log'], ['symlink', 'evidence\\android\\results.json']]) {
  test(`emulator-scenarios: ${rel} as a ${kind} to a foreign file is refused before the first write`, { skip }, (t) => {
    const f = linkFixture(t);
    const own = path.join(f.root, rel);
    fs.mkdirSync(path.dirname(own), { recursive: true });
    const foreignFile = path.join(f.foreign, path.basename(rel));
    try {
      if (kind === 'symlink') fs.symlinkSync(foreignFile, own, 'file');
      else fs.linkSync(foreignFile, own);
    } catch (error) {
      if (error.code === 'EPERM') return t.skip('creating a file symlink needs the symlink privilege on this host');
      throw error;
    }
    const before = f.files();
    assertRefusedBeforeWriting(scenarioRun(f.root, { emu: 5680, metro: 8099 }), f, before, kind === 'symlink' ? 'is a link to' : 'has 2 hard links');
  });
}

test('Write-NewFile: replaces a hard-linked name without changing the other name, and refuses a directory', { skip }, (t) => {
  const f = linkFixture(t);
  fs.mkdirSync(f.root);
  const linked = path.join(f.root, 'results.json');
  fs.linkSync(path.join(f.foreign, 'results.json'), linked);
  const junction = path.join(f.root, 'android-crash.log');
  fs.symlinkSync(f.foreign, junction, 'junction');
  const before = f.files();
  const result = powershell(['-Command', `. ${psQuote(guards)}; Write-NewFile ${psQuote(linked)} @('new', 'lines'); try { Write-NewFile ${psQuote(junction)} @('x'); 'WROTE' } catch { 'THROWN' }`]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /THROWN/);
  assert.equal(fs.readFileSync(linked, 'utf8'), '\uFEFFnew\r\nlines\r\n');
  assert.equal(fs.statSync(linked).nlink, 1);
  assert.deepEqual(f.files(), before, 'the foreign files are unchanged');
});

test('Test-PortOwnedBy: a listener counts as ours only inside the given process tree', { skip }, async (t) => {
  const port = await listen(t);
  const result = powershell(['-Command', `. ${psQuote(guards)}; "$(Test-PortOwnedBy ${port} ${process.pid}) $(Test-PortOwnedBy ${port} $PID) $(Test-PortOwnedBy 1 ${process.pid})"`]);
  assert.equal(result.stdout.trim(), 'True False False', result.stderr);
});

test('Get-ScenarioVerdict: exit 0 only for a complete, all-passed run with an empty crash buffer', { skip }, () => {
  const command = `. ${psQuote(guards)}
$ok = 1..26 | ForEach-Object { [pscustomobject]@{ name = "c$_"; status = 'passed' } }
$failed = @($ok[0..24]) + [pscustomobject]@{ name = 'c26'; status = 'failed' }
@(
  (Get-ScenarioVerdict $null $ok 26 0).exitCode
  (Get-ScenarioVerdict 'boom' $ok 26 0).exitCode
  (Get-ScenarioVerdict $null $failed 26 0).exitCode
  (Get-ScenarioVerdict $null $ok[0..24] 26 0).exitCode
  (Get-ScenarioVerdict $null $ok 26 3).exitCode
  (Get-ScenarioVerdict $null $ok 26 $null).exitCode
  (Get-ScenarioVerdict $null @() 26 0).exitCode
) -join ','`;
  const result = powershell(['-Command', command]);
  assert.equal(result.stdout.trim(), '0,1,1,1,1,1,1', result.stderr);
});

// A fake adb for the UI dump: `uiautomator dump` fails (or succeeds) as the
// mode says, while `pull` of the old fixed path /sdcard/kudy-ui.xml would
// still hand back an earlier screen, as on a device after a failed dump.
const fakeAdbSource = `import fs from 'node:fs';
import path from 'node:path';
const dir = process.env.FAKE_ADB_DIR;
const mode = process.env.FAKE_ADB_MODE;
const args = process.argv.slice(4);
fs.appendFileSync(path.join(dir, 'calls.log'), JSON.stringify(args) + '\\n');
const device = (remote) => path.join(dir, 'device', path.posix.basename(remote));
const screen = (id) => '<?xml version="1.0"?><hierarchy rotation="0"><node resource-id="' + id + '" bounds="[0,0][1,1]"/></hierarchy>';
if (args[0] === 'shell' && args[1] === 'uiautomator') {
  const dumps = fs.readFileSync(path.join(dir, 'calls.log'), 'utf8').split('\\n').filter((l) => l.includes('uiautomator')).length;
  if (mode === 'dump-fails' || (mode === 'fail-once' && dumps === 1)) { console.error('ERROR: could not get idle state.'); process.exit(1); }
  if (mode === 'dump-error-exit-0') { console.log('ERROR: null root node returned by UiTestAutomationBridge.'); process.exit(0); }
  fs.writeFileSync(device(args[3]), screen('fresh-screen'));
  console.log('UI hierchary dumped to: ' + args[3]);
  process.exit(0);
}
if (args[0] === 'pull') {
  const source = fs.existsSync(device(args[1])) ? device(args[1]) : device('/sdcard/kudy-ui.xml');
  fs.copyFileSync(source, args[2]);
  process.exit(0);
}
if (args[0] === 'shell' && args[1] === 'rm') { fs.rmSync(device(args[3]), { force: true }); process.exit(0); }
process.exit(2);
`;

function fakeAdb(t) {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'g2136-adb-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'device'));
  fs.writeFileSync(path.join(dir, 'device', 'kudy-ui.xml'),
    '<?xml version="1.0"?><hierarchy rotation="0"><node resource-id="stale-screen" bounds="[0,0][1,1]"/></hierarchy>');
  fs.writeFileSync(path.join(dir, 'fake-adb.mjs'), fakeAdbSource);
  fs.writeFileSync(path.join(dir, 'adb.cmd'), `@"${process.execPath}" "%~dp0fake-adb.mjs" %*\r\n@exit /b %errorlevel%\r\n`);
  const destination = path.join(dir, 'screen.xml');
  // The previous run's evidence file for the same name: it must not be read either.
  fs.copyFileSync(path.join(dir, 'device', 'kudy-ui.xml'), destination);
  const calls = () => fs.readFileSync(path.join(dir, 'calls.log'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  return { dir, adb: path.join(dir, 'adb.cmd'), destination, calls };
}

function runPs(adb, mode, body) {
  const file = path.join(adb.dir, 'probe.ps1');
  // Same error preference as emulator-scenarios.ps1: a native command's stderr does not throw.
  fs.writeFileSync(file, `\uFEFF$ErrorActionPreference = 'Continue'\n. ${psQuote(guards)}\n$adb = ${psQuote(adb.adb)}\n${body}\n`);
  return spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file],
    { encoding: 'utf8', timeout: 120_000, env: { ...process.env, FAKE_ADB_DIR: adb.dir, FAKE_ADB_MODE: mode } });
}

const dumpProbe = (adb) => `try { $n = Get-UiDump $adb 'emulator-5680' ${psQuote(adb.destination)} -DelaySeconds 0; "RESULT $(@($n | ForEach-Object { $_.'resource-id' }) -join ',')" } catch { "THROWN $_" }`;

for (const mode of ['dump-fails', 'dump-error-exit-0']) {
  test(`Get-UiDump: a failed dump (${mode}) is retried, never pulled, and throws instead of returning the old screen`, { skip }, (t) => {
    const adb = fakeAdb(t);
    const result = runPs(adb, mode, dumpProbe(adb));
    assert.match(result.stdout, /THROWN UI dump .* failed after 3 attempts/, result.stdout + result.stderr);
    assert.doesNotMatch(result.stdout, /stale-screen/);
    const calls = adb.calls();
    assert.equal(calls.filter((c) => c[1] === 'uiautomator').length, 3);
    assert.equal(calls.filter((c) => c[0] === 'pull').length, 0, 'nothing is pulled after a failed dump');
    assert.equal(fs.existsSync(adb.destination), false, 'the previous local dump is removed');
  });
}

test('Get-UiDump: after one failed attempt the next dump is pulled from its own device file and cleaned up', { skip }, (t) => {
  const adb = fakeAdb(t);
  const result = runPs(adb, 'fail-once', dumpProbe(adb));
  assert.match(result.stdout, /^RESULT fresh-screen$/m, result.stdout + result.stderr);
  const calls = adb.calls();
  const dumps = calls.filter((c) => c[1] === 'uiautomator').map((c) => c[3]);
  assert.equal(dumps.length, 2);
  assert.notEqual(dumps[0], dumps[1], 'every attempt dumps to a new device file');
  assert.deepEqual(calls.filter((c) => c[0] === 'pull').map((c) => c[1]), [dumps[1]]);
  assert.deepEqual(calls.filter((c) => c[1] === 'rm').map((c) => c[3]), dumps);
});

// The reviewer's angle: take Dump and WaitFor out of the real script by AST
// and drive them with an adb whose dump always fails.
test('emulator-scenarios: Dump and WaitFor throw on a failed dump instead of evaluating the old screen', { skip }, (t) => {
  const adb = fakeAdb(t);
  const body = `$ast = [Management.Automation.Language.Parser]::ParseFile(${psQuote(script)}, [ref]$null, [ref]$null)
foreach ($fn in $ast.FindAll({ param($a) $a -is [Management.Automation.Language.FunctionDefinitionAst] -and $a.Name -in 'Dump', 'WaitFor' }, $true)) { Invoke-Expression $fn.Extent.Text }
$serial = 'emulator-5680'; $ev = ${psQuote(adb.dir)}
try { $n = Dump 'screen'; "DUMP RESULT $(@($n).Count)" } catch { "DUMP THROWN $_" }
try { $n = WaitFor 'screen' { param($n) $true } 1; "WAIT RESULT $(@($n).Count)" } catch { "WAIT THROWN $_" }`;
  const result = runPs(adb, 'dump-fails', body);
  assert.match(result.stdout, /^DUMP THROWN UI dump .*screen\.xml failed after 3 attempts/m, result.stdout + result.stderr);
  assert.match(result.stdout, /^WAIT THROWN UI dump .*screen\.xml failed after 3 attempts/m);
  assert.equal(adb.calls().filter((c) => c[0] === 'pull').length, 0);
});
