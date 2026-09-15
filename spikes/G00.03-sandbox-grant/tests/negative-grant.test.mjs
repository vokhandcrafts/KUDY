// G00.03.b negative checks, protocol layer. The .a suite (test/) already
// covers bought-without-right, unknown route/tier/version/locale, traversal
// basics, provider outage fail-closed, expiry/regrant and sandbox→production;
// this file adds the adversarial angles the .a handover named for .b:
// cache-bypass attempts, batch partial-fulfillment, header scheme edge cases,
// forged-but-well-signed tokens and log hygiene for the new probes. Everything
// runs on the mock transport; the same probes against a running live server
// are in live-remote.test.mjs.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mintFileToken } from '../server/signed-url.mjs';
import {
  GRANT_BODY, MANIFEST_BASE, PATH_NON_MEMBER, PATH_OK,
  clientAt, entitledDevice, makeRig, postGrant, postGrantRaw, serve,
} from './harness.mjs';

const malformedAuthCases = [
  ['absent header', null],
  ['lowercase scheme', 'bearer not-even-a-secret'],
  ['wrong scheme', 'Basic dXNlcjpwYXNz'],
  ['empty secret', 'Bearer '],
  ['raw secret without scheme', 'not-a-secret-at-all'],
];

test('grant refuses every malformed Authorization shape before reading the body', async (t) => {
  const rig = makeRig();
  const { base } = await serve(t, rig);
  for (const [name, headerValue] of malformedAuthCases) {
    const probe = await postGrantRaw(base, headerValue, GRANT_BODY);
    assert.equal(probe.status, 403, name);
    assert.equal(probe.code, 'device_auth_failed', name);
    assert.equal(probe.urls, null, name);
  }
});

test('an authenticated request with a broken JSON body is invalid_request', async (t) => {
  const rig = makeRig();
  const { base } = await serve(t, rig);
  const { registration } = await entitledDevice(t, rig, { base, store: rig.store });
  const response = await fetch(`${base}/v1/grant`, {
    method: 'POST',
    headers: { authorization: `Bearer ${registration.deviceSecret}`, 'content-type': 'application/json' },
    body: '{"route_id": "g00-03-spike", ',
  });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error.code, 'invalid_request');
});

test('a path batch over the documented maximum is invalid_request', async (t) => {
  const rig = makeRig();
  const { base } = await serve(t, rig);
  const { secret } = await entitledDevice(t, rig, { base, store: rig.store });
  const probe = await postGrant(base, secret, {
    ...GRANT_BODY,
    paths: Array.from({ length: 21 }, (_, i) => `transcripts/fill-${i}.txt`),
  });
  assert.equal(probe.status, 400);
  assert.equal(probe.code, 'invalid_request');
});

test('GET on the grant route is not_found inside the closed error list', async (t) => {
  const rig = makeRig();
  const { base } = await serve(t, rig);
  const response = await fetch(`${base}/v1/grant`);
  assert.equal(response.status, 404);
  const body = await response.json();
  assert.equal(body.error.code, 'not_found');
});

test('one bad path denies the whole batch: no partial URLs are issued', async (t) => {
  const rig = makeRig();
  const { base, events } = await serve(t, rig);
  const { secret } = await entitledDevice(t, rig, { base, store: rig.store });
  const issuedBefore = events.filter((entry) => entry.event === 'grant_issued').length;
  assert.ok(issuedBefore >= 1, 'setup: the device was granted once');
  for (const badPath of [PATH_NON_MEMBER, '../outside.txt']) {
    const probe = await postGrant(base, secret, { ...GRANT_BODY, paths: [PATH_OK, badPath] });
    assert.equal(probe.status, 403, badPath);
    assert.equal(probe.code, 'path_not_allowed', badPath);
    assert.equal(probe.urls, null, badPath);
  }
  const issuedAfter = events.filter((entry) => entry.event === 'grant_issued').length;
  assert.equal(issuedAfter, issuedBefore, 'no batch may partially grant');
});

test('an oversized body is rejected with the documented 400 and the server survives', async (t) => {
  const rig = makeRig();
  const { base } = await serve(t, rig);
  const { secret } = await entitledDevice(t, rig, { base, store: rig.store });
  const oversized = { ...GRANT_BODY, paths: ['x'.repeat(70 * 1024)] };
  const rejected = await postGrant(base, secret, oversized);
  assert.equal(rejected.status, 400, 'shape/size answers from the closed list, not with a connection reset');
  assert.equal(rejected.code, 'invalid_request');
  assert.equal(rejected.urls, null);
  // The same device still gets a normal grant afterwards: the rejection bought
  // safety, not a dead server.
  const after = await postGrant(base, secret, GRANT_BODY);
  assert.equal(after.status, 200);
  assert.equal(after.urls.length, 1);
});

test('a body streaming past the drain limit is reset, not answered', async (t) => {
  const rig = makeRig();
  const { base } = await serve(t, rig);
  const { secret } = await entitledDevice(t, rig, { base, store: rig.store });
  const flood = { ...GRANT_BODY, paths: ['x'.repeat(2 * 1024 * 1024)] };
  const reset = await postGrant(base, secret, flood);
  assert.equal(reset.status, 0, 'past the bounded drain limit the server resets instead of answering');
  assert.ok(reset.transportError, 'the client sees a transport error, not a grant or a hang');
  // The bounded reset bought safety, not a dead server.
  const after = await postGrant(base, secret, GRANT_BODY);
  assert.equal(after.status, 200);
  assert.equal(after.urls.length, 1);
});

test('a denial is never cached: a second device stays refused through an outage', async (t) => {
  const rig = makeRig();
  const { base, events } = await serve(t, rig);
  await entitledDevice(t, rig, { base, store: rig.store, account: 'acct-1' });
  // The stranger registers but never purchases: its refusals must not be
  // cached anywhere, and an outage must fail closed (503), never grant.
  const stranger = await clientAt(base, rig.store, 'acct-2');
  const strangerRegistration = await stranger.register();

  const refused = await postGrant(base, strangerRegistration.deviceSecret, GRANT_BODY);
  assert.equal(refused.status, 403);
  assert.equal(refused.code, 'no_entitlement');
  const asksAfterRefusal = rig.providerAsks();
  assert.ok(asksAfterRefusal >= 2, 'the provider was consulted for the stranger');

  rig.store.setAvailable(false);
  const outage = await postGrant(base, strangerRegistration.deviceSecret, GRANT_BODY);
  assert.equal(outage.status, 503, 'no cached denial, no cached grant: fail closed');
  assert.equal(outage.code, 'entitlement_unavailable');

  rig.store.setAvailable(true);
  const again = await postGrant(base, strangerRegistration.deviceSecret, GRANT_BODY);
  assert.equal(again.status, 403);
  assert.equal(again.code, 'no_entitlement');
  assert.ok(rig.providerAsks() > asksAfterRefusal, 'each refusal asks the provider again');
  assert.ok(!events.some((entry) => entry.event === 'entitlement_cache_hit'), 'the cache holds positives only; a refused device must never hit it');
});

test('the positive cache is per device: another device never rides on it', async (t) => {
  const rig = makeRig();
  const { base, events } = await serve(t, rig);
  const owner = await entitledDevice(t, rig, { base, store: rig.store, account: 'acct-1' });
  const stranger = await entitledDevice(t, rig, { base, store: rig.store, account: 'acct-2' });
  assert.equal(owner.purchase.ok, true, 'setup: owner purchased and granted');
  assert.equal(stranger.purchase.ok, true, 'setup: stranger purchased and granted');
  assert.equal(rig.providerAsks(), 2, 'each first grant consulted the provider exactly once: the cache key cannot work without the device');

  const ownerAgain = await postGrant(base, owner.secret, GRANT_BODY);
  assert.equal(ownerAgain.status, 200);
  const strangerAgain = await postGrant(base, stranger.secret, GRANT_BODY);
  assert.equal(strangerAgain.status, 200, 'the stranger grants on its own merit after the owner cached hit');
  assert.equal(rig.providerAsks(), 2, 'both repeats rode the cache: no provider ask after the first grants');
  const hits = events.filter((entry) => entry.event === 'entitlement_cache_hit');
  assert.equal(hits.length, 2, 'each device rides only its own cache entry');
});

test('cacheTtl=0 asks the provider on every grant', async (t) => {
  const rig = makeRig();
  const { base, events } = await serve(t, rig, { cacheTtlSeconds: 0 });
  const { secret } = await entitledDevice(t, rig, { base, store: rig.store });
  const asksAfterSetup = rig.providerAsks();
  for (let round = 0; round < 3; round += 1) {
    const probe = await postGrant(base, secret, GRANT_BODY);
    assert.equal(probe.status, 200);
  }
  assert.equal(rig.providerAsks(), asksAfterSetup + 3, 'no cache entry may outlive ttl=0');
  assert.ok(!events.some((entry) => entry.event === 'entitlement_cache_hit'));
});

test('a cached entitlement does not skip the manifest guard', async (t) => {
  const rig = makeRig();
  const { base, events } = await serve(t, rig);
  const { secret } = await entitledDevice(t, rig, { base, store: rig.store });
  const first = await postGrant(base, secret, GRANT_BODY);
  assert.equal(first.status, 200, 'setup: entitlement is now cached');
  const asksAfterSetup = rig.providerAsks();

  const bypass = await postGrant(base, secret, { ...GRANT_BODY, paths: [PATH_NON_MEMBER] });
  assert.equal(bypass.status, 403);
  assert.equal(bypass.code, 'path_not_allowed');
  assert.equal(bypass.urls, null);

  const normal = await postGrant(base, secret, GRANT_BODY);
  assert.equal(normal.status, 200);
  assert.equal(rig.providerAsks(), asksAfterSetup, 'the cached entitlement avoided a second provider ask');
  assert.ok(events.some((entry) => entry.event === 'entitlement_cache_hit'), 'the entitlement stayed cached across the refused probe');
});

test('a signed token is not enough: it must name a manifest member path', async (t) => {
  const rig = makeRig();
  const { base, signingKey } = await serve(t, rig);
  const { deviceId } = await entitledDevice(t, rig, { base, store: rig.store });

  const forgedCases = [
    ['wrong signing key', () => mintFileToken({
      signingKey: Buffer.alloc(32, 7),
      manifestBase: MANIFEST_BASE,
      path: PATH_OK,
      deviceId,
      ttlSeconds: 600,
    })],
    ['member key, non-member path', () => mintFileToken({
      signingKey,
      manifestBase: MANIFEST_BASE,
      path: PATH_NON_MEMBER,
      deviceId,
      ttlSeconds: 600,
    })],
    ['member key, traversal path', () => mintFileToken({
      signingKey,
      manifestBase: MANIFEST_BASE,
      path: '../outside.txt',
      deviceId,
      ttlSeconds: 600,
    })],
    ['member key, backslash path', () => mintFileToken({
      signingKey,
      manifestBase: MANIFEST_BASE,
      path: 'transcripts\\..\\..\\outside.txt',
      deviceId,
      ttlSeconds: 600,
    })],
    ['member key, absolute path', () => mintFileToken({
      signingKey,
      manifestBase: MANIFEST_BASE,
      path: '/etc/passwd',
      deviceId,
      ttlSeconds: 600,
    })],
    ['member key, unknown manifest base', () => mintFileToken({
      signingKey,
      manifestBase: 'g00-03-spike/9999-99-99.9/xx/extended',
      path: PATH_OK,
      deviceId,
      ttlSeconds: 600,
    })],
  ];
  for (const [name, mint] of forgedCases) {
    const { token } = mint();
    const response = await fetch(`${base}/private/${token}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(response.status, 403, name);
    const parsed = JSON.parse(bytes.toString('utf8'));
    assert.equal(parsed.error.code, 'url_invalid', name);
    assert.ok(bytes.length < 200, `${name}: only the error envelope, never file bytes`);
  }
});

test('a production-store entitlement never opens a sandbox server resource', async (t) => {
  const rig = makeRig({ storeEnvironment: 'production' });
  const { base } = await serve(t, rig, { serverEnvironment: 'sandbox' });
  const { secret } = await entitledDevice(t, rig, { base, store: rig.store });
  const probe = await postGrant(base, secret, GRANT_BODY);
  assert.equal(probe.status, 403);
  assert.equal(probe.code, 'environment_mismatch');
  assert.equal(probe.urls, null);
});

test('matching environments on both sides still grant (control)', async (t) => {
  const rig = makeRig({ storeEnvironment: 'production' });
  const { base } = await serve(t, rig, { serverEnvironment: 'production' });
  const { secret } = await entitledDevice(t, rig, { base, store: rig.store });
  const probe = await postGrant(base, secret, GRANT_BODY);
  assert.equal(probe.status, 200);
  assert.equal(probe.urls.length, 1);
});

test('an expired URL stays dead after a fresh regrant', async (t) => {
  const rig = makeRig();
  const { base } = await serve(t, rig, { urlTtlSeconds: 1 });
  const { secret } = await entitledDevice(t, rig, { base, store: rig.store });
  const stale = await postGrant(base, secret, GRANT_BODY);
  assert.equal(stale.status, 200);
  await new Promise((resolve) => setTimeout(resolve, 1100));

  const fresh = await postGrant(base, secret, GRANT_BODY);
  assert.equal(fresh.status, 200, 'setup: regrant after expiry works');

  const replay = await fetch(`${base}${stale.urls[0].url}`);
  assert.equal(replay.status, 403, 'the regrant must not resurrect the expired URL');
  const body = await replay.json();
  assert.equal(body.error.code, 'url_expired');

  const live = await fetch(`${base}${fresh.urls[0].url}`);
  assert.equal(live.status, 200, 'setup sanity: the fresh URL downloads');
});

test('new negative probes keep secrets, device ids and URLs out of the logs', async (t) => {
  const rig = makeRig();
  const { base, events } = await serve(t, rig);
  const { registration, purchase } = await entitledDevice(t, rig, { base, store: rig.store });
  assert.equal(purchase.ok, true, 'setup: one grant issued whose signed URL must stay out of the logs');
  await postGrant(base, null, GRANT_BODY);
  await postGrant(base, 'junk-secret'.repeat(12), GRANT_BODY);
  await postGrant(base, registration.deviceSecret, { ...GRANT_BODY, paths: [PATH_NON_MEMBER] });
  const serialized = JSON.stringify(events);
  const lowercased = serialized.toLowerCase();
  for (const value of [registration.deviceSecret, registration.deviceId, '/private/', purchase.urls[0].url]) {
    assert.ok(!serialized.includes(value), 'logs must not carry secrets, ids or signed URLs');
  }
  assert.ok(!lowercased.includes('bearer'), 'logs must not carry the bearer scheme in any case');
  assert.ok(!lowercased.includes('receipt'), 'logs must not carry receipts');
  assert.ok(events.length > 0);
  assert.ok(events.every((entry) => entry.device_hash === undefined || /^[0-9a-f]{16}$/.test(entry.device_hash)));
});
