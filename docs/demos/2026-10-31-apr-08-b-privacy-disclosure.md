# APR-08.b — раскрыццё прыватнасці ў дзевяці мовах

*2026-10-31T19:14:11Z by Showboat 0.6.1*
<!-- showboat-id: 37fada0f-54c6-49ad-80dd-ccbe9fcf8645 -->

Задача [#853](https://github.com/vokhandcrafts/KUDY/issues/853). Публічная палітыка прыватнасці паўтарала стан да APR-08: параграф пакупак не называў RevenueCat і device-UUID, параграф даных дадатку не раскрываў серверную рэгістрацыю прылады, hash IP і серверныя ацэнкі, а параграф выдалення не меў мяжы па крамах і RevenueCat (інвентар APR-08, D03–D08/D12). Кананічныя be-тэксты абноўленыя ў `contracts/ui-messages/source.json`, пераклады васьмі моваў — у `contracts/ui-messages/translations/`, вэб-каталогі перагенераваныя штатным інструментам. Каманда ніжэй рэндэрыць тры абноўленыя параграфы з усіх дзевяці згенераваных каталогаў: кожная мова мае назву RevenueCat у пакупках і ў мяжы выдалення, а be-тэкст паказваецца цалкам.

```bash
node --experimental-strip-types --input-type=module -e 'const locs = ["be","en","uk","de","es","fr","cs","sv","zh"];for (const loc of locs){const m=(await import("./web/lib/i18n/"+loc+".ts"))[loc];console.log(loc+": privacyPurchases="+m.privacyPurchases.length+"b RevenueCat="+(m.privacyPurchases.includes("RevenueCat")?"yes":"NO")+" | privacyAppData="+m.privacyAppData.length+"b | privacyDeletion="+m.privacyDeletion.length+"b RevenueCat="+(m.privacyDeletion.includes("RevenueCat")?"yes":"NO"));}
console.log("--- be privacyPurchases ---");console.log((await import("./web/lib/i18n/be.ts"))["be"].privacyPurchases);'
```

```output
be: privacyPurchases=546b RevenueCat=yes | privacyAppData=749b | privacyDeletion=385b RevenueCat=yes
en: privacyPurchases=557b RevenueCat=yes | privacyAppData=790b | privacyDeletion=431b RevenueCat=yes
uk: privacyPurchases=555b RevenueCat=yes | privacyAppData=765b | privacyDeletion=382b RevenueCat=yes
de: privacyPurchases=549b RevenueCat=yes | privacyAppData=912b | privacyDeletion=453b RevenueCat=yes
es: privacyPurchases=634b RevenueCat=yes | privacyAppData=906b | privacyDeletion=499b RevenueCat=yes
fr: privacyPurchases=665b RevenueCat=yes | privacyAppData=915b | privacyDeletion=528b RevenueCat=yes
cs: privacyPurchases=521b RevenueCat=yes | privacyAppData=728b | privacyDeletion=374b RevenueCat=yes
sv: privacyPurchases=546b RevenueCat=yes | privacyAppData=804b | privacyDeletion=413b RevenueCat=yes
zh: privacyPurchases=191b RevenueCat=yes | privacyAppData=253b | privacyDeletion=140b RevenueCat=yes
--- be privacyPurchases ---
Пакупкі праходзяць праз крамы прыкладанняў (App Store, Google Play): плацёжныя даныя апрацоўвае крама, а дадатак запісвае толькі факт падзеі пакупкі — маршрут, варыянт, вынік — без банкаўскіх рэквізітаў. Правамі на купленае кіруе асобны сэрвіс RevenueCat: дадатак перадае яму выпадковы ідэнтыфікатар прылады як ідэнтыфікатар пакупніка і запыты на куплю ці на пацверджанне раней зробленых пакупак; плацяжы пры гэтым ідуць толькі праз краму. Сервер KUDY трымае тэхнічны ўлік падзей пакупак (прадукт, крама, тэрмін дзеяння) без плацёжных рэквізітаў.
```
