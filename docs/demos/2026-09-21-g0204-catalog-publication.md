# G02.04 — catalog publication and rollback

*2026-09-21T00:18:06Z by Showboat 0.6.1*
<!-- showboat-id: fdee65be-2019-45d5-8830-bd64f0769458 -->

Criterion 1+5: the full staging package (release manifest, lock entries, registry metadata) is verified before anything is laid; the pointer envelope written by the tool is the one the web reader consumes — discovery_index points at the built index with bytes/sha256.

```sh
rm -rf /tmp/kudy-g0204 && mkdir -p /tmp/kudy-g0204/target
node tools/build-bundle/build-bundle.mjs --in fixtures/content/demo-route --out /tmp/kudy-g0204/staging
node tools/publish-catalog/publish-catalog.mjs --staging /tmp/kudy-g0204/staging --target /tmp/kudy-g0204/target --now 2026-09-21T00:00:00.000Z
cat /tmp/kudy-g0204/target/catalog.json
```

```output
{
  "artifacts": 25,
  "built": true
}
{
  "catalog_bytes": 581,
  "catalog_sha256": "c7d01948fa1055e009a973bf395d3820f66ffa314078b15b77d41f0bbd4e4bd1",
  "copied": 19,
  "discovery_index": "discovery/demo-city/r-demo-1/index.json",
  "kept": 0,
  "published": true,
  "release": "releases/demo-route-a1/1",
  "route_id": "demo-route-a1",
  "routes": 1,
  "version": "1"
}
{
  "catalog_schema_version": 1,
  "discovery_index": {
    "bytes": 8291,
    "path": "discovery/demo-city/r-demo-1/index.json",
    "revision": "r-demo-1",
    "schema_version": 1,
    "sha256": "bf27a74bdb4418470da83fc71fe6b90ac7fde4599ec4adf87595c1ce1db2f353"
  },
  "generated_at": "2026-09-21T00:00:00.000Z",
  "routes": [
    {
      "layers": [
        "base",
        "extended"
      ],
      "locales": [
        "be",
        "en",
        "uk"
      ],
      "route_id": "demo-route-a1",
      "sizes": {
        "base": 7266
      },
      "version": "1"
    }
  ]
}
```

Criterion 2: a ready (published) route/version refuses byte drift even when the tampered staging is internally consistent — manifest, lock and file all agree with each other, but the published bytes are immutable.

```sh
node -e "
const fs = require('fs'), crypto = require('crypto');
const stage = '/tmp/kudy-g0204/staging';
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const rel = 'public/bundle/demo-route-a1/1/be/base/stops.json';
let buf = Buffer.concat([fs.readFileSync(stage + '/' + rel), Buffer.from(' ')]);
fs.writeFileSync(stage + '/' + rel, buf);
const mfFile = stage + '/release/release-manifest.json';
const mf = JSON.parse(fs.readFileSync(mfFile, 'utf8'));
const set = (p, b) => { const a = mf.artifacts.find((x) => x.path === p); a.bytes = b.length; a.sha256 = sha256(b); };
set(rel, buf);
const lockRel = 'public/bundle/demo-route-a1/1/be/base/lock.json';
const lock = JSON.parse(fs.readFileSync(stage + '/' + lockRel, 'utf8'));
const e = lock.find((x) => x.path === 'stops.json');
e.bytes = buf.length; e.sha256 = sha256(buf);
const lockBuf = Buffer.from(JSON.stringify(lock, null, 2));
fs.writeFileSync(stage + '/' + lockRel, lockBuf);
set(lockRel, lockBuf);
fs.writeFileSync(mfFile, JSON.stringify(mf, null, 2));
console.log('staging tampered, manifest and lock reconciled with it');
"
node tools/publish-catalog/publish-catalog.mjs --staging /tmp/kudy-g0204/staging --target /tmp/kudy-g0204/target --now 2026-09-21T00:00:00.000Z
echo "exit=$?"
```

```output
staging tampered, manifest and lock reconciled with it
{
  "error": {
    "actual_sha256": "7dc0fcdd28ecd2db474991d6646d896ef28fe61d7124a55a925490535915519f",
    "code": "version-immutable",
    "expected_sha256": "c07a7c3611081c7cf7de686782a0a25e2fb028700fbe35f139a27ff5c6c14d4c",
    "path": "bundle/demo-route-a1/1/be/base/lock.json"
  }
}
exit=1
```

Criteria 3+4: a new version with a new index revision publishes over the old one (old files stay on disk, immutable); --rollback atomically restores the previous ready version — the pointer moves back to r-demo-1.

```sh
rm -rf /tmp/kudy-g0204/author2 /tmp/kudy-g0204/staging-v2 && cp -r fixtures/content/demo-route /tmp/kudy-g0204/author2
node -e "
const fs = require('fs');
const rf = '/tmp/kudy-g0204/author2/route.json';
const route = JSON.parse(fs.readFileSync(rf, 'utf8'));
route.version = '2';
fs.writeFileSync(rf, JSON.stringify(route, null, 2));
const df = '/tmp/kudy-g0204/author2/discovery.json';
const d = JSON.parse(fs.readFileSync(df, 'utf8'));
d.revision = 'r-demo-2';
for (const o of d.offers ?? []) if (o.ref && o.ref.kind === 'guide') o.ref.version = '2';
for (const c of d.collections ?? []) for (const m of c.members ?? []) if (m.kind === 'guide') m.version = '2';
fs.writeFileSync(df, JSON.stringify(d, null, 2));
console.log('author tree retargeted to version 2, revision r-demo-2');
"
node tools/build-bundle/build-bundle.mjs --in /tmp/kudy-g0204/author2 --out /tmp/kudy-g0204/staging-v2
node tools/publish-catalog/publish-catalog.mjs --staging /tmp/kudy-g0204/staging-v2 --target /tmp/kudy-g0204/target --now 2026-09-21T00:00:00.000Z
grep -o '"revision": "[^"]*"' /tmp/kudy-g0204/target/catalog.json
node tools/publish-catalog/publish-catalog.mjs --rollback --target /tmp/kudy-g0204/target
grep -o '"revision": "[^"]*"' /tmp/kudy-g0204/target/catalog.json
```

```output
author tree retargeted to version 2, revision r-demo-2
{
  "artifacts": 25,
  "built": true
}
{
  "catalog_bytes": 581,
  "catalog_sha256": "bb8af62f1c70402a2060918a5230d43b26dbc4f89685ef6db57cc9d353e30bf8",
  "copied": 17,
  "discovery_index": "discovery/demo-city/r-demo-2/index.json",
  "kept": 2,
  "published": true,
  "release": "releases/demo-route-a1/2",
  "route_id": "demo-route-a1",
  "routes": 1,
  "version": "2"
}
"revision": "r-demo-2"
{
  "discovery_index": "discovery/demo-city/r-demo-1/index.json",
  "rolled_back": true,
  "routes": 1
}
"revision": "r-demo-1"
```
