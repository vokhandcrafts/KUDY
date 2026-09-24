// G04.02.b — acceptance suite for the grant client (issue #190). Criteria:
// 1. the request is exactly the 09 §5 shape with a Bearer credential from the
//    injected port, and paths come only from the verified lock (batched into
//    contract-size portions), never from the caller;
// 2. every code of the closed list of 19 §3.6 has its own outcome; unknown
//    status/code/pairing is a named unknown failure — fail closed; 503
//    entitlement_unavailable retries honouring Retry-After (removing that
//    handling fails this suite — the task's Proof); offline is a defined
//    outcome with no exception reaching the caller;
// 3. a URL expiring mid-download re-grants the remaining portion and
//    continues; verified files are never fetched again; a URL nearing expiry
//    is re-minted before the next fetch (09 §5.1);
// 4. offline mid-download keeps the partial state and a retry completes;
// 5. no secret, token or signed URL reaches diagnostics, error messages or
//    persisted state (captured by the recording driver and sinks);
// 6. the fake's negative-case list is the machine projection of the closed
//    list of 19 §3.6 — every code is answered and mapped (the single
//    verbatim copy of the list lives in grant.ts); live parity is G08.04's
//    duty (implementation-rules 15) and is recorded in the results file.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { activate, layerPath, parseLock } from './download.ts';
import {
  createGrantFetchSource,
  DEFAULT_GRANT_RETRY,
  GRANT_ERRORS,
  parseGrantSuccess,
  requestGrant,
} from './grant.ts';
import type { GrantDeps, GrantFetchDeps, GrantHttpRequest, GrantHttpResponse, GrantOutcome, GrantTransport } from './grant.ts';
import { createNodeDownloadStore, nodeSha256 } from './nodeDownloadStore.ts';
import { lockFrom } from './test-fixture.ts';
import { getBundleAssets, openDatabase } from '../db/db.ts';
import { nodeSqliteDriver } from '../db/test-fixture.ts';
import type { SqlDriver, SqlStatement } from '../db/types.ts';
import type { LayerKey } from './types.ts';

const KEY: LayerKey = { routeId: 'route-x', version: '1', locale: 'be', tier: 'extended' };

// A fake device secret: the redaction assertions below must never see it
// outside the Bearer port itself.
const SECRET = 'test-device-secret-0123456789abcdef';
const LOCK_URL = 'https://cdn.test/lock.json';

const utf8 = (text: string) => new TextEncoder().encode(text);

const okResponse = (
  paths: string[],
  expiresAt = 600_000,
  urlOf: (path: string, index: number) => string = (path, index) => `/private/token-${index}`,
): GrantHttpResponse => ({
  status: 200,
  headers: {},
  body: {
    lock_url: LOCK_URL,
    urls: paths.map((p, index) => ({ path: p, url: urlOf(p, index), expires_at: expiresAt })),
  },
});

const errResponse = (status: number, code: string, headers: Record<string, string> = {}): GrantHttpResponse => ({
  status,
  headers,
  body: { error: { code } },
});

// A synthetic lock of guard-clean entries (bytes and sha256 do not matter to
// the grant client; the e2e tests build real locks through lockFrom).
const lockFor = (paths: string[]): unknown =>
  paths.map((p) => ({ path: p, bytes: 1, sha256: 'a'.repeat(64) }));

function recordingTransport(
  handler: (call: GrantHttpRequest, index: number) => GrantHttpResponse,
): { transport: GrantTransport; calls: GrantHttpRequest[] } {
  const calls: GrantHttpRequest[] = [];
  const transport: GrantTransport = async (request) => {
    calls.push(request);
    return handler(request, calls.length - 1);
  };
  return { transport, calls };
}

function rig(transport: GrantTransport, overrides: Partial<GrantDeps> = {}): {
  deps: GrantDeps;
  delays: number[];
  diagnostics: string[];
} {
  const delays: number[] = [];
  const diagnostics: string[] = [];
  const deps: GrantDeps = {
    transport,
    credential: async () => SECRET,
    delay: async (ms) => {
      delays.push(ms);
    },
    onDiagnostics: (line) => diagnostics.push(line),
    ...overrides,
  };
  return { deps, delays, diagnostics };
}

function sourceRig(
  transport: GrantTransport,
  fetchBytes: GrantFetchDeps['fetchBytes'],
  overrides: Partial<GrantFetchDeps> = {},
): { deps: GrantFetchDeps; diagnostics: string[] } {
  const diagnostics: string[] = [];
  const deps: GrantFetchDeps = {
    transport,
    credential: async () => SECRET,
    fetchBytes,
    delay: async () => {},
    now: () => 0,
    onDiagnostics: (line) => diagnostics.push(line),
    ...overrides,
  };
  return { deps, diagnostics };
}

function openFresh(): SqlDriver {
  const driver = nodeSqliteDriver();
  openDatabase(driver);
  return driver;
}

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'g0402b-'));
}

test('criterion 1: the request is exactly the 09 §5 shape with Bearer from the port, paths only from the verified lock', async () => {
  const paths = Array.from({ length: 25 }, (_, i) => `audio/story-${i}.m4a`);
  const { transport, calls } = recordingTransport((call) => okResponse(call.body.paths));
  const { deps } = rig(transport);

  const outcome = await requestGrant({ ...KEY, lock: lockFor(paths) }, deps);

  assert.equal(outcome.kind, 'granted');
  // 25 paths → two contract-size portions (the limit is contract-set, 09 §5).
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.deepEqual(Object.keys(call.body).sort(), ['locale', 'paths', 'route_id', 'tier', 'version']);
    assert.equal(call.body.route_id, KEY.routeId);
    assert.equal(call.body.version, KEY.version);
    assert.equal(call.body.locale, KEY.locale);
    assert.equal(call.body.tier, KEY.tier);
    assert.equal(call.bearer, SECRET);
    assert.ok(call.body.paths.length > 0 && call.body.paths.length <= 20);
  }
  assert.deepEqual(calls[0].body.paths, paths.slice(0, 20));
  assert.deepEqual(calls[1].body.paths, paths.slice(20));
  const granted = outcome as Extract<GrantOutcome, { kind: 'granted' }>;
  assert.equal(granted.urls.urls.length, 25);
  assert.equal(granted.urls.lockUrl, LOCK_URL);
});

test('criterion 1: a corrupt lock or an unsafe key is invalid-input before any transport call', async () => {
  const { transport, calls } = recordingTransport(() => okResponse(['stops.json']));
  const { deps } = rig(transport);

  const corrupt = await requestGrant({ ...KEY, lock: [{ path: '../escape', bytes: 1, sha256: 'x' }] }, deps);
  assert.equal(corrupt.kind, 'invalid-input');
  assert.deepEqual(
    (corrupt as Extract<GrantOutcome, { kind: 'invalid-input' }>).diagnostics,
    ['lock.json[0]#unsafe-path:../escape'],
  );
  const unsafeKey = await requestGrant({ ...KEY, routeId: '../evil', lock: lockFor(['stops.json']) }, deps);
  assert.equal(unsafeKey.kind, 'invalid-input');
  assert.deepEqual(calls, []);
});

// One outcome per closed code (criterion 2); the four special behaviours of
// the issue are their own kinds, the rest are named failures. The codes are
// driven from the machine projection GRANT_ERRORS — its literal in grant.ts
// is the single verbatim copy of the 19 §3.6 closed list (implementation-
// rules 8: no sibling copy), and this loop is the fake's negative-case list:
// every closed code is answered by the fake and must map to its own outcome.
// Live parity is G08.04's duty (implementation-rules 15).
const EXPECTED_KIND: Record<(typeof GRANT_ERRORS)[number]['code'], string> = {
  invalid_request: 'executor-error',
  no_entitlement: 'purchase',
  entitlement_unavailable: 'unavailable',
  url_expired: 'regrant',
  device_auth_failed: 'failed',
  unknown_route_tier: 'failed',
  manifest_not_found: 'failed',
  path_not_allowed: 'failed',
  environment_mismatch: 'failed',
  url_invalid: 'failed',
  not_found: 'failed',
};

test('criterion 2: every code of the closed list has its own outcome', async () => {
  for (const { status, code } of GRANT_ERRORS) {
    const { transport, calls } = recordingTransport(() => errResponse(status, code));
    const { deps } = rig(transport, { policy: { maxRetries: 0 } });
    const outcome = await requestGrant({ ...KEY, lock: lockFor(['stops.json']) }, deps);
    assert.equal(outcome.kind, EXPECTED_KIND[code], `code ${code}`);
    assert.equal(calls.length, 1, `code ${code} must not be retried`);
    if (outcome.kind !== 'granted' && outcome.kind !== 'unknown' && outcome.kind !== 'offline') {
      assert.equal('code' in outcome && outcome.code, code, `code ${code}`);
      assert.equal('status' in outcome && outcome.status, status, `code ${code}`);
    }
    if (outcome.kind === 'unavailable') {
      const unavailable = outcome as Extract<GrantOutcome, { kind: 'unavailable' }>;
      assert.equal(unavailable.retriesUsed, 0);
      assert.equal(unavailable.retryAfterMs, DEFAULT_GRANT_RETRY.defaultRetryAfterMs);
    }
  }
});

test('criterion 2: an unknown status or code, or a broken status↔code pairing, is a named unknown failure — never granted', async () => {
  const cases: GrantHttpResponse[] = [
    errResponse(418, 'teapot'),
    errResponse(500, 'no_entitlement'),
    errResponse(403, 'invalid_request'),
    { status: 503, headers: {}, body: { error: {} } },
    { status: 503, headers: {}, body: null },
    { status: 200, headers: {}, body: null },
  ];
  for (const response of cases) {
    const { transport } = recordingTransport(() => response);
    const { deps, diagnostics } = rig(transport);
    const outcome = await requestGrant({ ...KEY, lock: lockFor(['stops.json']) }, deps);
    assert.equal(outcome.kind, 'unknown', JSON.stringify(response));
    const unknown = outcome as Extract<GrantOutcome, { kind: 'unknown' }>;
    assert.ok(unknown.diagnostics.length > 0, JSON.stringify(response));
    assert.ok(diagnostics.length > 0, JSON.stringify(response));
  }
});

test('criterion 2: 503 entitlement_unavailable retries honouring Retry-After, then grants (the Proof)', async () => {
  let call = 0;
  const { transport, calls } = recordingTransport(() => {
    call += 1;
    if (call === 1) return errResponse(503, 'entitlement_unavailable', { 'retry-after': '7' });
    if (call === 2) return errResponse(503, 'entitlement_unavailable');
    return okResponse(['stops.json']);
  });
  const { deps, delays } = rig(transport);

  const outcome = await requestGrant({ ...KEY, lock: lockFor(['stops.json']) }, deps);

  assert.equal(outcome.kind, 'granted');
  assert.equal(calls.length, 3);
  // The waits are the parsed Retry-After seconds, then the policy default —
  // removing the Retry-After handling turns the first wait into 30s and
  // fails this assertion (implementation-rules 1: the reverted-line check).
  assert.deepEqual(delays, [7000, DEFAULT_GRANT_RETRY.defaultRetryAfterMs]);
});

test('criterion 2: when the bounded retries are spent the outcome stays retryable, never a refusal', async () => {
  const { transport, calls } = recordingTransport(() =>
    errResponse(503, 'entitlement_unavailable', { 'retry-after': '3' }),
  );
  const { deps, delays } = rig(transport, { policy: { maxRetries: 2 } });

  const outcome = await requestGrant({ ...KEY, lock: lockFor(['stops.json']) }, deps);

  assert.equal(outcome.kind, 'unavailable');
  const unavailable = outcome as Extract<GrantOutcome, { kind: 'unavailable' }>;
  assert.equal(unavailable.retriesUsed, 2);
  // The final answer's own Retry-After is honoured for the next wait.
  assert.equal(unavailable.retryAfterMs, 3000);
  assert.deepEqual(delays, [3000, 3000]);
  assert.equal(calls.length, 3);
});

test('criterion 4: offline is a defined outcome — no exception reaches the caller', async () => {
  const { transport } = recordingTransport(() => {
    throw new Error('network down');
  });
  const { deps, diagnostics } = rig(transport);
  const outcome = await requestGrant({ ...KEY, lock: lockFor(['stops.json']) }, deps);
  assert.deepEqual(outcome, { kind: 'offline' });
  assert.deepEqual(diagnostics, ['grant:offline']);

  // A network death mid-retry-window lands offline as well — still no throw.
  let call = 0;
  const flaky = recordingTransport(() => {
    call += 1;
    if (call === 1) return errResponse(503, 'entitlement_unavailable', { 'retry-after': '1' });
    throw new Error('network down');
  });
  const flakyRig = rig(flaky.transport);
  const flakyOutcome = await requestGrant({ ...KEY, lock: lockFor(['stops.json']) }, flakyRig.deps);
  assert.deepEqual(flakyOutcome, { kind: 'offline' });
});

test('criterion 2: a corrupt success body yields diagnostics, never a grant (implementation-rules 14)', () => {
  const cases: Array<[unknown, string]> = [
    [null, 'grant-response#shape'],
    ['nope', 'grant-response#shape'],
    [{ urls: [{ path: 'a', url: 'u', expires_at: 1 }] }, 'grant-response#lock_url'],
    [{ lock_url: LOCK_URL }, 'grant-response#urls'],
    [{ lock_url: LOCK_URL, urls: [] }, 'grant-response#urls'],
    [{ lock_url: LOCK_URL, urls: [null] }, 'grant-response.urls[0]#shape'],
    [{ lock_url: LOCK_URL, urls: [{ path: 'a', url: 'u' }] }, 'grant-response.urls[0]#shape'],
    [{ lock_url: LOCK_URL, urls: [{ path: 'a', url: 'u', expires_at: 'soon' }] }, 'grant-response.urls[0]#shape'],
  ];
  for (const [body, diagnostic] of cases) {
    assert.deepEqual(parseGrantSuccess(body), { diagnostics: [diagnostic] }, JSON.stringify(body));
  }
  assert.deepEqual(parseGrantSuccess({ lock_url: LOCK_URL, urls: [{ path: 'a', url: 'u', expires_at: 1 }] }), {
    urls: { lockUrl: LOCK_URL, urls: [{ path: 'a', url: 'u', expiresAt: 1 }] },
  });
});

test('criterion 3: a URL expiring mid-download re-grants the remaining portion and continues', async () => {
  const root = tmpRoot();
  try {
    const sources: Record<string, Uint8Array> = {
      'stops.json': utf8('{"stops":[]}\n'),
      'audio/a.m4a': utf8('audio-a-bytes'),
      'audio/b.m4a': utf8('audio-b-bytes'),
    };
    const lock = await lockFrom(sources);
    const { transport, calls } = recordingTransport((call) =>
      okResponse(call.body.paths, 600_000, (p) => `/private/${p}`),
    );
    const byteLog: string[] = [];
    let expireAudio = true;
    const fetchBytes: GrantFetchDeps['fetchBytes'] = async (url) => {
      byteLog.push(url);
      const requested = url.slice('/private/'.length);
      if (requested === 'audio/a.m4a' && expireAudio) {
        expireAudio = false;
        return { status: 403, body: utf8(JSON.stringify({ error: { code: 'url_expired' } })) };
      }
      const bytes = sources[requested];
      if (!bytes) throw new Error('no bytes');
      return { status: 200, body: bytes };
    };
    const { deps: sourceDeps, diagnostics } = sourceRig(transport, fetchBytes);
    const store = createNodeDownloadStore(root);
    const fetch = createGrantFetchSource({ key: KEY, entries: parseLock(lock).entries }, sourceDeps);

    const result = await activate({ ...KEY, lock }, { store, fetch, sha256: nodeSha256, driver: openFresh() });

    assert.equal(result.status, 'complete');
    // Two grant rounds: the initial portion, then the re-grant of the
    // remaining portion starting at the expired file (criterion 3).
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0].body.paths, ['stops.json', 'audio/a.m4a', 'audio/b.m4a']);
    assert.deepEqual(calls[1].body.paths, ['audio/a.m4a', 'audio/b.m4a']);
    // The verified stops.json was fetched once and never again; the expired
    // URL cost its file one extra fetch; b continued on the re-granted window.
    assert.equal(byteLog.filter((url) => url.endsWith('stops.json')).length, 1);
    assert.equal(byteLog.filter((url) => url.endsWith('audio/a.m4a')).length, 2);
    assert.equal(byteLog.filter((url) => url.endsWith('audio/b.m4a')).length, 1);
    assert.ok(diagnostics.includes('grant-fetch:regrant url_expired'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('criterion 3: a URL nearing expiry is re-minted before the next fetch (09 §5.1)', async () => {
  const paths = ['stops.json', 'audio/a.m4a'];
  let now = 0;
  const { transport, calls } = recordingTransport((call) =>
    okResponse(call.body.paths, 600_000, (p) => `/private/${p}`),
  );
  const fetchBytes: GrantFetchDeps['fetchBytes'] = async (url) => {
    const requested = url.slice('/private/'.length);
    return { status: 200, body: utf8(`bytes:${requested}`) };
  };
  const { deps } = sourceRig(transport, fetchBytes, { now: () => now });
  const fetch = createGrantFetchSource({ key: KEY, entries: parseLock(lockFor(paths)).entries }, deps);

  await fetch('stops.json');
  assert.equal(calls.length, 1);
  now = 545_000; // 55s of TTL left — inside the 60s re-mint margin
  await fetch('audio/a.m4a');
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].body.paths, ['audio/a.m4a']);
});

test('criterion 4: offline mid-download keeps the partial state; a retry completes; no exception reaches the caller', async () => {
  const root = tmpRoot();
  try {
    const sources: Record<string, Uint8Array> = {
      'stops.json': utf8('{"stops":[]}\n'),
      'audio/a.m4a': utf8('audio-a-bytes'),
    };
    const lock = await lockFrom(sources);
    let online = false;
    const { transport } = recordingTransport((call) => {
      if (!online) throw new Error('network down');
      return okResponse(call.body.paths, 600_000, (p) => `/private/${p}`);
    });
    const fetchBytes: GrantFetchDeps['fetchBytes'] = async (url) => {
      const bytes = sources[url.slice('/private/'.length)];
      if (!bytes) throw new Error('no bytes');
      return { status: 200, body: bytes };
    };
    const driver = openFresh();
    const store = createNodeDownloadStore(root);
    const first = await activate(
      { ...KEY, lock },
      {
        store,
        fetch: createGrantFetchSource({ key: KEY, entries: parseLock(lock).entries }, sourceRig(transport, fetchBytes).deps),
        sha256: nodeSha256,
        driver,
      },
    );
    // The grant is unobtainable offline: the activation returns partial with
    // the named reason — no exception reached the caller (criterion 4), and
    // the partial state (registry rows, no final layer) is kept.
    assert.equal(first.status, 'partial');
    assert.deepEqual(
      (first as Extract<typeof first, { status: 'partial' }>).diagnostics,
      ['stops.json#fetch-failed', 'grant-fetch#grant-offline'],
    );
    assert.equal(fs.existsSync(path.join(root, layerPath(KEY))), false);
    assert.equal(getBundleAssets(driver, KEY).every((row) => row.status === 'pending'), true);

    // The network returns: a plain retry completes the same activation.
    online = true;
    const second = await activate(
      { ...KEY, lock },
      {
        store,
        fetch: createGrantFetchSource({ key: KEY, entries: parseLock(lock).entries }, sourceRig(transport, fetchBytes).deps),
        sha256: nodeSha256,
        driver,
      },
    );
    assert.equal(second.status, 'complete');
    assert.equal(getBundleAssets(driver, KEY).every((row) => row.status === 'complete'), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('criterion 2: the source refuses a path outside the layer lock — fail closed', async () => {
  const { transport, calls } = recordingTransport(() => okResponse(['stops.json']));
  const { deps } = sourceRig(transport, async () => ({ status: 200, body: utf8('x') }));
  const fetch = createGrantFetchSource({ key: KEY, entries: parseLock(lockFor(['stops.json'])).entries }, deps);
  await assert.rejects(fetch('../evil'), /grant-fetch#path-not-in-lock/);
  assert.deepEqual(calls, []);
});

test('criterion 5: no secret, token or signed URL reaches diagnostics, errors or persisted state', async () => {
  const root = tmpRoot();
  try {
    const sources: Record<string, Uint8Array> = {
      'stops.json': utf8('{"stops":[]}\n'),
      'audio/a.m4a': utf8('audio-a-bytes'),
    };
    const lock = await lockFrom(sources);

    // A worst-case transcript over three activations on one driver: an
    // offline death, a 503 retry ending in a denied file fetch, and the
    // completing retry. Every diagnostics line, error message and SQL write
    // is captured and scanned.
    const diagnostics: string[] = [];
    const sqlLog: string[] = [];
    const base = openFresh();
    const driver: SqlDriver = {
      execSql: (sql) => {
        sqlLog.push(sql);
        base.execSql(sql);
      },
      prepare: (sql) => {
        const statement: SqlStatement = base.prepare(sql);
        sqlLog.push(sql);
        return {
          run: (...params) => {
            sqlLog.push(JSON.stringify(params));
            return statement.run(...params);
          },
          get: (...params) => {
            sqlLog.push(JSON.stringify(params));
            return statement.get(...params);
          },
          all: (...params) => {
            sqlLog.push(JSON.stringify(params));
            return statement.all(...params);
          },
        };
      },
    };
    let grantCall = 0;
    const { transport } = recordingTransport(() => {
      grantCall += 1;
      if (grantCall === 1) throw new Error('network down');
      if (grantCall === 2) return errResponse(503, 'entitlement_unavailable', { 'retry-after': '1' });
      return okResponse(['stops.json', 'audio/a.m4a'], 600_000, (p) => `/private/signed-token-${p}`);
    });
    let denied = true;
    const fetchBytes: GrantFetchDeps['fetchBytes'] = async (url) => {
      const requested = url.slice('/private/signed-token-'.length);
      if (requested === 'audio/a.m4a' && denied) {
        denied = false;
        return { status: 403, body: utf8(JSON.stringify({ error: { code: 'path_not_allowed' } })) };
      }
      const bytes = sources[requested];
      if (!bytes) throw new Error('no bytes');
      return { status: 200, body: bytes };
    };
    const store = createNodeDownloadStore(root);
    const run = () =>
      activate(
        { ...KEY, lock },
        {
          store,
          fetch: createGrantFetchSource({ key: KEY, entries: parseLock(lock).entries }, sourceRig(transport, fetchBytes, {
            onDiagnostics: (line) => diagnostics.push(line),
            policy: { maxRetries: 1 },
          }).deps),
          sha256: nodeSha256,
          driver,
        },
      );

    // 1: the grant is unobtainable offline.
    const first = await run();
    assert.deepEqual(
      (first as Extract<typeof first, { status: 'partial' }>).diagnostics,
      ['stops.json#fetch-failed', 'grant-fetch#grant-offline'],
    );
    // 2: the 503 is retried, the grant lands, but the file fetch is denied —
    // the named, redacted reason surfaces in the result.
    const second = await run();
    assert.deepEqual(
      (second as Extract<typeof second, { status: 'partial' }>).diagnostics,
      ['audio/a.m4a#fetch-failed', 'grant-fetch#file-denied:path_not_allowed'],
    );
    // 3: the plain retry completes.
    const third = await run();
    assert.equal(third.status, 'complete');
    assert.ok(diagnostics.length > 0);

    const transcript = [diagnostics.join('\n'), sqlLog.join('\n')].join('\n');
    for (const leak of [SECRET, 'Bearer ', '/private/', 'signed-token']) {
      assert.ok(!transcript.includes(leak), `the transcript must not contain ${leak}`);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
