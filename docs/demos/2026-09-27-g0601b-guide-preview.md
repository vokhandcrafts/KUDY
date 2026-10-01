# G06.01.b — Прэв'ю гіда: метаданыя і адзіная галоўная кнопка

*Showboat demo for issue #314 (G06.01.b), created 2026-09-27.*

<!-- showboat-id: g0601b-guide-preview -->

Прэв'ю гіда (RouteDetail, 09 §6.5) збіраецца каталожным сэрвісам з канверта
каталога, discovery-індэкса і публічнага дакумента маршруту
`bundle/<route_id>/<version>/route.json` (публічны layout build-bundle).
Дэма ганяе вытворчы сэрвіс па апублікаваных фікстурах
`fixtures/discovery-contract`: paid-гід з `free_stop_count` і ўсімі
замкнёнымі кропкамі, free_base-гід з адкрытай base-кропкай і замкнёнай
extended (NAV5). Вывад дэтэрмінаваны: фіксаваныя ўваходы, без гадзіннікаў і
выпадковасці. Драйвер збіркі жыве ў services/ (зона services замкнёная
наверх), табліца кнопкі — побач з кантролерам, таму дэма з двух блокаў.

```sh
node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON services/catalog/demo-g0601b-preview.mjs
```

```output
preview guide-route-a1 access=paid route=paid free_stops=1 stops=2 locked=2 size_mb=50 duration_min=45
  stop stop-a1-1 locked=true name=Мытня
  stop stop-a1-2 locked=true name=Порт
preview guide-route-b1 access=free route=free_base stops=2 locked=1
  stop stop-b1-1 locked=false name=Стары порт
  stop stop-b1-2 locked=true name=Млынавая вуліца
state=ready degraded=null
```

Адзіная галоўная кнопка выводзіцца чыстай дэрывацыяй (`derivePreviewButton`)
з рэальных фактаў пакета: чатыры станы інвентару 09 §7 і вердыкт праверкі
contentRepo. Paid-гід без права не стартуе і нічога не купляе — кнопка
выключаная з пазначанай прычынай (AC2, NAV6); збой праверкі пакета пакідае
Start недаступным з прычынай (AC5, 11 §7).

```sh
node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON controllers/catalog/demo-g0601b-button.mjs
```

```output
button paid-no-entitlement: action=start enabled=false label="Пачаць" reason=Патрэбна пакупка. detail=-
button not_downloaded: action=download enabled=true label="Загрузіць" reason=- detail=-
button partial: action=download enabled=true label="Загрузіць" reason=- detail=не хапае файлаў: 3
button ready-verified: action=start enabled=true label="Пачаць" reason=- detail=-
button verify-failure: action=download enabled=true label="Загрузіць" reason=- detail=пакет пашкоджаны: патрэбна паўторная загрузка
```

(Перазахоплена 2026-10-01 у PR #443: G06.10 #433 прывёў слоўнікі прычын да
правіла «загалоўная літара + кропка» — paid-радок чытаецца як фраза; muted
detail з дыягностыкай не змяніўся.)

Рэндэр-тэсты экрана (`app/preview.test.tsx`, jest) праходзяць той самы
вытворчы шлях праз мок fetch з тымі фікстурамі: метаданыя AC1, платны гейт
AC2, замкнёныя рады NAV5, пераварот Download → Start пасля загрузкі (стан
ідзе з інвентару, не з выніку актывацыі), дыялог §4.1 NAV8 і вяртанні NAV9.
Кантролерны сьют (`controllers/catalog/previewController.test.ts`, node
--test) дадаткова пінуе клям пра тое, што поўны вынік актывацыі не можа
падрабізнаць гатоўнасць: зломаны інвентар застаецца Download нават пры
«complete»-адказе каналу загрузкі.
