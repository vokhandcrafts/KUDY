# Follow-up PR #131 — interim-catalog boundary: лякалы пад ідэнтыфікатар-брамай, хвост без сімлінкаў

Дэма правярае фікс дзвюх Medium-находак трэцяга рэвью PR #131 (issue #132):
`deriveInterimCatalog` больш не пускае ў catalog.json лякал з non-identifier
імем і больш не ідзе па сімлінку на хвасце `base/stops.json` — існаванне
лякала вызначаецца праз realpath-кантэйнмэнт хваставога шляху. Вывад
дэтэрмінаваны (рэвізія фікстуры `r-demo-1`, лякалы `be,en,uk`).

Non-identifier імя лякала — іменаваны дыягностык (сімэтрычна да route/version):

```sh
node --experimental-strip-types -e "Promise.all([import('./web/lib/content/test-fixture.ts'),import('./web/lib/content/interim-catalog.ts')]).then(async([f,c])=>{const fs=await import('node:fs');const path=await import('node:path');const {publicRoot}=await f.buildDemoFixture();fs.mkdirSync(path.join(publicRoot,'bundle','demo-route-a1','1','bad name'),{recursive:true});try{c.deriveInterimCatalog(publicRoot)}catch(e){console.log('diagnostic:',e.message)}})"
```

```output
diagnostic: unsafe bundle entry name: bundle/demo-route-a1/1/bad name
```

Лякал `evil` з рэальным `base/stops.json`-сімлінкам вонкаву (рэпра рэвью:
забруджванне каталога) больш не трапляе ў каталог; сапраўдныя лякалы
незменныя:

```sh
node --experimental-strip-types -e "Promise.all([import('./web/lib/content/test-fixture.ts'),import('./web/lib/content/interim-catalog.ts')]).then(async([f,c])=>{const fs=await import('node:fs');const path=await import('node:path');const {publicRoot,buildRoot}=await f.buildDemoFixture();const v=path.join(publicRoot,'bundle','demo-route-a1','1');fs.mkdirSync(path.join(v,'evil','base'),{recursive:true});const outside=path.join(buildRoot,'outside-stops.json');fs.writeFileSync(outside,'{}');fs.symlinkSync(outside,path.join(v,'evil','base','stops.json'));const cat=c.deriveInterimCatalog(publicRoot);console.log('locales:',cat.routes[0].locales.join(','))})"
```

```output
locales: be,en,uk
```

Сімлінк на корані `discovery/` — іменаваны дыягностык (раней гэты рэверт
трымаў усе boundary-тэсты зялёнымі, цяпер ёсць негатыўны тэст):

```sh
node --experimental-strip-types -e "Promise.all([import('./web/lib/content/test-fixture.ts'),import('./web/lib/content/interim-catalog.ts')]).then(async([f,c])=>{const fs=await import('node:fs');const path=await import('node:path');const {publicRoot,buildRoot}=await f.buildDemoFixture();const outside=path.join(buildRoot,'outside-discovery');fs.mkdirSync(outside);fs.writeFileSync(path.join(outside,'index.json'),'{}');fs.rmSync(path.join(publicRoot,'discovery'),{recursive:true});fs.symlinkSync(outside,path.join(publicRoot,'discovery'));try{c.deriveInterimCatalog(publicRoot)}catch(e){console.log('diagnostic:',e.message)}})"
```

```output
diagnostic: unsafe bundle entry: ../outside-discovery
```

Поўны набор boundary-негатыўных тэстаў (9 з 9, у тым ліку 4 новыя) у
дэфолтным `npm test`; дыр-сімлінк усярэдзіне `discovery/` не павялічвае
колькасць знойдзеных index.json:

```sh
node --test --experimental-strip-types --test-reporter=tap --test-concurrency=1 web/lib/content/entry-boundary.test.ts 2>&1 | grep -E '^# (tests|pass|fail)'
```

```output
# tests 9
# pass 9
# fail 0
```

`.mimosa/` (рабочая тэчка Mimosa-скана) больш не трапляе ў git status:

```sh
git check-ignore .mimosa/
```

```output
.mimosa/
```
