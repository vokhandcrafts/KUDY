// G20.09 demo driver (issue #480): the same-package overlap schedules over
// the real activation core, node store, deletion gate and in-memory zone A.
// Two overlapping activate() calls of one layer: the first parks on the
// audio transfer with stops.json already staged; the second is requested
// exactly there. The per-package lane runs it after the first's rename tail,
// so the second takes the committed layer (zero fetches) and the ready
// inventory equals the disk. The deletion schedule: the parked download
// cancels named, the sweep finishes before the queued body starts, and the
// queued activation re-downloads the deleted package as a normal fresh one.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { activate, layerPath, stagingLayerPath } from '../../services/download/download.ts';
import { createDeletionGate, deletePackage } from '../../services/download/delete.ts';
import { createNodeDownloadStore, nodeSha256 } from '../../services/download/nodeDownloadStore.ts';
import { createAccessPort } from '../../services/download/access.ts';
import { getBundleAssets, openDatabase } from '../../services/db/db.ts';
import { nodeSqliteDriver } from '../../services/db/test-fixture.ts';
import type { DeletionGate } from '../../services/download/types.ts';
import type { ActivateDeps } from '../../services/download/types.ts';
import type { SqlDriver } from '../../services/db/types.ts';

const STOPS = new TextEncoder().encode('{"stops":[]}\n');
const AUDIO = new TextEncoder().encode('audio-bytes-0123456789abcdef');
const SOURCES: Record<string, Uint8Array> = { 'stops.json': STOPS, 'audio/story-1.m4a': AUDIO };
const KEY = { routeId: 'demo-route', version: '1', locale: 'be', tier: 'base' } as const;

const lock = await Promise.all(
  Object.entries(SOURCES).map(async ([p, bytes]) => ({ path: p, bytes: bytes.length, sha256: await nodeSha256(bytes) })),
);

// The demo rig: driver, store with a staging-arrival signal for stops.json,
// and the deps whose fetch port parks on the audio transfer until released.
function demoRig(root: string, cancel?: DeletionGate): {
  driver: SqlDriver;
  store: ReturnType<typeof createNodeDownloadStore>;
  deps: ActivateDeps;
  releaseA: () => void;
  stagedStops: Promise<void>;
} {
  const driver = nodeSqliteDriver();
  openDatabase(driver);
  const store = createNodeDownloadStore(root);
  let releaseA!: () => void;
  const parked = new Promise<void>((r) => { releaseA = r; });
  let renameResolve!: () => void;
  const stagedStops = new Promise<void>((r) => { renameResolve = r; });
  const realRename = store.rename.bind(store);
  const deps: ActivateDeps = {
    store: {
      ...store,
      rename: async (f: string, t: string) => {
        await realRename(f, t);
        if (t === `${stagingLayerPath(KEY)}/stops.json`) renameResolve();
      },
    },
    fetch: async (rel: string) => { if (rel === 'audio/story-1.m4a') await parked; return SOURCES[rel]!; },
    sha256: nodeSha256,
    driver,
    access: createAccessPort(),
    ...(cancel ? { cancel } : {}),
  };
  return { driver, store, deps, releaseA, stagedStops };
}

async function inventory(root: string, driver: SqlDriver): Promise<{ files: number; hashesMatch: boolean; stagingLeft: boolean }> {
  const store = createNodeDownloadStore(root);
  const rows = getBundleAssets(driver, KEY);
  let files = 0;
  let hashesMatch = rows.length === Object.keys(SOURCES).length;
  for (const row of rows) {
    const disk = await store.readFile(`${layerPath(KEY)}/${row.path}`);
    if (disk === null) { hashesMatch = false; continue; }
    files += 1;
    if ((await nodeSha256(disk)) !== row.sha256) hashesMatch = false;
  }
  const stagingLeft =
    (await store.exists(stagingLayerPath(KEY))) || (await store.exists(`${stagingLayerPath(KEY)}.old`));
  return { files, hashesMatch, stagingLeft };
}

// --- Schedule 1: overlapping_same_key_activation ---
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'g2009-demo-'));
  const { driver, deps, releaseA, stagedStops } = demoRig(root);
  const first = activate({ ...KEY, lock }, deps);
  await stagedStops;
  const second = activate({ ...KEY, lock }, deps);
  releaseA();
  const a = await first;
  const b = await second;
  const inv = await inventory(root, driver);
  console.log(
    'G20.09-overlap',
    JSON.stringify({
      aStatus: a.status === 'complete' ? 'complete' : a.status,
      bStatus: b.status === 'complete' ? 'complete' : b.status,
      bFetched: b.status === 'complete' ? b.fetched : -1,
      files: inv.files,
      hashesMatch: inv.hashesMatch,
      stagingLeft: inv.stagingLeft,
    }),
  );
  fs.rmSync(root, { recursive: true, force: true });
}

// --- Schedule 2: cancel_delete_overlap ---
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'g2009-demo-'));
  const gate = createDeletionGate();
  const { driver, store, deps, releaseA, stagedStops } = demoRig(root, gate);
  const first = activate({ ...KEY, lock }, deps);
  await stagedStops;
  const second = activate({ ...KEY, lock }, deps);
  const deletion = await deletePackage({ routeId: KEY.routeId, version: KEY.version }, { store, driver, gate });
  // The registry rows went with the sweep, before the queued activation
  // re-downloads the package.
  const rowsEmptyAfterDelete = getBundleAssets(driver, KEY).length === 0;
  releaseA();
  const a = await first;
  const b = await second;
  const rows = getBundleAssets(driver, KEY);
  const store2 = createNodeDownloadStore(root);
  const present = await Promise.all(Object.keys(SOURCES).map((rel) => store2.exists(`${layerPath(KEY)}/${rel}`)));
  console.log(
    'G20.09-delete',
    JSON.stringify({
      deletion: deletion.status,
      aStatus: a.status,
      rowsEmptyAfterDelete,
      bStatus: b.status,
      filesAfterRedownload: present.filter(Boolean).length,
      registryRows: rows.length,
    }),
  );
  fs.rmSync(root, { recursive: true, force: true });
}
