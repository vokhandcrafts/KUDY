# G10.01.a — web scaffold: public-layer readers and the input leak guard

*2026-09-18T18:24:29Z by Showboat 0.6.1*
<!-- showboat-id: 09ab63ac-21ad-43ef-9abd-5c36e787d5b0 -->

The web is a second reader of the same published bundles (plan 2026-09-16-web-audio-version): stack Next.js + TypeScript confirmed by the founder. First: the readers over the real build-bundle output — route with base/extended stops, the locked-stop preview, and the free-tier story with its transcript.

```sh
node --experimental-strip-types -e "Promise.all([import('./web/lib/content/bundle.ts'),import('./tools/build-bundle/build-bundle.mjs'),import('node:os'),import('node:fs'),import('node:path')]).then(async([b,bb,os,fs,path])=>{const out=fs.mkdtempSync(path.join(os.tmpdir(),'kudy-demo-'));await bb.buildBundle({inDir:'fixtures/content/demo-route',outDir:path.join(out,'build')});const root=path.join(out,'build','public');const route=b.readBundleRoute(root,'demo-route-a1','1');const prev=b.readBundlePreviews(root,'demo-route-a1','1','be');const story=b.readBundleBaseStories(root,'demo-route-a1','1','be');console.log('route ok:',route.ok,'route_id:',route.data.route_id,'stops:',route.data.stops.length,'free_stop_count:',route.data.free_stop_count);console.log('previews(be):',prev.data.length,'locked stop:',prev.data[0].stop_id,'place:',prev.data[0].place_id);console.log('base story:',story.data[0].story_id,'tier:',story.data[0].tier,'transcript bytes:',story.data[0].transcript.length)})"
```

```output
route ok: true route_id: demo-route-a1 stops: 2 free_stop_count: 1
previews(be): 1 locked stop: stop-2 place: place-2
base story: story-1-base tier: base transcript bytes: 101
```

Safe rejection (G02.05 rule): a modified catalog schema_version is rejected as a whole — the web never renders a partial render of an unknown version, unlike the Run reader which degrades (21 §3.3). Unknown locales and traversal path pieces are rejected too.

```sh
node --experimental-strip-types -e "import('./web/lib/content/readers.ts').then(r=>{const fs=require('fs');const doc=JSON.parse(fs.readFileSync('fixtures/discovery-contract/catalog-with-discovery.json','utf8'));console.log('v1 envelope ok:',r.readCatalog(doc).ok);const res=r.readCatalog({...doc,catalog_schema_version:2});console.log('bumped catalog:',res.code);console.log('reserved locale pl known:',r.isKnownLocale('pl'))})"
```

```output
v1 envelope ok: true
bumped catalog: unknown-schema-version
reserved locale pl known: false
```

The leak guard re-checks the actual input the web build consumes, with the build-bundle error classes. The real public/private split passes; a source map and an extended path segment fail immediately; an 8-word run of private narration smuggled into a public preview fails with private-text-leak.

```sh
node --experimental-strip-types -e "Promise.all([import('./web/lib/content/leak-guard.ts'),import('./tools/build-bundle/build-bundle.mjs'),import('node:os'),import('node:fs'),import('node:path')]).then(async([g,bb,os,fs,path])=>{const out=fs.mkdtempSync(path.join(os.tmpdir(),'kudy-demo2-'));const build=path.join(out,'build');await bb.buildBundle({inDir:'fixtures/content/demo-route',outDir:build});const pub=path.join(build,'public'),priv=path.join(build,'private');console.log('clean public split ok:',g.scanWebContentInput({publicDir:pub,privateDir:priv}).ok);fs.writeFileSync(path.join(pub,'evil.map'),'{}');fs.mkdirSync(path.join(pub,'bundle','demo-route-a1','1','be','extended'),{recursive:true});fs.writeFileSync(path.join(pub,'bundle','demo-route-a1','1','be','extended','stops.json'),'[]');const r1=g.scanWebContentInput({publicDir:pub,privateDir:priv});console.log('map+extended:',r1.violations.map(v=>v.code).sort().join(','));const stops=JSON.parse(fs.readFileSync(path.join(priv,'bundle','demo-route-a1','1','be','extended','stops.json'),'utf8'));const gram=stops[0].text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).slice(0,8).join(' ');const pf=path.join(pub,'bundle','demo-route-a1','1','be','base','previews.json');const pv=JSON.parse(fs.readFileSync(pf,'utf8'));pv[0].announce.be=pv[0].announce.be+' '+gram;fs.writeFileSync(pf,JSON.stringify(pv));const r2=g.scanWebContentInput({publicDir:pub,privateDir:priv});console.log('private-text-leak caught:',r2.violations.some(v=>v.code==='private-text-leak'))})"
```

```output
clean public split ok: true
map+extended: private-path-in-public,source-map-in-public
private-text-leak caught: true
```

The web suite is wired into the default npm test command (runner wiring is a contract): the .ts tests run through node's type stripping, and the printed total includes them.

```sh
node --test --experimental-strip-types --test-reporter=tap --test-concurrency=1 web/lib/content/readers.test.ts web/lib/content/leak-guard.test.ts web/lib/content/wiring.test.ts 2>&1 | grep -E '^# (tests|pass|fail)'
```

```output
# tests 25
# pass 25
# fail 0
```
