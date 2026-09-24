// G04.04.b — acceptance suite for the guarded package deletion (issue #194).
// Criteria:
// 1. a version pinned by a non-finished session (active or paused) is refused
//    with the named reason; after End the same deletion succeeds;
// 2. only the package directory and its bundle_asset rows (zone A) are
//    removed; zone B is byte-identical before and after; a foreign package
//    survives untouched;
// 3. nothing touches entitlement or the grant client — the deleted layer
//    re-downloads through requestGrant() on the transport fake, one granted
//    request, no purchase path;
// 4. a deletion completing during an in-flight download of the same package
//    cancels it (named 'cancelled'), staging is gone and no half-deleted
//    ready state remains; staging leftovers of an interrupted download are
//    cancelled with the package; a fresh download works afterwards;
// 5. the deletion path is built only from validated segments; ids with '..'
//    or separators are refused before any filesystem call.
// Proof: remove the pinned-version guard → tests 1–2 fail; remove the gate
// mark or a pre-rename gate check → the mid-flight test fails.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { activate, layerPath, packagePath, stagingLayerPath, stagingVersionPath } from './download.ts';
import { createDeletionGate, deletePackage } from './delete.ts';
import { requestGrant, type GrantRequestBody, type GrantTransport } from './grant.ts';
import { depsFor, GOOD, lockFrom, openFresh, recordingStore, snapshotDir, STOPS } from './test-fixture.ts';
import { finishSession, getBundleAssets, pauseSession, startSession } from '../db/db.ts';
import { ZONE_B_TABLES } from '../db/schema.ts';
import type { SqlDriver } from '../db/types.ts';
import type { ActivationResult, DeleteDeps, DeleteResult, LayerKey, PackageKey } from './types.ts';

const PACKAGE: PackageKey = { routeId: 'route-x', version: '1' };
const KEY: LayerKey = { ...PACKAGE, locale: 'be', tier: 'base' };
const KEY_EN: LayerKey = { ...PACKAGE, locale: 'en', tier: 'extended' };
const FOREIGN: PackageKey = { routeId: 'route-y', version: '1' };
const KEY_FOREIGN: LayerKey = { ...FOREIGN, locale: 'be', tier: 'base' };
const SID = '11111111-1111-4111-8111-111111111111';
const STARTED_AT = 1_700_000_000_000;

const tmpRoot = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'g0404b-'));

// The delete deps over the shared rig's store and driver, with the test's
// gate instance — the same object the mid-flight activation receives.
function deleteDeps(root: string, driver: SqlDriver, gate: DeleteDeps['gate']): DeleteDeps {
  const { deps } = depsFor(root, { driver });
  return { store: deps.store, driver, gate };
}

// Every zone B table dumped as JSON — the byte-identity proof of criterion 2
// (a deletion may not move a durable row by a byte).
function zoneBSnapshot(driver: SqlDriver): string {
  return JSON.stringify(
    ZONE_B_TABLES.map((table) => ({
      table,
      rows: driver.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
    })),
  );
}

const refusedOf = (result: DeleteResult): Extract<DeleteResult, { status: 'refused' }> => {
  assert.equal(result.status, 'refused');
  return result as Extract<DeleteResult, { status: 'refused' }>;
};

const activated = async (result: Promise<ActivationResult>): Promise<Extract<ActivationResult, { status: 'complete' }>> => {
  const done = await result;
  assert.equal(done.status, 'complete');
  return done as Extract<ActivationResult, { status: 'complete' }>;
};

test('criterion 1: an active session pins its version — refused with the reason; after End the same deletion succeeds', async () => {
  const root = tmpRoot();
  try {
    const driver = openFresh();
    startSession(driver, { sessionId: SID, routeId: PACKAGE.routeId, version: PACKAGE.version, locale: KEY.locale, startedAt: STARTED_AT });
    const gate = createDeletionGate();
    const deps = deleteDeps(root, driver, gate);

    const refused = refusedOf(await deletePackage(PACKAGE, deps));
    assert.deepEqual(refused, {
      status: 'refused',
      key: PACKAGE,
      reason: 'pinned-by-unfinished-session',
      sessionIds: [SID],
    });

    // The refusal never armed the gate: a download of the package runs to
    // completion while the session stays live (the mark happens only after
    // the guard passes).
    const lock = await lockFrom(GOOD);
    const { deps: rig } = depsFor(root, { driver });
    await activated(activate({ ...KEY, lock }, { ...rig, cancel: gate }));

    // End the walk (the real finish transaction, not a hand-made row): the
    // same deletion now succeeds.
    finishSession(driver, SID, { finishedAt: STARTED_AT + 60_000 });
    const done = await deletePackage(PACKAGE, deps);
    assert.equal(done.status, 'deleted');
    assert.equal((done as Extract<DeleteResult, { status: 'deleted' }>).removedAssetRows, 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('criterion 1: a paused session pins too; a session of another version does not', async () => {
  const root = tmpRoot();
  try {
    const driver = openFresh();
    startSession(driver, { sessionId: SID, routeId: PACKAGE.routeId, version: PACKAGE.version, locale: KEY.locale, startedAt: STARTED_AT });
    pauseSession(driver, SID);
    const gate = createDeletionGate();

    const paused = refusedOf(await deletePackage(PACKAGE, deleteDeps(root, driver, gate)));
    assert.deepEqual(paused.sessionIds, [SID]);

    // The pin is per version (ADR G01.03 §3.4: «з гэтай версіяй»): finish the
    // paused walk, start a live walk of version 2 — it never blocks the
    // cleanup of version 1.
    finishSession(driver, SID, { finishedAt: STARTED_AT + 60_000 });
    startSession(driver, {
      sessionId: '22222222-2222-4222-8222-222222222222',
      routeId: PACKAGE.routeId,
      version: '2',
      locale: KEY.locale,
      startedAt: STARTED_AT + 1,
    });
    const done = await deletePackage({ ...PACKAGE }, deleteDeps(root, driver, gate));
    assert.equal(done.status, 'deleted');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('criterion 2: only the package directory and its zone A rows are removed; zone B is byte-identical; a foreign package survives', async () => {
  const root = tmpRoot();
  try {
    const driver = openFresh();
    // Zone B seeds: a finished walk of the package (history, never deleted),
    // a setting, an analytics event and a foreground guide hint.
    startSession(driver, { sessionId: SID, routeId: PACKAGE.routeId, version: PACKAGE.version, locale: KEY.locale, startedAt: STARTED_AT });
    finishSession(driver, SID, { finishedAt: STARTED_AT + 60_000 });
    driver.prepare("INSERT INTO settings (key, value) VALUES ('analytics_consent', 'granted')").run();
    driver
      .prepare(
        "INSERT INTO event_queue (event_id, type, at, schema_version, payload, sent) VALUES ('evt-1', 'session_started', 1, 1, '{}', 0)",
      )
      .run();
    driver
      .prepare("INSERT INTO guide_hint_state (scope, guide_id, session_id, shown_at) VALUES ('foreground', 'guide-1', NULL, 5)")
      .run();
    const zoneB = zoneBSnapshot(driver);

    // The package with two layers (both locales) and a foreign package with
    // one, all activated through the real path.
    const lock = await lockFrom(GOOD);
    const { deps } = depsFor(root, { driver });
    await activated(activate({ ...KEY, lock }, deps));
    await activated(activate({ ...KEY_EN, lock }, deps));
    await activated(activate({ ...KEY_FOREIGN, lock }, deps));
    const foreignFiles = snapshotDir(root, packagePath(FOREIGN.routeId, FOREIGN.version));

    const done = await deletePackage(PACKAGE, { store: deps.store, driver, gate: createDeletionGate() });
    assert.equal(done.status, 'deleted');
    assert.equal((done as Extract<DeleteResult, { status: 'deleted' }>).removedAssetRows, 4);

    // Both layers of the deleted package are gone from the disk — the final
    // directories and any staging tree of the same version — and from the
    // registry; the foreign package did not move by a byte or a row.
    assert.equal(fs.existsSync(path.join(root, packagePath(PACKAGE.routeId, PACKAGE.version))), false);
    assert.equal(fs.existsSync(path.join(root, stagingVersionPath(PACKAGE.routeId, PACKAGE.version))), false);
    assert.deepEqual(getBundleAssets(driver, KEY), []);
    assert.deepEqual(getBundleAssets(driver, KEY_EN), []);
    assert.deepEqual(snapshotDir(root, packagePath(FOREIGN.routeId, FOREIGN.version)), foreignFiles);
    assert.equal(getBundleAssets(driver, KEY_FOREIGN).length, 2);

    // Zone B is byte-identical: the finished session, the setting, the event
    // and the hint all survived.
    assert.equal(zoneBSnapshot(driver), zoneB);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('criterion 3: the deleted layer re-downloads through requestGrant — one granted request, no purchase path', async () => {
  const root = tmpRoot();
  try {
    const driver = openFresh();
    const gate = createDeletionGate();
    const { deps } = depsFor(root, { driver });
    const lock = await lockFrom(GOOD);
    await activated(activate({ ...KEY, lock }, deps));

    const done = await deletePackage(PACKAGE, { store: deps.store, driver, gate });
    assert.equal(done.status, 'deleted');

    // The transport fake is created after the deletion, so its log can only
    // carry the re-download request — the deletion itself called nothing.
    const requests: GrantRequestBody[] = [];
    const transport: GrantTransport = async (request) => {
      requests.push(request.body);
      return {
        status: 200,
        headers: {},
        body: {
          lock_url: 'https://cdn.test/lock',
          urls: Object.keys(GOOD).map((grantPath) => ({
            path: grantPath,
            url: `https://cdn.test/${grantPath}`,
            expires_at: 4_000_000_000_000,
          })),
        },
      };
    };
    const outcome = await requestGrant({ ...KEY, lock }, {
      transport,
      credential: async () => 'device-secret',
      delay: async () => {},
    });
    // A granted outcome through the same entitlement — not the no_entitlement
    // purchase path: deleting a bought layer never revokes or re-charges it.
    assert.equal(outcome.kind, 'granted');
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0], {
      route_id: PACKAGE.routeId,
      version: PACKAGE.version,
      locale: KEY.locale,
      tier: KEY.tier,
      paths: ['stops.json', 'audio/story-1.m4a'],
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('criterion 4: a deletion completing during an in-flight download cancels it — no half-deleted ready state remains', async () => {
  const root = tmpRoot();
  try {
    const driver = openFresh();
    const gate = createDeletionGate();
    const { deps, fetchLog } = depsFor(root, { driver });

    // The transfer parks inside the first fetch until the test releases it,
    // so the deletion deterministically completes mid-download.
    let release: ((bytes: Uint8Array) => void) | null = null;
    const parked = new Promise<Uint8Array>((resolve) => {
      release = resolve;
    });
    const realFetch = deps.fetch;
    let calls = 0;
    deps.fetch = async (rel) => {
      calls += 1;
      if (calls === 1) return parked;
      return realFetch(rel);
    };

    const lock = await lockFrom(GOOD);
    const pending = activate({ ...KEY, lock }, { ...deps, cancel: gate });
    // The wrapper's own counter (the parked call never reaches the rig's
    // fetchLog): nonzero as soon as activate() reaches the transfer.
    while (calls === 0) await new Promise((resolve) => setImmediate(resolve));

    const done = await deletePackage(PACKAGE, { store: deps.store, driver, gate });
    assert.equal(done.status, 'deleted');

    release!(STOPS);
    const cancelled = await pending;
    assert.equal(cancelled.status, 'cancelled');
    assert.equal((cancelled as Extract<ActivationResult, { status: 'cancelled' }>).fetched, 0);

    // Nothing survived the race: no final layer, no staging tree, no
    // registry rows — the download did not resurrect a deleted package.
    assert.equal(fs.existsSync(path.join(root, layerPath(KEY))), false);
    assert.equal(fs.existsSync(path.join(root, stagingVersionPath(PACKAGE.routeId, PACKAGE.version))), false);
    assert.deepEqual(getBundleAssets(driver, KEY), []);

    // The gate is an epoch, not a tombstone: a fresh download of the same
    // package through the same gate runs to completion.
    await activated(activate({ ...KEY, lock }, { ...deps, cancel: gate }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('criterion 4: staging leftovers of an interrupted download are cancelled with the package', async () => {
  const root = tmpRoot();
  try {
    const driver = openFresh();
    const { deps } = depsFor(root, { driver });
    const realFetch = deps.fetch;
    let calls = 0;
    deps.fetch = async (rel) => {
      calls += 1;
      if (calls === 2) throw new Error('connection lost');
      return realFetch(rel);
    };
    const partial = await activate({ ...KEY, lock: await lockFrom(GOOD) }, deps);
    assert.equal(partial.status, 'partial');
    // The interrupted download's disk state: one verified staging file.
    assert.equal(fs.existsSync(path.join(root, stagingLayerPath(KEY), 'stops.json')), true);

    const done = await deletePackage(PACKAGE, { store: deps.store, driver, gate: createDeletionGate() });
    assert.equal(done.status, 'deleted');
    assert.equal(fs.existsSync(path.join(root, stagingVersionPath(PACKAGE.routeId, PACKAGE.version))), false);
    assert.equal(fs.existsSync(path.join(root, packagePath(PACKAGE.routeId, PACKAGE.version))), false);
    assert.deepEqual(getBundleAssets(driver, KEY), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('criterion 5: unsafe ids are refused with named diagnostics before any filesystem call', async () => {
  const root = tmpRoot();
  try {
    const driver = openFresh();
    const { deps } = depsFor(root, { driver });
    const { store: spy, calls } = recordingStore(deps.store);
    const unsafePackages: Array<[PackageKey, string[]]> = [
      [{ routeId: '../evil', version: '1' }, ['route_id#unsafe-path:../evil']],
      [{ routeId: 'route-x', version: 'a/b' }, ['version#unsafe-path:a/b']],
      [{ routeId: 'route-x', version: '..' }, ['version#unsafe-path:..']],
      [{ routeId: 'route-x', version: '' }, ['version#unsafe-path:']],
      [{ routeId: 'route-x', version: '1\u0000x' }, ['version#unsafe-path:1\u0000x']],
    ];
    for (const [key, diagnostics] of unsafePackages) {
      const result = await deletePackage(key, { store: spy, driver, gate: createDeletionGate() });
      assert.equal(result.status, 'invalid-input', `${JSON.stringify(key)} must be diagnosed`);
      assert.deepEqual((result as Extract<DeleteResult, { status: 'invalid-input' }>).diagnostics, diagnostics);
    }
    // Validation ran before the first filesystem call: nothing was touched.
    assert.deepEqual(calls, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('deleting a package that was never downloaded is still deleted (idempotent)', async () => {
  const root = tmpRoot();
  try {
    const driver = openFresh();
    const done = await deletePackage(PACKAGE, deleteDeps(root, driver, createDeletionGate()));
    assert.deepEqual(done, { status: 'deleted', key: PACKAGE, removedAssetRows: 0 });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
