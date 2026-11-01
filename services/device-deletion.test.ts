// APR-07.a: durable deletion, provider-error and sender-serialization checks.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { deleteDeviceAccount, ensureDeviceIdentity, getLastDeviceDeletionResult } from './device.ts';
import type { SecureSecretStore } from './device.ts';
import { getAnalyticsConsent, flushAnalytics, setAnalyticsConsent } from './analytics.ts';
import { getCrashConsent, setCrashConsent } from './crash.ts';
import {
  getDeviceDeleteState, getDeviceId, getSetting, openDatabase, setDeviceId, setSetting,
  isDeviceDeletionPending,
} from './db/db.ts';
import type { SqlDriver } from './db/types.ts';
import { nodeSqliteDriver, nodeSqliteFileDriver } from './db/test-fixture.ts';
import { emitEvent } from './eventLog.ts';
import { stubGlobalFetch } from './fetch-stub-test-fixture.ts';

const BASE = 'https://fixture.functions.supabase.co/functions/v1';
const ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const SECRET = 'synthetic-only';

function store(): SecureSecretStore & { current(): string | null; failClear: boolean } {
  let saved: string | null = SECRET;
  return {
    failClear: false,
    current: () => saved,
    getSecret: async () => saved,
    saveSecret: async (s) => { saved = s; },
    clearSecret: async function () {
      if (this.failClear) throw new Error('injected SecureStore failure');
      saved = null;
    },
  };
}

function fresh(driver = nodeSqliteDriver()): SqlDriver {
  openDatabase(driver);
  setDeviceId(driver, ID);
  setAnalyticsConsent(driver, 'granted');
  setCrashConsent(driver, 'granted');
  setSetting(driver, 'language', 'be');
  emitEvent(driver, {
    eventId: 'aaaaaaaa-1111-4111-8111-111111111111', type: 'fixture', at: 1,
    schemaVersion: 1, payload: '{}',
  });
  return driver;
}

function count(driver: SqlDriver, table: string): number {
  return Number(driver.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n);
}

test('APR-07.a: completed delete preserves durable walk history, hints, caches and event sequence', async () => {
  const driver = fresh();
  const secret = store();
  driver.prepare("INSERT INTO session (session_id, route_id, version, locale, started_at, state, heard) VALUES ('walk-1', 'gda', '1', 'be', 11, 'finished', '[\"story-1\"]')").run();
  driver.prepare("INSERT INTO guide_hint_state (scope, guide_id, session_id, shown_at) VALUES ('session', 'guide-1', 'walk-1', 22)").run();
  driver.prepare("INSERT INTO guide_hint_last (guide_id, last_shown_at) VALUES ('guide-1', 22)").run();
  driver.prepare("INSERT INTO migration_log (version, applied_at, original_stop_id) VALUES (5, 22, 'legacy')").run();
  driver.prepare("INSERT INTO catalog_cache (route_id, payload) VALUES ('gda', '{}')").run();
  const nextBefore = Number(driver.prepare('SELECT next FROM event_queue_seq WHERE singleton = 1').get()?.next);
  const result = await deleteDeviceAccount({
    driver, secretStore: secret, baseUrl: BASE,
    transport: { deleteDevice: async () => ({ status: 204 }) },
  });
  assert.equal(result.remote, 'remote_confirmed');
  for (const table of ['session', 'guide_hint_state', 'guide_hint_last', 'migration_log', 'catalog_cache']) {
    assert.equal(count(driver, table), 1, table);
  }
  assert.equal(getSetting(driver, 'language'), 'be');
  assert.equal(Number(driver.prepare('SELECT next FROM event_queue_seq WHERE singleton = 1').get()?.next), nextBefore);
  assert.equal(driver.prepare("SELECT heard FROM session WHERE session_id = 'walk-1'").get()?.heard, '["story-1"]');
  emitEvent(driver, {
    eventId: 'bbbbbbbb-1111-4111-8111-111111111111', type: 'new_local', at: 3,
    schemaVersion: 1, payload: '{}',
  });
  assert.equal(await flushAnalytics(driver, async () => { throw Error('no fresh consent'); }), 0);
  assert.equal(count(driver, 'event_queue'), 1);
  assert.equal(getAnalyticsConsent(driver), null);
  assert.ok(Number(driver.prepare("SELECT enqueue_seq FROM event_queue WHERE event_id = 'bbbbbbbb-1111-4111-8111-111111111111'").get()?.enqueue_seq) >= nextBefore);
});

test('APR-07.a: interrupted SQLite cleanup keeps phase and is recoverable', async () => {
  const driver = fresh();
  const secret = store();
  const faulty: SqlDriver = {
    execSql: (sql) => driver.execSql(sql),
    prepare: (sql) => {
      if (sql === 'DELETE FROM event_queue') throw new Error('injected cleanup failure');
      return driver.prepare(sql);
    },
  };
  await assert.rejects(deleteDeviceAccount({
    driver: faulty, secretStore: secret, baseUrl: BASE,
    transport: { deleteDevice: async () => ({ status: 204 }) },
  }), /injected cleanup failure/);
  assert.equal(getDeviceDeleteState(driver), 'cleanup_remote_confirmed');
  assert.equal(secret.current(), SECRET);
  assert.equal(count(driver, 'event_queue'), 1);
  const result = await deleteDeviceAccount({
    driver, secretStore: secret, baseUrl: BASE,
    transport: { deleteDevice: async () => { throw Error('must not retry server'); } },
  });
  assert.equal(result.remote, 'remote_confirmed');
  assert.equal(count(driver, 'event_queue'), 0);
  assert.equal(secret.current(), null);
});

test('APR-07.a: malformed 204 body is not confirmation and leaves retry credentials intact', async () => {
  const driver = fresh();
  const secret = store();
  await assert.rejects(deleteDeviceAccount({
    driver, secretStore: secret, baseUrl: BASE,
    transport: { deleteDevice: async () => ({ status: 204, body: { unexpected: true } }) },
  }), { rule: 'invalid_response' });
  assert.equal(getDeviceDeleteState(driver), 'pending_remote');
  assert.equal(secret.current(), SECRET);
  assert.equal(getDeviceId(driver), ID);
});

test('APR-07.a: registration requested during deletion never creates a replacement identity', async () => {
  const driver = fresh();
  const secret = store();
  let finish!: () => void;
  const wait = new Promise<void>((resolve) => { finish = resolve; });
  let entered!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const deleting = deleteDeviceAccount({
    driver, secretStore: secret, baseUrl: BASE,
    transport: { deleteDevice: async () => { entered(); await wait; return { status: 204 }; } },
  });
  await started;
  await assert.rejects(ensureDeviceIdentity({
    driver, secretStore: secret, baseUrl: BASE,
    transport: { register: async () => { throw Error('must not register'); } },
  }), { rule: 'deletion_pending' });
  finish();
  await deleting;
  assert.equal(getDeviceId(driver), null);
});

test('APR-07.a: canonical 403 cleans locally but permanently reports remote_unverified', async () => {
  const driver = fresh();
  const secret = store();
  const result = await deleteDeviceAccount({
    driver, secretStore: secret, baseUrl: BASE,
    transport: { deleteDevice: async () => ({ status: 403, body: { error: 'device_auth_failed' } }) },
  });
  assert.deepEqual(result, { local: 'complete', remote: 'remote_unverified' });
  assert.deepEqual(getLastDeviceDeletionResult(driver), result);
  assert.equal(getDeviceDeleteState(driver), 'complete_remote_unverified');
  assert.equal(secret.current(), null);
  assert.equal(getAnalyticsConsent(driver), null);
  assert.equal(getCrashConsent(driver), null);
  assert.equal(count(driver, 'event_queue'), 0);
  assert.equal(getSetting(driver, 'language'), 'be');
});

test('APR-07.a: every noncanonical/malformed 403 keeps the only credential and pauses sending', async () => {
  for (const body of [null, '', '{', {}, { error: 'access_denied' }, { error: 'device_auth_failed', extra: 1 }]) {
    const driver = fresh();
    const secret = store();
    await assert.rejects(deleteDeviceAccount({
      driver, secretStore: secret, baseUrl: BASE,
      transport: { deleteDevice: async () => ({ status: 403, body }) },
    }), { rule: 'invalid_response' });
    assert.equal(getDeviceId(driver), ID);
    assert.equal(secret.current(), SECRET);
    assert.equal(isDeviceDeletionPending(driver), true);
    assert.equal(await flushAnalytics(driver, async () => { throw new Error('must not send'); }), 0);
    await assert.rejects(ensureDeviceIdentity({
      driver, secretStore: secret, baseUrl: BASE,
      transport: { register: async () => { throw new Error('must not register'); } },
    }), { rule: 'deletion_pending' });
  }
});

test('APR-07.a: default HTTPS transport parses 403 JSON rather than trusting status alone', async () => {
  const stub = stubGlobalFetch(async () => new Response(JSON.stringify({ error: 'unauthorized' }), {
    status: 403, headers: { 'content-type': 'application/json' },
  }));
  try {
    const driver = fresh();
    const secret = store();
    await assert.rejects(deleteDeviceAccount({ driver, secretStore: secret, baseUrl: BASE }), { rule: 'invalid_response' });
    assert.equal(secret.current(), SECRET);
    assert.equal(stub.requests.length, 1);
    assert.equal((stub.requests[0].init as RequestInit).redirect, 'error');
  } finally {
    stub.restore();
  }
});

test('APR-07.a: restart after SecureStore failure resumes cleanup without a second DELETE', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kudy-device-delete-'));
  const path = join(dir, 'local.sqlite');
  try {
    const initial = nodeSqliteFileDriver(path);
    fresh(initial.driver);
    const secret = store();
    secret.failClear = true;
    await assert.rejects(deleteDeviceAccount({
      driver: initial.driver, secretStore: secret, baseUrl: BASE,
      transport: { deleteDevice: async () => ({ status: 204, body: null }) },
    }), /injected SecureStore failure/);
    assert.equal(getDeviceDeleteState(initial.driver), 'cleanup_remote_confirmed');
    assert.equal(secret.current(), SECRET);
    initial.close();

    const restored = nodeSqliteFileDriver(path);
    secret.failClear = false;
    const identity = await ensureDeviceIdentity({
      driver: restored.driver, secretStore: secret, baseUrl: BASE,
      transport: { register: async () => ({
        status: 201, body: { device_id: ID, device_secret: 'fresh-synthetic-only' },
      }) },
    });
    assert.equal(identity.deviceSecret, 'fresh-synthetic-only');
    assert.equal(getDeviceDeleteState(restored.driver), 'complete_remote_confirmed');
    assert.deepEqual(getLastDeviceDeletionResult(restored.driver), { local: 'complete', remote: 'remote_confirmed' });
    assert.equal(getCrashConsent(restored.driver), null);
    assert.equal(getAnalyticsConsent(restored.driver), null);
    assert.equal(count(restored.driver, 'event_queue'), 0);
    assert.equal(getSetting(restored.driver, 'language'), 'be');
    restored.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('APR-07.a: failed server request persists a fail-closed barrier until explicit retry', async () => {
  const driver = fresh();
  const secret = store();
  await assert.rejects(deleteDeviceAccount({
    driver, secretStore: secret, baseUrl: BASE,
    transport: { deleteDevice: async () => { throw new Error('offline'); } },
  }), /offline/);
  assert.equal(getDeviceDeleteState(driver), 'pending_remote');
  assert.equal(secret.current(), SECRET);
  assert.equal(count(driver, 'event_queue'), 1);
  const result = await deleteDeviceAccount({
    driver, secretStore: secret, baseUrl: BASE,
    transport: { deleteDevice: async () => ({ status: 403, body: { error: 'device_auth_failed' } }) },
  });
  assert.equal(result.remote, 'remote_unverified');
  assert.equal(count(driver, 'event_queue'), 0);
});

test('APR-07.a: an in-flight analytics flush completes before deletion clears its rows', async () => {
  const driver = fresh();
  const secret = store();
  let permit!: () => void;
  const wait = new Promise<void>((resolve) => { permit = resolve; });
  let called!: () => void;
  const dispatched = new Promise<void>((resolve) => { called = resolve; });
  const flushing = flushAnalytics(driver, async () => { called(); await wait; });
  await dispatched;
  let deleteReached = false;
  const deleting = deleteDeviceAccount({
    driver, secretStore: secret, baseUrl: BASE,
    transport: { deleteDevice: async () => { deleteReached = true; return { status: 204 }; } },
  });
  await Promise.resolve();
  assert.equal(deleteReached, false, 'delete must drain the old in-flight sender');
  permit();
  await flushing;
  await deleting;
  assert.equal(deleteReached, true);
  assert.equal(count(driver, 'event_queue'), 0, 'a late sender cannot resurrect or mark new work');
  assert.equal(getAnalyticsConsent(driver), null);
});
