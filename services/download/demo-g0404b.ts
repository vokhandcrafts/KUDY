// G04.04.b demo — the guarded package deletion. Prints verdicts only (no
// paths, no timings); the bundles tree lives in a fresh temp directory and is
// removed afterwards.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { activate } from './download.ts';
import { createDeletionGate, deletePackage } from './delete.ts';
import { requestGrant, type GrantTransport } from './grant.ts';
import { depsFor, GOOD, lockFrom } from './test-fixture.ts';
import { finishSession, startSession } from '../db/db.ts';
import { ZONE_B_TABLES } from '../db/schema.ts';
import type { SqlDriver } from '../db/types.ts';

const SID = '11111111-1111-4111-8111-111111111111';
const KEY = { routeId: 'route-x', version: '1', locale: 'be', tier: 'base' } as const;

// The byte-identity witness of zone B: every durable table dumped as one
// string — the deletion may not move a durable row by a byte.
function zoneBFingerprint(driver: SqlDriver): string {
  return ZONE_B_TABLES.map((table) => JSON.stringify(driver.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all())).join('|');
}

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'g0404b-demo-'));
  const gate = createDeletionGate();
  const { deps } = depsFor(root);
  const lock = await lockFrom(GOOD);
  await activate({ ...KEY, lock }, deps);
  const driver = deps.driver;

  // 1. A live walk pins the version: the deletion is refused with its reason.
  startSession(driver, { sessionId: SID, routeId: KEY.routeId, version: KEY.version, locale: KEY.locale, startedAt: 1_700_000_000_000 });
  const refused = await deletePackage({ routeId: KEY.routeId, version: KEY.version }, { store: deps.store, driver, gate });
  console.log(
    `1. deletion while the walk is live: ${refused.status}` +
      (refused.status === 'refused' ? ` (${refused.reason}, sessions ${refused.sessionIds.length})` : ''),
  );

  // 2. End the walk: the same deletion succeeds and removes the registry rows.
  finishSession(driver, SID, { finishedAt: 1_700_000_060_000 });
  const zoneB = zoneBFingerprint(driver);
  const done = await deletePackage({ routeId: KEY.routeId, version: KEY.version }, { store: deps.store, driver, gate });
  console.log(`2. deletion after End: ${done.status}${done.status === 'deleted' ? ` (rows ${done.removedAssetRows})` : ''}`);
  console.log(`3. zone B untouched: ${zoneBFingerprint(driver) === zoneB}`);
  console.log(`4. package files gone: ${!(await deps.store.exists('bundles/route-x/1'))}`);

  // 5. Re-download through the grant — the same entitlement, no purchase path.
  const transport: GrantTransport = async () => ({
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
  });
  const outcome = await requestGrant({ ...KEY, lock }, { transport, credential: async () => 'device-secret', delay: async () => {} });
  console.log(`5. re-download via grant: ${outcome.kind}${outcome.kind === 'granted' ? ` (paths ${outcome.urls.urls.length})` : ''}`);

  // 6. Unsafe ids never reach the filesystem.
  const unsafe = await deletePackage({ routeId: '../evil', version: '1' }, { store: deps.store, driver, gate });
  console.log(`6. unsafe id: ${unsafe.status}${unsafe.status === 'invalid-input' ? ` (${unsafe.diagnostics.join(', ')})` : ''}`);

  fs.rmSync(root, { recursive: true, force: true });
}

main();
