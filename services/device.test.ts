// G08.01 — behavioral tests for the client device identity. Each suite runs
// against the production schema (services/db migrations on node:sqlite) with
// an in-memory secret store and a scripted transport — the service logic is
// proven without a native runtime; the expo-secure-store adapter itself is a
// device-level not-run (results/G08.01.md). Reverting the single-registration
// guard, the crash-window recovery or the failure mapping in services/device.ts
// makes these tests fail (implementation-rules 1/14). G09.03 adds the
// device-delete flow: the wipe contract (criterion 1), the 403 recovery, the
// no-wipe-on-failure rule and the feedback wipe (criterion 4).
import assert from 'node:assert/strict';
import test from 'node:test';

import { getAnalyticsConsent, setAnalyticsConsent } from './analytics.ts';
import { getDeviceId, openDatabase, setDeviceId, setSetting, upsertBundleAsset } from './db/db.ts';
import type { SqlDriver } from './db/types.ts';
import { nodeSqliteDriver } from './db/test-fixture.ts';
import {
  deleteDeviceAccount,
  DeviceError,
  ensureDeviceIdentity,
  type DeviceDeleteTransport,
  type SecureSecretStore,
} from './device.ts';
import { stubGlobalFetch } from './fetch-stub-test-fixture.ts';
import { emitEvent } from './eventLog.ts';
import { eventFactory, openFreshEventStore } from './eventLog-test-fixture.ts';

interface Registration {
  device_id: string;
  device_secret: string;
}

const REGISTRATION: Registration = {
  device_id: '3f2a1c9e-8b7d-4c2a-9d1e-6f5a4b3c2d1e',
  // Low-entropy on purpose: an obviously synthetic fixture (gitleaks flags
  // high-entropy literals near credential keywords, and this is not a secret).
  device_secret: 'synthetic-device-secret-fixture',
};

function memorySecretStore(): SecureSecretStore & { saved(): string | null; readonly saves: number; readonly clears: number } {
  const state = { value: null as string | null, saves: 0, clears: 0 };
  return {
    get saves() {
      return state.saves;
    },
    get clears() {
      return state.clears;
    },
    getSecret: async () => state.value,
    saveSecret: async (next) => {
      state.value = next;
      state.saves += 1;
    },
    clearSecret: async () => {
      state.value = null;
      state.clears += 1;
    },
    saved: () => state.value,
  };
}

function scriptedTransport(responses: Array<{ status: number; body: unknown } | Error>) {
  const calls: string[] = [];
  return {
    calls,
    transport: {
      register: async (baseUrl: string) => {
        calls.push(baseUrl);
        const next = responses[calls.length - 1];
        if (!next) throw new Error('unexpected extra registration call');
        if (next instanceof Error) throw next;
        return next;
      },
    },
  };
}

function depsFor(store: SecureSecretStore, transport: { register: (b: string) => Promise<{ status: number; body: unknown }> }) {
  const driver = nodeSqliteDriver();
  openDatabase(driver);
  return { driver, secretStore: store, baseUrl: 'https://example.functions.supabase.co/functions/v1', transport };
}

test('first ensure registers once, saves the secret and writes the device_id row', async () => {
  const store = memorySecretStore();
  const { transport, calls } = scriptedTransport([{ status: 201, body: REGISTRATION }]);
  const deps = depsFor(store, transport);
  const identity = await ensureDeviceIdentity({ ...deps });
  assert.equal(identity.deviceId, REGISTRATION.device_id);
  assert.equal(identity.deviceSecret, REGISTRATION.device_secret);
  assert.deepEqual(calls, ['https://example.functions.supabase.co/functions/v1']);
  assert.equal(store.saved(), REGISTRATION.device_secret);
  assert.equal(getDeviceId(deps.driver), REGISTRATION.device_id);
  assert.equal(store.saves, 1);
  assert.equal(store.clears, 0);
});

test('second ensure reuses the stored identity without a second registration', async () => {
  const store = memorySecretStore();
  const { transport, calls } = scriptedTransport([{ status: 201, body: REGISTRATION }]);
  const deps = depsFor(store, transport);
  const first = await ensureDeviceIdentity({ ...deps });
  const second = await ensureDeviceIdentity({ ...deps });
  assert.deepEqual(second, first);
  assert.equal(calls.length, 1);
  assert.equal(store.saves, 1);
});

test('concurrent ensure registers exactly once (React double-mount)', async () => {
  const store = memorySecretStore();
  const { transport, calls } = scriptedTransport([{ status: 201, body: REGISTRATION }]);
  const deps = depsFor(store, transport);
  const [a, b] = await Promise.all([
    ensureDeviceIdentity({ ...deps }),
    ensureDeviceIdentity({ ...deps }),
  ]);
  assert.deepEqual(b, a, 'both callers must receive the same identity');
  assert.equal(calls.length, 1, 'the transport must be hit a single time');
  assert.equal(store.saves, 1);
  assert.equal(getDeviceId(deps.driver), REGISTRATION.device_id);
});

test('crash window: row without secret re-registers and overwrites the row', async () => {
  const store = memorySecretStore();
  const { transport } = scriptedTransport([{ status: 201, body: REGISTRATION }]);
  const deps = depsFor(store, transport);
  // Crash aftermath: the row exists but the secret was never saved.
  setDeviceIdForTest(deps.driver, 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
  const identity = await ensureDeviceIdentity({ ...deps });
  assert.equal(identity.deviceId, REGISTRATION.device_id);
  assert.equal(identity.deviceSecret, REGISTRATION.device_secret);
  assert.equal(getDeviceId(deps.driver), REGISTRATION.device_id, 'stale row must be replaced');
  assert.equal(store.saved(), REGISTRATION.device_secret);
  assert.equal(store.clears, 1);
});

test('crash window: secret without row re-registers and overwrites the secret', async () => {
  const store = memorySecretStore();
  const { transport } = scriptedTransport([{ status: 201, body: REGISTRATION }]);
  const deps = depsFor(store, transport);
  // Crash aftermath: the secret was saved but the process died before the row.
  await store.saveSecret('stale-secret-from-a-dead-registration');
  const identity = await ensureDeviceIdentity({ ...deps });
  assert.equal(identity.deviceId, REGISTRATION.device_id);
  assert.equal(store.saved(), REGISTRATION.device_secret, 'stale secret must be replaced');
  assert.equal(getDeviceId(deps.driver), REGISTRATION.device_id);
});

test('429 surfaces as rate_limited and stores nothing', async () => {
  const store = memorySecretStore();
  const { transport } = scriptedTransport([{ status: 429, body: { error: 'rate_limited' } }]);
  const deps = depsFor(store, transport);
  await assert.rejects(
    ensureDeviceIdentity({ ...deps }),
    (error: unknown) => error instanceof DeviceError && error.rule === 'rate_limited',
  );
  assert.equal(store.saved(), null);
  assert.equal(getDeviceId(deps.driver), null);
});

test('non-201 status surfaces as server_error and stores nothing', async () => {
  const store = memorySecretStore();
  const { transport } = scriptedTransport([{ status: 500, body: { error: 'server_error' } }]);
  const deps = depsFor(store, transport);
  await assert.rejects(
    ensureDeviceIdentity({ ...deps }),
    (error: unknown) => error instanceof DeviceError && error.rule === 'server_error',
  );
  assert.equal(store.saved(), null);
  assert.equal(getDeviceId(deps.driver), null);
});

test('malformed responses surface as invalid_response and store nothing', async () => {
  const cases: unknown[] = [
    null,
    {},
    { device_id: 'not-a-uuid', device_secret: 'x' },
    { device_id: REGISTRATION.device_id },
    { device_id: REGISTRATION.device_id, device_secret: '' },
  ];
  for (const body of cases) {
    const store = memorySecretStore();
    const { transport } = scriptedTransport([{ status: 201, body }]);
    const deps = depsFor(store, transport);
    await assert.rejects(
      ensureDeviceIdentity({ ...deps }),
      (error: unknown) => error instanceof DeviceError && error.rule === 'invalid_response',
      JSON.stringify(body),
    );
    assert.equal(store.saved(), null, 'nothing may be stored for a malformed response');
    assert.equal(getDeviceId(deps.driver), null);
  }
});

test('network failure surfaces as network_failed and stores nothing', async () => {
  const store = memorySecretStore();
  const { transport } = scriptedTransport([new DeviceError('network_failed', 'offline')]);
  const deps = depsFor(store, transport);
  await assert.rejects(
    ensureDeviceIdentity({ ...deps }),
    (error: unknown) => error instanceof DeviceError && error.rule === 'network_failed',
  );
  assert.equal(store.saved(), null);
  assert.equal(getDeviceId(deps.driver), null);
});

// Test-local helper: writes the crash-aftermath row directly through the
// production write path (services/db owns the transaction).
function setDeviceIdForTest(driver: Parameters<typeof getDeviceId>[0], deviceId: string): void {
  setDeviceId(driver, deviceId);
}

// G20.06 — network-privacy N3: the production default transport validates
// the endpoint before the network and refuses redirects. These suites stub
// the platform fetch (services/fetch-stub-test-fixture — the network
// boundary, not the code under test) and drive the real defaultTransport —
// reverting the validation, the redirect option or the redirected-response
// guard makes them fail (implementation-rules 1/15).

test('G20.06 N3: http, malformed and credential URLs are rejected before any network call', async () => {
  const stub = stubGlobalFetch(async () => {
    throw new Error('the network must not be reached for an unvalidated endpoint');
  });
  try {
    for (const baseUrl of ['http://example.invalid/functions/v1', 'not a url at all', 'https://user:pass@example.invalid/functions/v1']) {
      const store = memorySecretStore();
      const driver = openFreshEventStore();
      await assert.rejects(
        ensureDeviceIdentity({ driver, secretStore: store, baseUrl }),
        (error: unknown) => error instanceof DeviceError && error.rule === 'unsafe_endpoint',
        baseUrl,
      );
      assert.equal(store.saved(), null, 'no secret may be requested or stored for an unsafe endpoint');
      assert.equal(getDeviceId(driver), null);
    }
    assert.equal(stub.requests.length, 0, 'unsafe endpoints must make zero network calls');
  } finally {
    stub.restore();
  }
});

test('G20.06 N3: a valid configured https endpoint registers through the default transport with redirect refused', async () => {
  const stub = stubGlobalFetch(async () =>
    new Response(JSON.stringify(REGISTRATION), { status: 201, headers: { 'content-type': 'application/json' } }));
  try {
    const store = memorySecretStore();
    const identity = await ensureDeviceIdentity({
      driver: openFreshEventStore(),
      secretStore: store,
      baseUrl: 'https://example.functions.supabase.co/functions/v1',
    });
    assert.equal(identity.deviceSecret, REGISTRATION.device_secret);
    assert.equal(stub.requests.length, 1);
    assert.equal(
      (stub.requests[0].init as RequestInit | undefined)?.redirect,
      'error',
      'the secret-bearing request must run with redirect: error',
    );
    assert.equal(store.saved(), REGISTRATION.device_secret);
  } finally {
    stub.restore();
  }
});

test('G20.06 N3: when the platform refuses the redirect, registration fails closed with network_failed', async () => {
  const stub = stubGlobalFetch(async () => {
    throw new TypeError('the redirect was refused by redirect: error');
  });
  try {
    const store = memorySecretStore();
    await assert.rejects(
      ensureDeviceIdentity({
        driver: openFreshEventStore(),
        secretStore: store,
        baseUrl: 'https://example.functions.supabase.co/functions/v1',
      }),
      (error: unknown) => error instanceof DeviceError && error.rule === 'network_failed',
    );
    assert.equal((stub.requests[0].init as RequestInit | undefined)?.redirect, 'error');
    assert.equal(store.saved(), null);
  } finally {
    stub.restore();
  }
});

test('G20.06 N3: a response redirected away from the endpoint is not accepted', async () => {
  // A worst-case platform that followed the redirect despite the option:
  // the final response claims the registration body but from a foreign URL.
  const redirected = {
    status: 201,
    url: 'https://attacker.example/functions/v1/device',
    text: async () => JSON.stringify(REGISTRATION),
  } as unknown as Response;
  const stub = stubGlobalFetch(async () => redirected);
  try {
    const store = memorySecretStore();
    await assert.rejects(
      ensureDeviceIdentity({
        driver: openFreshEventStore(),
        secretStore: store,
        baseUrl: 'https://example.functions.supabase.co/functions/v1',
      }),
      (error: unknown) => error instanceof DeviceError && error.rule === 'unsafe_endpoint' && /redirect/.test(error.message),
    );
    assert.equal(stub.requests.length, 1, 'our code must not start a second authorized request after the redirect');
    assert.equal(store.saved(), null, 'a secret delivered by a redirected response must never be stored');
  } finally {
    stub.restore();
  }
});

// G20.10 (issue #481): the default transport's registration wait is finite —
// a stalled endpoint answers network_failed at the deadline and the failed
// registration persists no fabricated secret or identity.
test('G20.10 stalled_device_no_identity: an unresolved registration stores nothing', async () => {
  const store = memorySecretStore();
  const driver = nodeSqliteDriver();
  openDatabase(driver);
  const stub = stubGlobalFetch(
    () =>
      new Promise<Response>(() => {
        // never resolves — the stalled registration endpoint
      }),
  );
  try {
    await assert.rejects(
      ensureDeviceIdentity({ driver, secretStore: store, baseUrl: 'https://example.functions.supabase.co/functions/v1', waitLimitMs: 25 }),
      (error: DeviceError) => {
        assert.equal(error.rule, 'network_failed');
        return true;
      },
    );
    // Nothing was fabricated: no secret saved or cleared into a new value,
    // no device_id row.
    assert.equal(store.saves, 0);
    assert.equal(getDeviceId(driver), null);
  } finally {
    stub.restore();
  }
});

// --- G09.03 — device data deletion (DELETE /v1/device) ---

const DELETE_BASE = 'https://example.functions.supabase.co/functions/v1';
const event = eventFactory('33333333-3333-4333-8333-');

function scriptedDeleteTransport(responses: Array<{ status: number } | Error>) {
  const calls: string[] = [];
  const transport: DeviceDeleteTransport = {
    deleteDevice: async (baseUrl, secret) => {
      calls.push(`${baseUrl}|${secret}`);
      const next = responses[calls.length - 1];
      if (!next) throw new Error('unexpected extra delete call');
      if (next instanceof Error) throw next;
      return next;
    },
  };
  return { calls, transport };
}

// Seeds every piece of durable state the delete must clear, plus the pieces
// it must keep: a downloaded bundle (zone A) and an unrelated settings row.
function seedAccountState(driver: SqlDriver): void {
  setDeviceId(driver, REGISTRATION.device_id);
  setAnalyticsConsent(driver, 'granted');
  emitEvent(driver, event());
  driver
    .prepare("INSERT INTO feedback_local (target, revision, score, state) VALUES ('guide:gda-1:1:be', 2, 4, 'sent')")
    .run();
  driver
    .prepare(
      "INSERT INTO feedback_outbox (mutation_id, target, expected_revision, payload, disclosure_version, created_at, transport_state) VALUES ('mut-1', 'guide:gda-1:1:be', 2, '{}', '1', 1700000000000, 'pending')",
    )
    .run();
  upsertBundleAsset(driver, {
    routeId: 'gda-1',
    version: '1',
    locale: 'be',
    tier: 'base',
    path: 'audio/01.mp3',
    status: 'complete',
    bytesTotal: 10,
    bytesDone: 10,
    sha256: 'fixture',
  });
  setSetting(driver, 'unrelated_setting', 'keep');
}

function rowCount(driver: SqlDriver, table: string): number {
  const row = driver.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number } | undefined;
  return Number(row!.n);
}

function expectWiped(driver: SqlDriver, store: SecureSecretStore & { saved(): string | null }): void {
  assert.equal(getDeviceId(driver), null, 'the device row is gone');
  assert.equal(store.saved(), null, 'the device secret is cleared');
  assert.equal(getAnalyticsConsent(driver), null, 'the consent state is back to never-asked');
  assert.equal(rowCount(driver, 'event_queue'), 0, 'the local event queue is wiped');
  assert.equal(rowCount(driver, 'feedback_local'), 0, 'the feedback state is wiped (criterion 4)');
  assert.equal(rowCount(driver, 'feedback_outbox'), 0, 'the old outbox never restores the feedback');
}

function expectUntouched(driver: SqlDriver, store: SecureSecretStore & { saved(): string | null }): void {
  assert.equal(getDeviceId(driver), REGISTRATION.device_id);
  assert.equal(store.saved(), REGISTRATION.device_secret);
  assert.equal(getAnalyticsConsent(driver), 'granted');
  assert.equal(rowCount(driver, 'event_queue'), 1, 'the queue survives a failed delete');
  assert.equal(rowCount(driver, 'feedback_local'), 1);
  assert.equal(rowCount(driver, 'feedback_outbox'), 1);
  assert.equal(rowCount(driver, 'bundle_asset'), 1, 'downloads are never touched by the delete flow');
  assert.equal(rowCount(driver, 'settings'), 2, 'the unrelated setting survives');
}

test('G09.03: 204 wipes queue, consent, feedback tables, device row and secret — downloads stay (criterion 1)', async () => {
  const store = memorySecretStore();
  await store.saveSecret(REGISTRATION.device_secret);
  const driver = nodeSqliteDriver();
  openDatabase(driver);
  seedAccountState(driver);
  const { transport, calls } = scriptedDeleteTransport([{ status: 204 }]);

  await deleteDeviceAccount({ driver, secretStore: store, baseUrl: DELETE_BASE, transport });

  assert.deepEqual(calls, [`${DELETE_BASE}|${REGISTRATION.device_secret}`], 'the bearer goes to DELETE /v1/device');
  expectWiped(driver, store);
  assert.equal(rowCount(driver, 'bundle_asset'), 1, 'downloaded bundles stay (09 §5)');
  const kept = driver.prepare('SELECT value FROM settings').get() as { value: string };
  assert.equal(kept.value, 'keep', 'the settings wipe is consent-key scoped');
});

test('G09.03: 403 — an already-deleted device (a lost 204) still completes the local wipe', async () => {
  const store = memorySecretStore();
  await store.saveSecret(REGISTRATION.device_secret);
  const driver = nodeSqliteDriver();
  openDatabase(driver);
  seedAccountState(driver);
  const { transport } = scriptedDeleteTransport([{ status: 403 }]);

  await deleteDeviceAccount({ driver, secretStore: store, baseUrl: DELETE_BASE, transport });

  expectWiped(driver, store);
  assert.equal(rowCount(driver, 'bundle_asset'), 1);
});

test('G09.03: a network failure wipes nothing — the retry is safe', async () => {
  const store = memorySecretStore();
  await store.saveSecret(REGISTRATION.device_secret);
  const driver = nodeSqliteDriver();
  openDatabase(driver);
  seedAccountState(driver);
  const { transport } = scriptedDeleteTransport([new DeviceError('network_failed', 'offline')]);

  await assert.rejects(
    deleteDeviceAccount({ driver, secretStore: store, baseUrl: DELETE_BASE, transport }),
    (error: unknown) => error instanceof DeviceError && error.rule === 'network_failed',
  );

  expectUntouched(driver, store);
  assert.equal(rowCount(driver, 'device'), 1);
});

test('G09.03: a server fault (500) wipes nothing', async () => {
  const store = memorySecretStore();
  await store.saveSecret(REGISTRATION.device_secret);
  const driver = nodeSqliteDriver();
  openDatabase(driver);
  seedAccountState(driver);
  const { transport } = scriptedDeleteTransport([{ status: 500 }]);

  await assert.rejects(
    deleteDeviceAccount({ driver, secretStore: store, baseUrl: DELETE_BASE, transport }),
    (error: unknown) => error instanceof DeviceError && error.rule === 'server_error',
  );

  expectUntouched(driver, store);
});

test('G09.03: no secret — the wipe runs locally, with no server call and no re-registration', async () => {
  const store = memorySecretStore();
  const driver = nodeSqliteDriver();
  openDatabase(driver);
  seedAccountState(driver);
  const { transport, calls } = scriptedDeleteTransport([{ status: 204 }]);

  await deleteDeviceAccount({ driver, secretStore: store, baseUrl: DELETE_BASE, transport });

  assert.deepEqual(calls, [], 'nothing to authenticate — no server call');
  expectWiped(driver, store);
});
