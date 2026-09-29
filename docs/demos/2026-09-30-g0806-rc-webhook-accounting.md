# G08.06 — /v1/rc-webhook: HMAC, ідэмпатэнтнасць і рэфанд/transfer-эфекты на бухгальтэрыі правоў

*2026-09-30 by Showboat 0.6.1*

Апцыянальны RevenueCat webhook (`supabase/functions/_shared/rc-webhook-core.ts`,
issue #293) — бухгальтэрыя, не брама гранта: матрыца праціў рэальнага Postgres
(PGlite) з прымененымі міграцыямі і вытворчымі SQL-портамі (`webhook_events`,
`entitlement_cache`). Подпісы мінтуюцца фікстурным сакрэтам пад фіксаваны
гадзіннік, ідэнтыфікатары прылад генеруюцца рантайм і ніколі не друкуюцца.

Матрыца, жывы прагон:

```sh
node --experimental-strip-types supabase/functions/_shared/demo-g0806.ts 2>/dev/null
```

```output
forged signature → {"status":401} / cache rows 2
refund → {"status":200} / cache rows 1 / events 1
duplicate → {"status":200} / invalidations 1 → 1 / events 1
transfer → {"status":200}
corrupt → {"status":400} / events 2
test → {"status":200} / cache rows 1 / events 3
```

Read back: падроблены подпіс — 401 без зменаў правоў; правільны рэфанд — 200
пасля надзейнага захавання падзеі і ачысткі кэшу правоў прылады; паўторная
дастаўка таго ж `event.id` — ізноў 200, але эфект адзін (`invalidations
1 → 1`); `TRANSFER` валіць кэш толькі ў `transferred_from`; крывы запіс —
400 без персістанцыі і без 500; бухгальтарскі `TEST` захоўваецца, правы не
тыкае.
