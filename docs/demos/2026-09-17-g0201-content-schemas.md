# G02.01 — content contracts: schemas, catalog reader, import boundary

*2026-09-17T00:00:27Z by Showboat 0.6.1*
<!-- showboat-id: 13aaaf35-4768-48ad-9ba0-68b269e25189 -->

The versioned content schemas (contracts/) with the single interpretation reader. First: the conformance fixture index-valid.json passes both the JSON Schema and the named cross-record rules of 21 §3.2.

```sh
node -e "const fs=require('fs');import('./contracts/reader.mjs').then(r=>{const i=JSON.parse(fs.readFileSync('fixtures/discovery-contract/index-valid.json','utf8'));const s=r.validateSchemaFile('schemas/discovery-index.schema.json',i);const rules=r.checkIndexRules(i);console.log('schema ok:',s.ok,'rules ok:',rules.ok)})"
```

```output
schema ok: true rules ok: true
```

Criterion 4 — an import cannot claim official provenance: the imported example is structurally valid content, but the official profile rejects it, and a masquerading copy (origin official + imp. ids) is caught by the namespace check.

```sh
node -e "const fs=require('fs');import('./contracts/reader.mjs').then(r=>{const doc=JSON.parse(fs.readFileSync('contracts/examples/imported-route.json','utf8'));console.log('content schema:',r.validateSchemaFile('schemas/route.schema.json',doc).ok);console.log('import profile:',r.checkImportedProfile(doc).ok);const off=r.checkOfficialProfile(doc);console.log('official profile:',off.ok,off.errors[0].rule);const m={...doc,origin:'official'};console.log('masquerade caught:',!r.checkOfficialProfile(m).ok,r.checkOfficialProfile(m).errors[0].rule)})"
```

```output
content schema: true
import profile: true
official profile: false origin-not-official
masquerade caught: true import-namespace-in-official
```

Catalog envelope and legacy reader per the G01.06 decision (21 §3.3): a bare array is legacy v0, an unknown major version keeps the route list but drops discovery, and an oversized discovery index is rejected before any fetch.

```sh
node -e "const fs=require('fs');import('./contracts/reader.mjs').then(r=>{const v0=r.readCatalogDoc(JSON.parse(fs.readFileSync('fixtures/discovery-contract/catalog-legacy-v0.json','utf8')));console.log('legacy v0:',v0.status,'routes:',v0.routes.length);const over=r.readCatalogDoc(JSON.parse(fs.readFileSync('fixtures/discovery-contract/catalog-invalid-oversized.json','utf8')));console.log('oversized ok:',over.ok,over.errors[0].rule);const u=r.readCatalogDoc({catalog_schema_version:2,routes:[{route_id:'r1',version:'1',locales:['be'],layers:['base'],sizes:{base:1}}]});console.log('unknown major:',u.status,'discovery:',u.discovery_index,'routes kept:',u.routes.length)})"
```

```output
legacy v0: legacy-v0 routes: 2
oversized ok: false discovery-index-oversized
unknown major: unknown-major discovery: null routes kept: 1
```
