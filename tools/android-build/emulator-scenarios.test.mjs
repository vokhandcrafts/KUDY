// G21.36 (#592), review findings [key: emulator-port-ownership] and
// [key: scenario-failure-exit-zero]: the scenario driver refuses busy
// emulator/Metro ports before it starts anything, acts on a port only while
// its listener belongs to a process it started, and exits non-zero unless
// every expected check ran and passed. Windows PowerShell only.
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

function runScenarios(t, ports) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'g2136-emu-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  // The SDK has no emulator or adb: a run that got past the port check would
  // fail differently, and nothing can be started.
  const result = powershell(['-File', script, '-BuildRoot', base, '-Sdk', path.join(base, 'no-sdk'),
    '-AvdHome', path.join(base, 'avd'), '-AndroidUserHome', path.join(base, 'user'), '-Avd', 'NONE',
    '-Apk', path.join(base, 'missing.apk'), '-EmuPort', String(ports.emu), '-MetroPort', String(ports.metro)]);
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
