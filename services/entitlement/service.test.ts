// G08.03 — behavioral tests of the store purchase session. The proofs the
// issue asks for, each failing on the matching revert (implementation-rules
// 1): the device linking before every transaction (criterion 4), the honest
// closed states of cancel/error/delay that never report a purchase (criterion
// 1), the same-store restore pass (criterion 2) and the fail-closed unknowns
// for everything the closed vocabulary does not name. The fake port is the
// store; no network, no SDK.
import assert from 'node:assert/strict';
import test from 'node:test';

import { FakeStoreSessionPort, rcError } from './fake-port.ts';
import {
  ensureStoreLink,
  purchaseNonConsumable,
  restoreEntitlements,
} from './service.ts';
import type { EntitlementDeps } from './types.ts';

const DEVICE_A = '3f2b8c4e-1a2b-4c3d-8e9f-0a1b2c3d4e5f';
const DEVICE_B = '9a7b6c5d-4e3f-4a2b-8c1d-0e9f8a7b6c5d';
const PRODUCT = 'com.kudy.route.gdansk_extended';

function depsWith(
  port: FakeStoreSessionPort,
  lines: string[] = [],
): EntitlementDeps {
  return { store: port, onDiagnostics: (line) => lines.push(line) };
}

// --- criterion 4: every transaction is linked to the device account ---

test('a corrupt device identity is invalid-input and no store call happens', async () => {
  for (const deviceId of ['', 'not-a-uuid', '3f2b8c4e-1a2b-4c3d-8e9f-0a1b2c3d4e5']) {
    const port = new FakeStoreSessionPort();
    const outcome = await ensureStoreLink(depsWith(port), { deviceId });
    assert.equal(outcome.kind, 'invalid-input');
    assert.deepEqual(outcome.diagnostics, ['entitlement-link#device-id']);
    assert.deepEqual(port.calls, []);
  }
});

test('a missing identity object is invalid-input, not a thrown error', async () => {
  const port = new FakeStoreSessionPort();
  const outcome = await ensureStoreLink(depsWith(port), null as never);
  assert.deepEqual(outcome, {
    kind: 'invalid-input',
    diagnostics: ['entitlement-link#device-id'],
  });
  assert.deepEqual(port.calls, []);
});

test('the link carries exactly the registered device_id (app_user_id = device_id)', async () => {
  const port = new FakeStoreSessionPort();
  const outcome = await ensureStoreLink(depsWith(port), { deviceId: DEVICE_A });
  assert.equal(outcome.kind, 'linked');
  assert.deepEqual(port.calls, [`link ${DEVICE_A}`]);
});

test('the linked identity is memoized per port; a different identity re-links', async () => {
  const port = new FakeStoreSessionPort();
  const deps = depsWith(port);
  await ensureStoreLink(deps, { deviceId: DEVICE_A });
  await ensureStoreLink(deps, { deviceId: DEVICE_A });
  assert.deepEqual(port.calls, [`link ${DEVICE_A}`]);
  await ensureStoreLink(deps, { deviceId: DEVICE_B });
  assert.deepEqual(port.calls, [`link ${DEVICE_A}`, `link ${DEVICE_B}`]);
});

test('a failed link is not memoized: the next call links again', async () => {
  const port = new FakeStoreSessionPort();
  const deps = depsWith(port);
  port.linkRejects(rcError('2'));
  const failed = await ensureStoreLink(deps, { deviceId: DEVICE_A });
  assert.deepEqual(failed, { kind: 'store-problem', code: '2' });
  port.linkResolves();
  const retried = await ensureStoreLink(deps, { deviceId: DEVICE_A });
  assert.equal(retried.kind, 'linked');
  assert.deepEqual(port.calls, [`link ${DEVICE_A}`, `link ${DEVICE_A}`]);
});

test('an RC credentials or app-user defect is an executor error, not a user answer', async () => {
  const port = new FakeStoreSessionPort();
  port.linkRejects(rcError('14'));
  assert.deepEqual(await ensureStoreLink(depsWith(port), { deviceId: DEVICE_A }), {
    kind: 'executor-error',
    code: 'invalid-app-user',
  });
  port.linkRejects(rcError('11'));
  assert.deepEqual(await ensureStoreLink(depsWith(port), { deviceId: DEVICE_A }), {
    kind: 'executor-error',
    code: 'invalid-credentials',
  });
});

test('a corrupt link ack is unknown, fail closed', async () => {
  const port = new FakeStoreSessionPort();
  port.linkResolves(null as unknown as { created: boolean });
  const outcome = await ensureStoreLink(depsWith(port), { deviceId: DEVICE_A });
  assert.deepEqual(outcome, {
    kind: 'unknown',
    diagnostics: ['entitlement-link#ack-shape'],
  });
});

// --- criterion 1: purchase states are honest, none of them is "purchased" ---

test('a purchase links the device first, then buys (call order is the contract)', async () => {
  const port = new FakeStoreSessionPort();
  port.purchaseResolves({ productId: PRODUCT });
  const outcome = await purchaseNonConsumable(depsWith(port), { deviceId: DEVICE_A }, PRODUCT);
  assert.equal(outcome.kind, 'transaction-finished');
  assert.deepEqual(port.calls, [`link ${DEVICE_A}`, `purchase ${PRODUCT}`]);
});

test('a failed link short-circuits the purchase: no transaction without the link', async () => {
  const port = new FakeStoreSessionPort();
  port.linkRejects(rcError('10'));
  const outcome = await purchaseNonConsumable(depsWith(port), { deviceId: DEVICE_A }, PRODUCT);
  assert.deepEqual(outcome, { kind: 'unavailable' });
  assert.deepEqual(port.calls, [`link ${DEVICE_A}`]);
});

test('a corrupt product id is invalid-input before any store call', async () => {
  for (const productId of ['', 'has spaces', 'кон-веер', `${'a'.repeat(201)}`]) {
    const port = new FakeStoreSessionPort();
    const outcome = await purchaseNonConsumable(depsWith(port), { deviceId: DEVICE_A }, productId);
    assert.equal(outcome.kind, 'invalid-input', productId);
    assert.deepEqual(port.calls, []);
  }
});

test('cancel, pending delay and store refusal never report a finished transaction', async () => {
  const cases: Array<[string, object]> = [
    ['1', { kind: 'cancelled' }],
    ['20', { kind: 'payment-pending' }],
    ['6', { kind: 'already-owned' }],
    ['3', { kind: 'not-allowed' }],
    ['5', { kind: 'product-unavailable' }],
    ['10', { kind: 'unavailable' }],
    ['2', { kind: 'store-problem', code: '2' }],
  ];
  for (const [code, expected] of cases) {
    const port = new FakeStoreSessionPort();
    port.purchaseRejects(rcError(code));
    const outcome = await purchaseNonConsumable(depsWith(port), { deviceId: DEVICE_A }, PRODUCT);
    assert.deepEqual(outcome, expected, `RC code ${code}`);
    assert.notEqual(outcome.kind, 'transaction-finished');
  }
});

test('an ack for a different product than requested is unknown, fail closed', async () => {
  const port = new FakeStoreSessionPort();
  port.purchaseResolves({ productId: 'com.kudy.route.other_extended' });
  const outcome = await purchaseNonConsumable(depsWith(port), { deviceId: DEVICE_A }, PRODUCT);
  assert.deepEqual(outcome, {
    kind: 'unknown',
    diagnostics: ['entitlement-purchase#ack-product-mismatch'],
  });
});

test('a port answer outside its own contract shape is unknown, never a crash', async () => {
  const port = new FakeStoreSessionPort();
  port.purchaseResolvesCorrupt(null);
  const outcome = await purchaseNonConsumable(depsWith(port), { deviceId: DEVICE_A }, PRODUCT);
  assert.deepEqual(outcome, {
    kind: 'unknown',
    diagnostics: ['entitlement-purchase#ack-product-mismatch'],
  });
  const hostilePort = new FakeStoreSessionPort();
  hostilePort.purchaseRejects(new Error('native bridge exploded with a store url https://rc'));
  const hostile = await purchaseNonConsumable(depsWith(hostilePort), { deviceId: DEVICE_A }, PRODUCT);
  assert.equal(hostile.kind, 'unknown');
});

// --- criterion 2: the same-store restore pass ---

test('restore links the device first, then runs the store pass', async () => {
  const port = new FakeStoreSessionPort();
  const outcome = await restoreEntitlements(depsWith(port), { deviceId: DEVICE_A });
  assert.equal(outcome.kind, 'restore-finished');
  assert.deepEqual(port.calls, [`link ${DEVICE_A}`, 'restore']);
});

test('a failed link short-circuits the restore', async () => {
  const port = new FakeStoreSessionPort();
  port.linkRejects(rcError('2'));
  const outcome = await restoreEntitlements(depsWith(port), { deviceId: DEVICE_A });
  assert.deepEqual(outcome, { kind: 'store-problem', code: '2' });
  assert.deepEqual(port.calls, [`link ${DEVICE_A}`]);
});

test('restore failures answer in the restore vocabulary, honestly', async () => {
  for (const [code, expected] of [
    ['10', { kind: 'unavailable' }],
    ['2', { kind: 'store-problem', code: '2' }],
    ['1', { kind: 'store-problem', code: '1' }],
    ['14', { kind: 'executor-error', code: 'invalid-app-user' }],
  ] as const) {
    const port = new FakeStoreSessionPort();
    port.restoreRejects(rcError(code));
    const outcome = await restoreEntitlements(depsWith(port), { deviceId: DEVICE_A });
    assert.deepEqual(outcome, expected, `RC code ${code}`);
  }
});

test('a corrupt restore ack is unknown, fail closed', async () => {
  const port = new FakeStoreSessionPort();
  port.restoreResolvesCorrupt(null);
  const outcome = await restoreEntitlements(depsWith(port), { deviceId: DEVICE_A });
  assert.deepEqual(outcome, {
    kind: 'unknown',
    diagnostics: ['entitlement-restore#ack-shape'],
  });
});

// --- diagnostics: named lines only, SDK text never leaks ---

test('diagnostics are named lines and never carry the store failure text', async () => {
  const lines: string[] = [];
  const port = new FakeStoreSessionPort();
  port.purchaseRejects(rcError('1', 'user backed out; receipt secret-device-token embedded'));
  await purchaseNonConsumable(depsWith(port, lines), { deviceId: DEVICE_A }, PRODUCT);
  assert.ok(lines.length > 0);
  for (const line of lines) {
    assert.match(line, /^entitlement:/);
    assert.ok(!line.includes('secret-device-token'), line);
    assert.ok(!line.includes('receipt'), line);
  }
});
