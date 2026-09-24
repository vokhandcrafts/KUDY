# G04.02.a — staging, per-file verification, atomic activation

*2026-09-23T22:51:21Z by Showboat 0.6.1*
<!-- showboat-id: 835da1fc-dcb5-4018-8341-dde9cd7bf1d5 -->

Executable proof for issue #189 (`services/download`). The activation core stages a layer beside its final directory, verifies every file against `lock.json` sha256 on the fly, and activates through one rename; partial never counts as ready, and the old layer survives every failure. The byte source, filesystem and digest are injected ports (TR-10); `bundle_asset` goes through the services/db public API. All state lives in fresh `/tmp` roots of this run.

An interrupted transfer stays partial, and resume fetches only what is still missing (criterion 1, criterion 2):

```sh
node --experimental-strip-types -e "const fs = await import('node:fs');
const { activate } = await import('./services/download/download.ts');
const { createNodeDownloadStore, nodeSha256 } = await import('./services/download/nodeDownloadStore.ts');
const { openDatabase } = await import('./services/db/db.ts');
const { nodeSqliteDriver } = await import('./services/db/test-fixture.ts');
const root = '/tmp/g0402a-demo-1';
fs.rmSync(root, { recursive: true, force: true });
const store = createNodeDownloadStore(root);
const enc = (s) => new TextEncoder().encode(s);
const stops = enc('{\"stops\":[]}\n');
const audio = enc('audio-bytes-0123456789abcdef');
const lock = [
  { path: 'stops.json', bytes: stops.length, sha256: await nodeSha256(stops) },
  { path: 'audio/story-1.m4a', bytes: audio.length, sha256: await nodeSha256(audio) },
];
const sources = { 'stops.json': stops, 'audio/story-1.m4a': audio };
const driver = nodeSqliteDriver();
openDatabase(driver);
const failNext = { value: false };
let fetches = 0;
const deps = { store, sha256: nodeSha256, driver, fetch: async (p) => { fetches += 1; if (fetches === 2 && failNext.value) throw new Error('connection lost'); return sources[p]; } };
const key = { routeId: 'route-x', version: '1', locale: 'be', tier: 'base' };
failNext.value = true;
const first = await activate({ ...key, lock }, deps);
console.log('interrupted transfer:');
console.log('  status      :', first.status);
console.log('  missing     :', first.missing.join(', '));
console.log('  diagnostic  :', first.diagnostics.join(', '));
console.log('  final layer :', fs.existsSync(root + '/bundles/route-x/1/be/base') ? 'exists' : 'absent');
failNext.value = false;
fetches = 0;
const second = await activate({ ...key, lock }, deps);
console.log('resume (fetch attempts: ' + fetches + '):');
console.log('  status      :', second.status);
console.log('  fetched now :', second.fetched);
console.log('  verified    :', second.verified, 'files,', second.bytes, 'bytes');
console.log('  final layer :', fs.readdirSync(root + '/bundles/route-x/1/be/base').sort().join(', '));" 2>/dev/null
```

```output
interrupted transfer:
  status      : partial
  missing     : audio/story-1.m4a
  diagnostic  : audio/story-1.m4a#fetch-failed
  final layer : absent
resume (fetch attempts: 1):
  status      : complete
  fetched now : 1
  verified    : 2 files, 41 bytes
  final layer : audio, stops.json
```

A same-length corrupted transfer is caught by the hash alone; the corrupt bytes are not kept, and nothing yields ready (criterion 1):

```sh
node --experimental-strip-types -e "const fs = await import('node:fs');
const { activate, layerPath } = await import('./services/download/download.ts');
const { createNodeDownloadStore, nodeSha256 } = await import('./services/download/nodeDownloadStore.ts');
const { openDatabase } = await import('./services/db/db.ts');
const { nodeSqliteDriver } = await import('./services/db/test-fixture.ts');
const root = '/tmp/g0402a-demo-2';
fs.rmSync(root, { recursive: true, force: true });
const store = createNodeDownloadStore(root);
const enc = (s) => new TextEncoder().encode(s);
const stops = enc('{\"stops\":[]}\n');
const audio = enc('audio-bytes-0123456789abcdef');
const tampered = Uint8Array.from(audio);
tampered[3] ^= 0xff;
const lock = [
  { path: 'stops.json', bytes: stops.length, sha256: await nodeSha256(stops) },
  { path: 'audio/story-1.m4a', bytes: audio.length, sha256: await nodeSha256(audio) },
];
const driver = nodeSqliteDriver();
openDatabase(driver);
const deps = { store, sha256: nodeSha256, driver, fetch: async (p) => p === 'audio/story-1.m4a' ? tampered : stops };
const key = { routeId: 'route-x', version: '1', locale: 'be', tier: 'base' };
const result = await activate({ ...key, lock }, deps);
console.log('corrupted hash:');
console.log('  status                  :', result.status);
console.log('  diagnostic              :', result.diagnostics.join(', '));
console.log('  final layer             :', fs.existsSync(root + '/bundles/route-x/1/be/base') ? 'exists' : 'absent');
const staged = await store.readFile('bundles/route-x/staging/1/be/base/audio/story-1.m4a');
console.log('  corrupt bytes in staging:', staged === null ? 'none' : 'kept');
console.log('  repeated request        :', (await activate({ ...key, lock }, deps)).status);" 2>/dev/null
```

```output
corrupted hash:
  status                  : hash-mismatch
  diagnostic              : audio/story-1.m4a#sha256-mismatch
  final layer             : absent
  corrupt bytes in staging: none
  repeated request        : hash-mismatch
```

An injected crash between verify and the activation rename leaves the old ready layer byte-identical and the new one absent; recovery completes without re-fetching the staged files (criterion 3):

```sh
node --experimental-strip-types -e "const fs = await import('node:fs');
const { activate, layerPath, stagingLayerPath } = await import('./services/download/download.ts');
const { createNodeDownloadStore, nodeSha256 } = await import('./services/download/nodeDownloadStore.ts');
const { openDatabase } = await import('./services/db/db.ts');
const { nodeSqliteDriver } = await import('./services/db/test-fixture.ts');
const root = '/tmp/g0402a-demo-3';
fs.rmSync(root, { recursive: true, force: true });
const store = createNodeDownloadStore(root);
const enc = (s) => new TextEncoder().encode(s);
const stops = enc('{\"stops\":[]}\n');
const audio = enc('audio-bytes-0123456789abcdef');
const lock = [
  { path: 'stops.json', bytes: stops.length, sha256: await nodeSha256(stops) },
  { path: 'audio/story-1.m4a', bytes: audio.length, sha256: await nodeSha256(audio) },
];
const driver = nodeSqliteDriver();
openDatabase(driver);
let fetches = 0;
const deps = { store, sha256: nodeSha256, driver, fetch: async (p) => { fetches += 1; return p === 'audio/story-1.m4a' ? audio : stops; } };
const v1 = { routeId: 'route-x', version: '1', locale: 'be', tier: 'base' };
const v2 = { routeId: 'route-x', version: '2', locale: 'be', tier: 'base' };
console.log('old layer ready       :', (await activate({ ...v1, lock }, deps)).status);
const snap = (rel) => fs.readdirSync(root + '/' + rel, { recursive: true, withFileTypes: false }).sort().join('|');
const before = snap('bundles/route-x/1');
const crashing = { ...deps, store: { ...store, rename: async (f, t) => { if (t === layerPath(v2)) throw new Error('injected crash'); return store.rename(f, t); } } };
try { await activate({ ...v2, lock }, crashing); } catch (e) { console.log('crash during upgrade  :', e.message); }
console.log('old layer unchanged   :', snap('bundles/route-x/1') === before);
console.log('new final layer       :', fs.existsSync(root + '/bundles/route-x/2/be/base') ? 'exists' : 'absent');
const staged = await store.readFile(stagingLayerPath(v2) + '/audio/story-1.m4a');
console.log('staged v2 files intact:', staged !== null && staged.length === audio.length);
fetches = 0;
const done = await activate({ ...v2, lock }, deps);
console.log('recovery              :', done.status, '| fetches:', fetches, '| fetched:', done.fetched);" 2>/dev/null
```

```output
old layer ready       : complete
crash during upgrade  : injected crash
old layer unchanged   : true
new final layer       : absent
staged v2 files intact: true
recovery              : complete | fetches: 0 | fetched: 0
```

`bundle_asset` tracks pending/partial/complete and rebuilds by re-hashing the disk; the durable session row never moves (criterion 5):

```sh
node --experimental-strip-types -e "const fs = await import('node:fs');
const { activate, rebuildBundleAssets, layerPath } = await import('./services/download/download.ts');
const { createNodeDownloadStore, nodeSha256 } = await import('./services/download/nodeDownloadStore.ts');
const { openDatabase, startSession, getSession, getBundleAssets } = await import('./services/db/db.ts');
const { nodeSqliteDriver } = await import('./services/db/test-fixture.ts');
const root = '/tmp/g0402a-demo-4';
fs.rmSync(root, { recursive: true, force: true });
const store = createNodeDownloadStore(root);
const enc = (s) => new TextEncoder().encode(s);
const stops = enc('{\"stops\":[]}\n');
const audio = enc('audio-bytes-0123456789abcdef');
const lock = [
  { path: 'stops.json', bytes: stops.length, sha256: await nodeSha256(stops) },
  { path: 'audio/story-1.m4a', bytes: audio.length, sha256: await nodeSha256(audio) },
];
const driver = nodeSqliteDriver();
openDatabase(driver);
startSession(driver, { sessionId: 's-demo-1', routeId: 'route-x', version: '1', locale: 'be', startedAt: 1 });
const deps = { store, sha256: nodeSha256, driver, fetch: async (p) => p === 'audio/story-1.m4a' ? audio : stops };
const key = { routeId: 'route-x', version: '1', locale: 'be', tier: 'base' };
console.log('activation            :', (await activate({ ...key, lock }, deps)).status);
const show = () => getBundleAssets(driver, key).map((r) => '  ' + r.path.padEnd(20) + r.status.padEnd(10) + r.bytesDone + '/' + r.bytesTotal).join('\n');
console.log('bundle_asset:'); 
console.log(show());
await store.writeFile(layerPath(key) + '/stops.json', enc('{\"stops\":['));
await rebuildBundleAssets({ ...key, lock }, deps);
console.log('after disk damage + rebuildBundleAssets():');
console.log(show());
const row = getSession(driver, 's-demo-1');
console.log('zone B session row    : state=' + row.state + ', started_at=' + row.startedAt + ' (unchanged)');" 2>/dev/null
```

```output
activation            : complete
bundle_asset:
  audio/story-1.m4a   complete  28/28
  stops.json          complete  13/13
after disk damage + rebuildBundleAssets():
  audio/story-1.m4a   complete  28/28
  stops.json          partial   10/13
zone B session row    : state=active, started_at=1 (unchanged)
```
