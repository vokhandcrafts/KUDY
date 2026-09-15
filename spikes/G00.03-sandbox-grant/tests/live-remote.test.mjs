// G00.03.b live probes. These run only against a real server process given by
// G00_03_B_LIVE_URL (npm start with its env); without it the file self-skips
// and the suite stays in mock mode — the runner therefore distinguishes the
// two modes explicitly. Probes that depend on server internals (known-key
// forgeries, guard mutations) live only in the mock files; the live file keeps
// to the external protocol surface. Sandbox/production accounts and store
// purchases remain G00.03.c: a registered device without a purchase must fail
// closed either way (403 no_entitlement with a reachable provider, 503
// entitlement_unavailable without one) — the check asserts exactly that.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GRANT_BODY, LIVE_URL, PATH_NON_MEMBER, PATH_OK, postGrant, postGrantRaw } from './harness.mjs';

const skipReason = LIVE_URL ? false : 'mock mode: set G00_03_B_LIVE_URL (npm start with env) to run these against a live server';

async function registerDevice(base) {
  const response = await fetch(`${base}/v1/device`, { method: 'POST' });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.match(body.device_id, /^[0-9a-f-]{36}$/);
  assert.ok(body.device_secret.length >= 40);
  return body;
}

test('live: a request without any bearer is refused', { skip: skipReason }, async () => {
  const probe = await postGrant(LIVE_URL, null, GRANT_BODY);
  assert.equal(probe.status, 403);
  assert.equal(probe.code, 'device_auth_failed');
  assert.equal(probe.urls, null);
});

test('live: malformed Authorization shapes are refused', { skip: skipReason }, async () => {
  for (const headerValue of ['bearer x', 'Basic dXNlcjpwYXNz', 'Bearer ', 'not-a-secret-at-all']) {
    const probe = await postGrantRaw(LIVE_URL, headerValue, GRANT_BODY);
    assert.equal(probe.status, 403, headerValue);
    assert.equal(probe.code, 'device_auth_failed', headerValue);
    assert.equal(probe.urls, null, headerValue);
  }
});

test('live: a registered device with no purchase fails closed', { skip: skipReason }, async () => {
  const device = await registerDevice(LIVE_URL);
  const probe = await postGrant(LIVE_URL, device.device_secret, GRANT_BODY);
  // Reachable provider → no entitlement; unreachable provider → fail closed.
  // Both are acceptable here; a 200 with URLs is not, ever.
  assert.ok([403, 503].includes(probe.status), `status ${probe.status}`);
  assert.ok(['no_entitlement', 'entitlement_unavailable'].includes(probe.code), `code ${probe.code}`);
  if (probe.status === 503) {
    assert.ok(probe.headers.get('retry-after'), 'a 503 must carry Retry-After (09 §5)');
  }
  assert.equal(probe.urls, null);
});

test('live: unsafe and non-member paths are refused before any entitlement work', { skip: skipReason }, async () => {
  const device = await registerDevice(LIVE_URL);
  for (const badPath of [PATH_NON_MEMBER, '../outside.txt', 'transcripts\\..\\..\\outside.txt', '/etc/passwd', 'C:/win.ini', '']) {
    const probe = await postGrant(LIVE_URL, device.device_secret, { ...GRANT_BODY, paths: [badPath] });
    assert.equal(probe.status, 403, badPath);
    assert.equal(probe.code, 'path_not_allowed', badPath);
    assert.equal(probe.urls, null, badPath);
  }
});

test('live: a broken JSON body with valid auth is invalid_request', { skip: skipReason }, async () => {
  const device = await registerDevice(LIVE_URL);
  const response = await fetch(`${LIVE_URL}/v1/grant`, {
    method: 'POST',
    headers: { authorization: `Bearer ${device.device_secret}`, 'content-type': 'application/json' },
    body: '{"route_id": ',
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'invalid_request');
});

test('live: GET on the grant route is not_found', { skip: skipReason }, async () => {
  const response = await fetch(`${LIVE_URL}/v1/grant`);
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, 'not_found');
});
