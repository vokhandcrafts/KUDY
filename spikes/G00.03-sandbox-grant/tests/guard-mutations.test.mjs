// G00.03.b mutation checks: the negative suite must FAIL if the spike's
// device-auth or manifest guard disappears. Each check runs the same probe
// against (1) the real server — refused — and (2) an in-memory mutated copy of
// grant-server.mjs with exactly one guard removed — breached. If the real
// guard is ever removed from the .a code, the "refused" assertion fails, and
// the mutation leg proves the probe is sensitive to precisely that guard.
// The .a spike files are never edited: the mutated copy is written to a temp
// scratch dir with its relative imports rewritten to absolute URLs.
// These checks need the in-process mock transport and are skipped in live mode.
import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { mintFileToken } from '../server/signed-url.mjs';
import {
  GRANT_BODY, LIVE_URL, MANIFEST_BASE, PATH_NON_MEMBER, SPIKE_ROOT,
  entitledDevice, makeRig, postGrant, scratchDir, serve,
} from './harness.mjs';

const skipInLive = LIVE_URL ? 'mutation checks need the in-process mock transport' : false;

function buildMutatedSource({ replacements }) {
  const original = readFileSync(join(SPIKE_ROOT, 'server', 'grant-server.mjs'), 'utf8');
  let mutated = original;
  for (const [find, replace] of replacements) {
    const occurrences = mutated.split(find).length - 1;
    assert.equal(
      occurrences,
      1,
      `mutation target must exist exactly once in grant-server.mjs (did the .a spike code change?): ${find.slice(0, 48)}…`,
    );
    mutated = mutated.replaceAll(find, replace);
  }
  const serverDir = pathToFileURL(join(SPIKE_ROOT, 'server')).href;
  mutated = mutated.replaceAll("from './device-auth.mjs'", `from '${serverDir}/device-auth.mjs'`);
  mutated = mutated.replaceAll("from './signed-url.mjs'", `from '${serverDir}/signed-url.mjs'`);
  return mutated;
}

async function bootMutated(t, rig, { name, replacements, devicesFile, signingKey }) {
  const mutated = buildMutatedSource({ replacements });
  const dir = scratchDir(name);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'grant-server-mutated.mjs');
  writeFileSync(file, mutated, 'utf8');
  const mutatedModule = await import(pathToFileURL(file).href);
  return serve(t, rig, { label: name, factory: mutatedModule.createGrantServer, devicesFile, signingKey });
}

test('mutation: without device auth an anonymous grant goes through', { skip: skipInLive }, async (t) => {
  const rig = makeRig();
  const real = await serve(t, rig);
  const { deviceId } = await entitledDevice(t, rig, { base: real.base, store: rig.store });

  const refused = await postGrant(real.base, null, GRANT_BODY);
  assert.equal(refused.status, 403, 'the real server refuses a request without any bearer');
  assert.equal(refused.code, 'device_auth_failed');

  const mutated = await bootMutated(t, rig, {
    name: 'no-device-auth',
    replacements: [[
      'authenticateBearer(req.headers.authorization, devicesFile)',
      `{ ok: true, deviceId: ${JSON.stringify(deviceId)} }`,
    ]],
    devicesFile: real.devicesFile,
    signingKey: real.signingKey,
  });
  const breached = await postGrant(mutated.base, null, GRANT_BODY);
  assert.equal(
    breached.status,
    200,
    'with device auth removed the anonymous probe must grant — the refusal above is load-bearing',
  );
  assert.equal(breached.urls.length, 1);
});

test('mutation: without the manifest guard a non-member path grants', { skip: skipInLive }, async (t) => {
  const rig = makeRig();
  const real = await serve(t, rig);
  const { secret } = await entitledDevice(t, rig, { base: real.base, store: rig.store });

  const refused = await postGrant(real.base, secret, { ...GRANT_BODY, paths: [PATH_NON_MEMBER] });
  assert.equal(refused.status, 403, 'the real server refuses a non-member path');
  assert.equal(refused.code, 'path_not_allowed');

  const mutated = await bootMutated(t, rig, {
    name: 'no-manifest-guard',
    replacements: [['!manifest.paths.includes(p)', 'false']],
    devicesFile: real.devicesFile,
    signingKey: real.signingKey,
  });
  const breached = await postGrant(mutated.base, secret, { ...GRANT_BODY, paths: [PATH_NON_MEMBER] });
  assert.equal(
    breached.status,
    200,
    'with the manifest guard removed the non-member probe must grant',
  );
  assert.deepEqual(breached.urls.map((entry) => entry.path), [PATH_NON_MEMBER]);
});

test('mutation: without the download guard a signed escape token reads files', { skip: skipInLive }, async (t) => {
  const rig = makeRig();
  const real = await serve(t, rig);
  const { deviceId } = await entitledDevice(t, rig, { base: real.base, store: rig.store });

  const escapePath = '../'.repeat(6) + 'server/grant-server.mjs';
  const { token } = mintFileToken({
    signingKey: real.signingKey,
    manifestBase: MANIFEST_BASE,
    path: escapePath,
    deviceId,
    ttlSeconds: 600,
  });
  const refused = await fetch(`${real.base}/private/${token}`);
  assert.equal(refused.status, 403, 'the real server refuses a signed token that escapes the manifest');
  assert.equal((await refused.json()).error.code, 'url_invalid');

  const mutated = await bootMutated(t, rig, {
    name: 'no-download-guard',
    replacements: [
      ['!manifest || !manifest.paths.includes(verdict.path) || isUnsafePath(verdict.path)', 'false'],
      ['!filePath.startsWith(root + sep)', 'false'],
    ],
    devicesFile: real.devicesFile,
    signingKey: real.signingKey,
  });
  const breached = await fetch(`${mutated.base}/private/${token}`);
  assert.equal(
    breached.status,
    200,
    'with the download guard removed the signed escape token must read an arbitrary file',
  );
  const bytes = Buffer.from(await breached.arrayBuffer());
  assert.ok(bytes.length > 200, 'a file body came out');
  assert.match(bytes.toString('utf8'), /createGrantServer/, 'the served file is the grant server source itself');
});
