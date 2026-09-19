# TR-6/TR-8 — гігіена вэба: адзіны isKnownLocale, мёртвы /map схаваны

Дэма правярае TR-6 і TR-8 (`docs/architecture/23_technical_remarks.md`): у
каталозе горада больш няма мёртвай спасылкі на `/map` (маршруту няма, пакуль
рашэнне пра тайл-правайдар адкрытае — #111), а `isKnownLocale` мае адну
рэалізацыю ў `readers.ts`. Guard-тэст унутраных href-аў падае, калі мёртвы
лінк вернецца. Вывад дэтэрмінаваны.

```sh
node --experimental-strip-types -e "Promise.all([import('./web/lib/content/site.ts'),import('./web/lib/content/test-fixture.ts')]).then(async([s,f])=>{const {publicRoot}=await f.buildDemoFixture();const home=s.readSiteCatalogPage(publicRoot,'be');console.log('data keys:',Object.keys(home).join(','));console.log('cards:',home.cards.length,'href:',home.cards[0].href)})"
```

```output
data keys: cityId,cards
cards: 1 href: /guides/demo-route-a1
```

Guard-тэст: кожны унутраны href з даных каталога resolves сярод статычных
маршрутаў web/app (ці гэта гід з вядомым route_id); `/map` у гэтым наборы
адсутнічае.

```sh
node --test --experimental-strip-types --test-reporter=tap --test-concurrency=1 web/lib/content/internal-links.test.ts 2>&1 | grep -E '^# (tests|pass|fail)'
```

```output
# tests 1
# pass 1
# fail 0
```

TR-6: рэалізацыя `isKnownLocale` — адна (прыватная копія ў `bundle.ts`
выдаленая, імпарт з `readers.ts`, правіла 3).

```sh
grep -rn "function isKnownLocale" web/lib/content | wc -l
```

```output
1
```
