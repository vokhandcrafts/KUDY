# G08.05 — спакойныя прапановы апгрэйда: месцы, імпрэсіі, адмова, выхады памылкі

*2026-09-30 by Showboat 0.6.1*

Кантролер камерцыі G08.05 (`controllers/commerce/commerceController.ts`, issue
#292) над фейк-портамі з дэтэрмінаванымі mint'амі і гадзіннікам: вывядзенне
бачнасці прапановы (толькі платны маршрут з `product_id_route`, толькі
`not-owned`, толькі на прэв'ю — C26), імпрэсія па факце рэнэру, не па мантаванні
(AC3, падзея G01.05), паўторныя памылкі пакупкі з двума выхадамі (AC2, C28),
словы §8 «Куплена · трэба загрузіць» і павага адмовы (AC4). Рэндэр-узровень
(экран прэв'ю і адсутнасць усёй камерцыі на Run падчас гуку) — сюіты
`app/preview.test.tsx` і `app/run.test.tsx`; тут — кантролер:

```sh
node --experimental-strip-types controllers/commerce/demo-g0805.ts 2>/dev/null
```

```output
paid + not-owned → offered
mount events 0; layout ×2 → shown 1 (offer_id offer-1)
error ×2 → payment_failed, payment_failed; exits try-again+continue-free; purchases 2
continue free → attempt idle, offer offered, events 6
success → offer paid («Куплена · трэба загрузіць»), succeeded 1
re-buy at paid → purchases 3 (the store is never asked again)
dismiss → dismissed; re-sync → dismissed
```

Read back: мантаванне без layout не дае ніводнай падзеі, два layout-факты
ўзгоны адну `extension_offer_shown` (адзін факт паказу на перыяд бачнасці);
дзве памылкі запар трымаюць абодва выхады і нясуць `purchase_failed` з прычынай
табліцы (`payment_failed`); Continue free закрывае дыялог і пакідае працоўную
прапанову; паспяховая нога стора пераключае стан на сумленнае «Куплена · трэба
загрузіць» і больш ніколі не прапануе пакупку; адмова (dismiss) не вяртаецца ў
тым жа кантэксце нават пасля паўторнага sync. Revert-эксперымент: прыбраная
галінка `dismissed` у `deriveOffer` чырваніць два тэсты кантролера і
рэндэр-тэст AC4 (праверана 2026-09-30, адноўлена).
