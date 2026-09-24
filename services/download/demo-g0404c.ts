// G04.04.c demo — the restart presence check and the re-download request as
// one offline chain: an installed layer re-verifies at the metadata level
// without hashing, an orphaned (truncated) file moves it to needs-recovery,
// the repair fetches exactly the named paths, and a fresh check confirms. The
// full re-hash appears only on a trigger condition, never on the ordinary
// restart, and a newer version on disk never contributes. Prints verdicts and
// counters only (no paths, no timings); the bundles tree lives in a fresh
// temp directory and is removed afterwards.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { checkPresence } from '../contentRepo/presence.ts';
import { createNodeBundlesStore } from '../contentRepo/nodeBundlesStore.ts';
import { writeFlatLayer } from '../contentRepo/test-fixture.ts';
import { depsFor } from './test-fixture.ts';
import { repairLayer } from './repair.ts';
import { nodeSha256 } from './nodeDownloadStore.ts';
import type { LayerKey, Sha256 } from '../contentRepo/types.ts';

const KEY: LayerKey = { routeId: 'route-x', version: '1', locale: 'be', tier: 'base' };
const LAYER = 'bundles/route-x/1/be/base';
const AUDIO = 'audio-bytes-0123456789abcdef';

function spySha256(): { sha256: Sha256; count: () => number } {
  let calls = 0;
  return {
    sha256: async (bytes) => {
      calls += 1;
      return nodeSha256(bytes);
    },
    count: () => calls,
  };
}

function show(step: string, verdict: Awaited<ReturnType<typeof checkPresence>>[number], hashes: number): void {
  const line = verdict.status === 'needs-recovery'
    ? `${verdict.status} (checked ${verdict.checked}, missing ${JSON.stringify(verdict.missing)})`
    : verdict.status === 'verified'
      ? `${verdict.status} (checked ${verdict.checked})`
      : `${verdict.status}`;
  console.log(`${step} route-x@1/be/base: ${line}, full-hash calls ${hashes}`);
}

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'g0404c-demo-'));
  try {
    writeFlatLayer(root, LAYER, { 'stops.json': '{"stories":[]}', 'audio/story-1.m4a': AUDIO });
    const store = createNodeBundlesStore(root);
    const digest = spySha256();
    const sources: Record<string, Uint8Array> = {
      'stops.json': new TextEncoder().encode('{"stories":[]}'),
      'audio/story-1.m4a': new TextEncoder().encode(AUDIO),
    };
    const { deps } = depsFor(root, { sources });
    const lock = JSON.parse(fs.readFileSync(path.join(root, LAYER, 'lock.json'), 'utf8'));
    const recheck = () =>
      checkPresence(store, { layers: [KEY], trigger: 'restart', sha256: digest.sha256 });

    show('1.', (await recheck())[0], digest.count());

    // iOS-style orphaning: the file survives SQLite, but short.
    fs.writeFileSync(path.join(root, LAYER, 'audio/story-1.m4a'), 'trunc');
    const damaged = (await recheck())[0];
    show('2.', damaged, digest.count());

    const missing = damaged.status === 'needs-recovery' ? damaged.missing : [];
    const repaired = await repairLayer({ ...KEY, lock }, deps, missing);
    console.log(
      `3. repair: ${repaired.status}, fetched ${JSON.stringify(repaired.status === 'repaired' ? repaired.repaired : [])}`,
    );

    show('4.', (await recheck())[0], digest.count());

    // Same-size corruption — invisible to the metadata level, caught by the
    // full re-hash on a trigger condition (user-requested check). The newer
    // version written below never fills the pinned one: the repair request
    // carries route-x@1 and its own lock only.
    writeFlatLayer(root, 'bundles/route-x/2/be/base', {
      'stops.json': '{"stories":[]}',
      'audio/story-1.m4a': AUDIO,
    });
    const bytes = Buffer.from(AUDIO);
    bytes[3] ^= 0xff;
    fs.writeFileSync(path.join(root, LAYER, 'audio/story-1.m4a'), bytes);
    const full = (
      await checkPresence(store, { layers: [KEY], trigger: 'user-requested', sha256: digest.sha256 })
    )[0];
    show('5.', full, digest.count());

    const fullMissing = full.status === 'needs-recovery' ? full.missing : [];
    const repinned = await repairLayer({ ...KEY, lock }, deps, fullMissing);
    console.log(
      `6. pinned repair of route-x@1: ${repinned.status}, fetched ` +
        `${JSON.stringify(repinned.status === 'repaired' ? repinned.repaired : [])}`,
    );
    const confirmed = (
      await checkPresence(store, { layers: [KEY], trigger: 'user-requested', sha256: digest.sha256 })
    )[0];
    show('7.', confirmed, digest.count());
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main();
