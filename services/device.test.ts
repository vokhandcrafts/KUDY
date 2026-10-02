// G08.01 — behavioral tests for the client device identity. Each suite runs
// against the production schema (services/db migrations on node:sqlite) with
// an in-memory secret store and a scripted transport — the service logic is
// proven without a native runtime; the expo-secure-store adapter itself is a
// device-level not-run (results/G08.01.md). Reverting the single-registration
// guard, the crash-window recovery or the failure mapping in services/device.ts
// makes these tests fail (implementation-rules 1/14).
import assert from 'node:assert/strict';
import test from 'node:test';

import { getDeviceId, openDatabase, setDeviceId } from './db/db.ts';
import { nodeSqliteDriver } from './db/test-fixture.ts';
import { DeviceError, ensureDeviceIdentity, type SecureSecretStore } from './device.ts';
import { stubGlobalFetch } from './fetch-stub-test-fixture.ts';
import { openFreshEventStore } from './eventLog-test-fixture.ts';

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
