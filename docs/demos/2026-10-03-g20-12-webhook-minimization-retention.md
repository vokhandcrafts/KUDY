# G20.12 — мінімізацыя webhook-payload і рэнтыш-свуп `webhook_events`

*Showboat demo for issue #483 (G20.12 — payment-event minimization and retention), created 2026-10-03.*

Прадакшн-ядро `/v1/rc-webhook` (`rc-webhook-core.ts`) і рэнтыш-свуп
(`retention-core.ts`) над рэальным in-process Postgres (PGlite з закамічанымі
міграцыямі). Дастаўка несце сінтэтычныя персанальныя палі (`email`, `ip`,
`country`) і ідэнтыфікатары прылад (`app_user_id`, `aliases`); подпіс
мінтуецца фікстурным сакрэтам пад фіксаваны гадзіннік, прылады сеецца
рантайм і не друкуюцца. Адзін блок пакрывае абодва кроку змены:
(`export LD_LIBRARY_PATH` — хоставае патрабаванне node, не частка змены.)

1. Мінімізацыя (спэцы N6, «мінімальны набор даных»): рэфанд `CANCELLATION`
   з сінтэтычнымі персанальнымі палямі ідэмпатэнтна захоўваецца і валіць кэш
   правоў прылады (эфект ідзе з разабранай падзеі), але захаваны `payload`
   змяшчае толькі бухгалтарскія палі — ні `app_user_id`, ні `aliases`, ні
   `email`/`ip`/`country` у радку няма.
2. Свуп + рэплэй: радок старэе за абарончы рубеж (30 дзён — прапанова
   матрыцы, не канон), свуп яго выдаляе; паўтор той самай дастаўкі пасля
   свупа зноў 200 і стварае радок ідэмпатэнтнасці нанава, але права не
   аднаўляе — кэш застаецца пустым, акаўнт прылады не ўваскрашаецца.

```sh
export LD_LIBRARY_PATH=$HOME/.local/lib
node --experimental-strip-types supabase/functions/_shared/demo-g2012.ts 2>/dev/null
```

```output
answer: {"status":200}
cache rows after the refund effect: 0
stored payload: {"store":"APP_STORE","product_id":"kudy.route.ext","environment":"SANDBOX","cancel_reason":"CUSTOMER_SUPPORT","expiration_at_ms":1759363200000}
sweep: {"eventsDeleted":0,"registrationRateWindowsDeleted":0,"sendRateWindowsDeleted":0,"webhookEventsDeleted":1}
replay: {"status":200}
after replay — events: 1 / cache rows: 0 / devices: 1
```

Read back: адказ `200` толькі пасля надзейнага захавання і эфектаў; кэш правоў
прылады ачышчаны рэфандам (эфект з падзеі, не з радка); захаваны payload —
дакладна пяць бухгалтарскіх палёў; свуп выдаляе роўна састарэлы радок
(`webhookEventsDeleted: 1`, аналітычныя табліцы не кранутыя); рэплэй пасля
свупа праходзіць як першая дастаўка, але кэш і прылады пустыя/нязменныя —
паўтор паведамлення не аднаўляе выдаленыя даныя. Сінтэтычныя фікстуры
(`example.com`, выдуманыя UUID і сакрэт); ніводнага рэальнага ўліковага
запісу, сакрэту або кантэнту.
