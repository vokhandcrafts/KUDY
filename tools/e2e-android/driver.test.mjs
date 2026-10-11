// G23.03 (issue #661) — driver unit tests over recorded UI-dump XML
// (criterion 6, no device): selector lookup, wait timeout, missing element.
// The waitFor tests override only the adb transport (dump) — the lookup,
// polling and deadline logic are the production path.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { DriverError, E2eDriver, describeSelector, findNode, nodeCenter, parseDump, parseDevicesOutput } from './driver.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const readFixture = (name) => fs.readFileSync(path.join(here, 'fixtures', name), 'utf8');

function testDriver() {
  return new E2eDriver({
    adbPath: 'adb',
    serial: 'emulator-0000',
    artifactsDir: fs.mkdtempSync(path.join(os.tmpdir(), 'kudy-e2e-test-')),
    pkg: 'by.kudy.app',
  });
}

test('parseDump reads the recorded Explore dump: testID nodes with tappable centers', () => {
  const nodes = parseDump(readFixture('dump-explore.xml'));
  const explore = findNode(nodes, { testID: 'screen-Explore' });
  assert.ok(explore, 'screen-Explore node missing from the recorded dump');
  assert.ok(explore.center !== null && explore.center.x > 0 && explore.center.y > 0);
  const nearby = findNode(nodes, { testID: 'link-nearby' });
  assert.ok(nearby, 'link-nearby node missing from the recorded dump');
  assert.equal(nearby.clickable, true);
});

test('selector lookup: exact text, substring, content-desc, missing element', () => {
  const nodes = parseDump(readFixture('dump-not-found.xml'));
  const back = findNode(nodes, { testID: 'btn-not-found-back' });
  assert.ok(back, 'btn-not-found-back node missing from the recorded dump');
  assert.ok(typeof back.text === 'string');

  // The back caption lives on the Pressable and on the inner Text, so the
  // exact-text lookup returns the first match — a node carrying that text,
  // not necessarily the button container (findNode contract: first match).
  const byText = findNode(nodes, { text: back.text });
  assert.ok(byText, 'exact-text lookup must find a node with the caption');
  assert.equal(byText.text, back.text);
  assert.ok(byText.center !== null && byText.center.x > 0);

  assert.equal(findNode(nodes, { testID: 'screen-Missing' }), undefined, 'missing element must resolve to undefined');
  assert.equal(findNode(nodes, {}), undefined, 'an empty selector matches nothing');
});

test('entity decode in attribute values', () => {
  const nodes = parseDump('<node text="a&amp;b &lt;c&gt;" resource-id="x" bounds="[0,0][10,10]"/>');
  assert.equal(nodes[0].text, 'a&b <c>');
});

test('corrupt input yields diagnostics, never a throw', () => {
  assert.deepEqual(parseDump('not xml at all'), []);
  assert.deepEqual(parseDump(null), []);
  assert.deepEqual(parseDump(42), []);
  const truncated = readFixture('dump-explore.xml').slice(0, 400);
  assert.ok(Array.isArray(parseDump(truncated)), 'an unterminated tag must not throw');
});

test('nodeCenter parses uiautomator bounds', () => {
  assert.deepEqual(nodeCenter('[10,20][30,44]'), { x: 20, y: 32 });
  assert.equal(nodeCenter('garbage'), null);
  assert.equal(nodeCenter(undefined), null);
});

test('describeSelector names the selector kind', () => {
  assert.equal(describeSelector({ testID: 'screen-Explore' }), 'testID "screen-Explore"');
  assert.equal(describeSelector({ text: 'Назад' }), 'text "Назад"');
});

test('parseDevicesOutput keeps booted devices only, from recorded adb output', () => {
  assert.deepEqual(parseDevicesOutput(readFixture('adb-devices.txt')), ['emulator-5554', 'emulator-5558']);
  assert.deepEqual(parseDevicesOutput('List of devices attached\n\n'), []);
  assert.deepEqual(
    parseDevicesOutput('emulator-5554\tdevice\nemulator-5560\toffline\nemulator-5561\tunauthorized\n'),
    ['emulator-5554'],
  );
});

test('waitFor resolves through the production lookup on a recorded dump', async () => {
  const driver = testDriver();
  driver.dump = async () => ({ localPath: 'fixture://dump-explore.xml', xml: readFixture('dump-explore.xml') });
  const node = await driver.waitFor({ testID: 'screen-Explore' }, { timeoutMs: 5000 });
  assert.ok(node.center.x > 0);
});

test('waitFor times out readably on a missing element: selector, deadline, dump path', async () => {
  const driver = testDriver();
  driver.dump = async () => ({
    localPath: '/tmp/last.xml',
    xml: '<hierarchy><node resource-id="screen-Other" bounds="[0,0][1,1]"/></hierarchy>',
  });
  await assert.rejects(
    () => driver.waitFor({ testID: 'screen-Missing' }, { timeoutMs: 1100 }),
    (error) => {
      assert.ok(error instanceof DriverError);
      assert.match(error.message, /timeout after 1100 ms/);
      assert.match(error.message, /testID "screen-Missing"/);
      assert.match(error.message, /last UI dump: \/tmp\/last\.xml/);
      return true;
    },
  );
});

test('artifact basenames are separator-checked', () => {
  const driver = testDriver();
  assert.throws(() => driver.artifactPath('../escape.xml'), DriverError);
  assert.throws(() => driver.artifactPath('a/b.xml'), DriverError);
  const ok = driver.artifactPath('dump-case.xml');
  assert.ok(ok.endsWith('dump-case.xml'));
});
