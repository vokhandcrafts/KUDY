import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { parseDump } from './driver.mjs';
import { checkAction, checkSelection, messageFor, withLargeFont } from './locales.mjs';
import { stopGroupProcess } from './run-e2e.mjs';

const fixture = fs.readFileSync(new URL('./fixtures/dump-explore.xml', import.meta.url), 'utf8');
const root = '<node resource-id="screen-KUDY" bounds="[0,24][400,800]"/>';
const chip = (code, selected) => `<node resource-id="btn-ui-locale-${code}" selected="${selected}" enabled="true" clickable="true" bounds="[20,50][120,100]"/>`;

test('action checks use the same parsed nodes as live waits', () => {
  const nodes = parseDump(fixture);
  const action = nodes.find((node) => node.resourceId === 'link-nearby');
  assert.equal(checkAction(nodes, 'screen-Explore', 'link-nearby', action.contentDesc), action);
});

for (const [name, patch, reason] of [
  ['missing localized label', { contentDesc: '' }, /content-desc/],
  ['wrong language', { contentDesc: 'wrong-locale' }, /content-desc/],
  ['disabled button', { enabled: false }, /enabled/],
  ['unclickable button', { clickable: false }, /clickable/],
  ['offscreen button', { bounds: '[2000,2000][2100,2100]' }, /bounds/],
  ['clipped button', { bounds: '[1000,750][1500,850]' }, /bounds/],
  ['malformed bounds', { bounds: 'invalid' }, /bounds/],
]) {
  test(`action checks reject ${name}`, () => {
    const nodes = parseDump(fixture);
    const action = nodes.find((node) => node.resourceId === 'link-nearby');
    const label = action.contentDesc;
    Object.assign(action, patch);
    assert.throws(() => checkAction(nodes, 'screen-Explore', 'link-nearby', label), reason);
  });
}

test('missing action fails with its selector', () => {
  assert.throws(() => checkAction(parseDump(fixture), 'screen-Explore', 'absent', 'label'), /absent/);
});

test('selection checks reject lost persistence and multiple selected chips', () => {
  const nodes = parseDump(root + chip('be', true) + chip('en', false));
  assert.throws(() => checkSelection(nodes, 'en'), /selected locale.*en/);
  assert.equal(checkSelection(nodes, 'be').resourceId, 'btn-ui-locale-be');
  nodes[2].selected = true;
  assert.throws(() => checkSelection(nodes, 'en'), /selected locale/);
});

test('font scale is restored when a real assertion fails', async () => {
  let scale = '1.2';
  const driver = { exec: async (args) => {
    if (args[2] === 'get') return { stdout: scale };
    scale = args[5];
    return { stdout: '' };
  } };
  await assert.rejects(withLargeFont(driver, async () => {
    assert.equal(scale, '1.5');
    checkSelection(parseDump(root + chip('be', true)), 'en');
  }), /selected locale/);
  assert.equal(scale, '1.2');
});

test('unset font scale is deleted after the suite', async () => {
  const commands = [];
  const driver = { exec: async (args) => {
    commands.push(args);
    return { stdout: args[2] === 'get' ? 'null\n' : '' };
  } };
  await withLargeFont(driver, async () => {});
  assert.deepEqual(commands.at(-1), ['shell', 'settings', 'delete', 'system', 'font_scale']);
});

test('corrupt font settings fail before a device write', async () => {
  let calls = 0;
  await assert.rejects(withLargeFont({ exec: async () => {
    calls += 1;
    return { stdout: 'bad input' };
  } }, async () => {}), /font_scale/);
  assert.equal(calls, 1);
});

test('expected UI labels come from the shipped source and translation files', () => {
  const source = JSON.parse(fs.readFileSync(new URL('../../contracts/ui-messages/source.json', import.meta.url), 'utf8'));
  const translation = JSON.parse(fs.readFileSync(new URL('../../contracts/ui-messages/translations/en.json', import.meta.url), 'utf8'));
  const id = 'native.chrome.nearby';
  assert.equal(messageFor('be', id), source.records.find((record) => record.id === id).source);
  assert.equal(messageFor('en', id), translation.records.find((record) => record.id === id).value);
  assert.throws(() => messageFor('../outside', id), /unknown UI locale/);
  assert.throws(() => messageFor('en', 'absent'), /missing plain message/);
});

test('the public locales command reaches prerequisite resolution instead of rejecting the suite', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./run-e2e.mjs', import.meta.url)), '--suite', 'locales', '--serial', 'emulator-missing'], {
    encoding: 'utf8', env: { ...process.env, KUDY_ADB: '', ANDROID_HOME: '' }, timeout: 15000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /SKIP e2e:android locales/);
  assert.doesNotMatch(result.stdout, /PASS /);
});

test('the locales command skips a physical serial before clearing app data', { skip: process.platform === 'win32' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kudy-adb-'));
  const adb = path.join(dir, 'adb');
  const touched = path.join(dir, 'touched');
  fs.writeFileSync(adb, `#!/bin/sh\nif [ "$1" = devices ]; then printf 'List of devices attached\\nphysical-serial\\tdevice\\n'; else touch '${touched}'; fi\n`, { mode: 0o755 });
  try {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./run-e2e.mjs', import.meta.url)), '--suite', 'locales', '--serial', 'physical-serial'], {
      encoding: 'utf8', env: { ...process.env, KUDY_ADB: adb, KUDY_E2E_SKIP_INSTALL: '1' }, timeout: 15000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /SKIP e2e:android locales — serial physical-serial is not an emulator/);
    assert.equal(fs.existsSync(touched), false, 'a physical device received a mutation command');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('runner cleanup stops the process it started on this platform', { timeout: 20000 }, async () => {
  const child = spawn(process.execPath, ['-e', "require('node:http').createServer((q,r)=>r.end('ok')).listen(0,'127.0.0.1',function(){console.log(this.address().port)})"], { detached: true, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(child, 'exit');
  const [data] = await once(child.stdout, 'data');
  try {
    await stopGroupProcess(child, Number(data.toString().trim()), 'test-child');
    assert.notEqual(child.exitCode ?? child.signalCode, null, 'owned server process is still alive');
  } finally {
    child.kill('SIGKILL');
    await exited;
  }
});
