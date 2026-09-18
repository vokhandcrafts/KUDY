# G02.02 — content package validator with diagnostics

*2026-09-17T21:20:12Z by Showboat 0.6.1*
<!-- showboat-id: 0a45c286-d7ab-45f3-9166-3117c5e928a4 -->

The G02.02 validator checks a whole author tree before packaging and publication, consuming contracts/reader.mjs as the single schema source. First: the clean demo package passes with zero errors and zero warnings.

```sh
node tools/validate/validate-package.mjs --in fixtures/content/demo-route
```

```output
{
  "ok": true,
  "errors": [],
  "warnings": []
}
```

Criterion 1 — unknown references: the same tree with a stop pointing at a place that does not exist fails with a named, content-free diagnostic.

```sh
node -e "const fs=require('fs'),os=require('os'),path=require('path');import('./tools/validate/validate-package.mjs').then(m=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'g0202-'));fs.cpSync('fixtures/content/demo-route',dir,{recursive:true});const r=JSON.parse(fs.readFileSync(dir+'/route.json','utf8'));r.stops[0].place_id='place-ghost';fs.writeFileSync(dir+'/route.json',JSON.stringify(r,null,2));const v=m.validatePackage(dir);console.log('ok:',v.ok);v.errors.forEach(e=>console.log(e.rule,e.path));fs.rmSync(dir,{recursive:true,force:true});})"
```

```output
ok: false
unknown-ref route.json#stops[0].place_id#place-ghost
```

Criterion 2 — RouteStop.id stability: against the previous package, a stop that reappears under a new id is a renumber (the TourForge defect), not a move.

```sh
node -e "const fs=require('fs'),os=require('os'),path=require('path');const prev=fs.mkdtempSync(path.join(os.tmpdir(),'g0202-a-'));const cur=fs.mkdtempSync(path.join(os.tmpdir(),'g0202-b-'));fs.cpSync('fixtures/content/demo-route',prev,{recursive:true});fs.cpSync('fixtures/content/demo-route',cur,{recursive:true});import('./tools/validate/validate-package.mjs').then(m=>{const r=JSON.parse(fs.readFileSync(cur+'/route.json','utf8'));r.stops[0].id='stop-9';fs.writeFileSync(cur+'/route.json',JSON.stringify(r,null,2));const v=m.validatePackage(cur,{previous:prev});console.log('ok:',v.ok);v.errors.forEach(e=>console.log(e.rule,e.path));fs.rmSync(prev,{recursive:true,force:true});fs.rmSync(cur,{recursive:true,force:true});})"
```

```output
ok: false
stop-id-renumbered route.json#stops[0]#stop-1->stop-9
```

Criterion 3 — radius overlap is a field-check warning, never a rejection: the package stays ok=true.

```sh
node -e "const fs=require('fs'),os=require('os'),path=require('path');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'g0202-'));fs.cpSync('fixtures/content/demo-route',dir,{recursive:true});import('./tools/validate/validate-package.mjs').then(m=>{const p=JSON.parse(fs.readFileSync(dir+'/places.json','utf8'));p[1].lat=p[0].lat+0.00005;p[1].lng=p[0].lng+0.00005;fs.writeFileSync(dir+'/places.json',JSON.stringify(p,null,2));const v=m.validatePackage(dir);console.log('ok:',v.ok,'errors:',v.errors.length);v.warnings.forEach(w=>console.log(w.severity,w.rule,w.path));fs.rmSync(dir,{recursive:true,force:true});})"
```

```output
ok: true errors: 0
warning radius-overlap places.json#place-1+place-2
```

Criterion 5 — fixtures/discovery-contract/ is the conformance set: the valid fixtures pass, an invalid one fails on the rule its text names, and the oversized catalog is rejected on discovery_index.bytes before any load.

```sh
node -e "const fs=require('fs');Promise.all([import('./tools/validate/validate-package.mjs'),import('./contracts/reader.mjs')]).then(([m,r])=>{const read=f=>JSON.parse(fs.readFileSync('fixtures/discovery-contract/'+f,'utf8'));console.log('index-valid:',m.validateDiscoveryIndex(read('index-valid.json')).ok);console.log('catalogs:', ['catalog-legacy.json','catalog-with-discovery.json','catalog-legacy-v0.json'].every(f=>r.readCatalogDoc(read(f)).ok));const bad=m.validateDiscoveryIndex(read('index-invalid-private-path.json'));console.log('private-path:',bad.ok,bad.errors.map(e=>e.rule).join(','));const over=r.readCatalogDoc(read('catalog-invalid-oversized.json'));console.log('oversized:',over.ok,over.errors[0].rule)})"
```

```output
index-valid: true
catalogs: true
private-path: false oneOf,unsafe-path
oversized: false discovery-index-oversized
```
