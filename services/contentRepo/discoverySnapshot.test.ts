import assert from 'node:assert/strict';
import { test } from 'node:test';

import { openDatabase } from '../db/db.ts';
import { nodeSqliteDriver } from '../db/test-fixture.ts';
import { discoverySnapshotOver } from './discoverySnapshot.ts';

test('the device discovery snapshot survives replacement and a failed write', async () => {
  const driver = nodeSqliteDriver();
  openDatabase(driver);
  const snapshot = discoverySnapshotOver(driver);
  const old = new TextEncoder().encode('{"revision":"old"}');
  const next = new TextEncoder().encode('{"revision":"next"}');
  assert.equal(await snapshot.read(), null);
  await snapshot.write(old);
  assert.deepEqual(await snapshot.read(), old);
  await assert.rejects(snapshot.write(new Uint8Array([0xff])));
  assert.deepEqual(await snapshot.read(), old);
  await snapshot.write(next);
  assert.deepEqual(await discoverySnapshotOver(driver).read(), next);
  assert.equal(driver.prepare('SELECT count(*) AS n FROM discovery_cache').get()?.n, 1);
});
