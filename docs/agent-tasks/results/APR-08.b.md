# APR-08.b — узгадненне палітыкі прыватнасці з фактычнымі патокамі

Дата: **2026-10-31**. Задача: [#853](https://github.com/vokhandcrafts/KUDY/issues/853). Эпік: [#299](https://github.com/vokhandcrafts/KUDY/issues/299). База: main `0920d5e8`, галінка `zcode/853`. Выканаўца: ZCode (GLM-5.3), асобны клон `KUDY-853`. Тып: змена тэкстаў UI-каталогаў (дадзеныя + генерацыя), **не Play Console submission** і не release-зборка.

## Мяжа доказу

Інвентар [APR-08.md](APR-08.md) (D03–D08, D12) — крыніца фактаў. Усе новыя сцверджанні тэкстаў абмежаваныя code-верыфікаванымі фактамі: `services/entitlement/expo/rc-port.ts` (`Purchases.logIn(appUserId)` з UUID прылады, purchase/restore), `services/device.ts` + `supabase/functions/_shared/device-core.ts` (выдача UUID і сакрэта, hash сакрэта на серверы), `services/feedbackSync.ts` (`/feedback`, `/feedback/read`, `/feedback/delete` на KUDY Supabase), каскаднае выдаленне feedback-табліц з device (D06). Production/network trace release-зборкі на хасце недаступны — гэта **Н** (невядомае) і запісана як blocker да handoff #299, не як адсутнасць патокаў.

## Што зменена

- `contracts/ui-messages/source.json` — тры запісы: `web.ui.privacyPurchases` (RevenueCat як асобны атрымальнік, device UUID як ідэнтыфікатар пакупніка, purchase/restore, тэхнічны ўлік падзей на серверы KUDY без плацёжных рэквізітаў), `web.ui.privacyAppData` (серверная рэгістрацыя прылады: UUID + hash сакрэта на серверы, сакрэт толькі на прыладзе; аднабаковы hash IP для абмежавання частаты; серверныя ацэнкі — адзнака і выбраныя прычыны, без вольнага тэксту), `web.ui.privacyDeletion` (у каскадзе выдалення — ацэнкі на серверы і сакрэт на прыладзе; кнопка не выдаляе запісы крамаў і RevenueCat). `context` запісаў абноўлены, `sourceHash` перлічаны роднай функцыяй `sourceHash()` рэпы.
- `contracts/ui-messages/translations/{en,uk,cs,de,es,fr,sv,zh}.json` — тры запісы ў кожнай мове: новае `value`, `reviewedSourceHash` = новы hash, `review.note` праходу #853. Тэрміны purchase па глоссарыю (cs nákup, de Kauf, es compra, fr achat, sv köp, uk покупка, zh — замацаваны глоссарыйны тэрмін), брэнды (RevenueCat, App Store, Google Play, KUDY, My KUDY) — лацініцай ва ўсіх мовах. Файл zh.json патчаны точачна ў родным стылі \u-эскейпаў.
- `web/lib/i18n/*.ts` — перагенераваны штатна (`npm run messages:generate`), 9 файлаў каталога.
- `tools/i18n/privacy-disclosure.test.mjs` — новы guard (правіла 1 implementation-rules): be-крыніца абавязана трымаць RevenueCat/hash IP/hash сакрэта/ацэнкі/межы выдалення; усе восем выпушчаных моваў — RevenueCat у `privacyPurchases` і `privacyDeletion`. Адкат тэкстаў рве тэст.

## Матрыца privacy key × locale × recipient × evidence

| Запіс | Атрымальнікі, названыя цяпер | Мовы | Evidence |
| --- | --- | --- | --- |
| `web.ui.privacyPurchases` | крамы (App Store, Google Play), RevenueCat (UUID прылады як ідэнтыфікатар пакупніка; purchase/confirm), сервер KUDY (тэхнічны ўлік падзей) | be + en/uk/cs/de/es/fr/sv/zh | `contracts/ui-messages/source.json` (sourceHash `a702717e…`), па адным запісу ў кожным translations-файле; guard-тэст правярае RevenueCat ва ўсіх дзевяці |
| `web.ui.privacyAppData` | прылада (лакальны лог, загрузкі), сервер KUDY (рэгістрацыя: UUID + hash сакрэта; аднабаковы hash IP; серверныя ацэнкі без вольнага тэксту) | be + усе восем | `contracts/ui-messages/source.json` (sourceHash `68c45b57…`); guard-тэст пінуе be-крыніцу |
| `web.ui.privacyDeletion` | сервер KUDY (запіс прылады + лог + ацэнкі), прылада (сакрэт), мяжа: крамы і RevenueCat не выдаляюцца | be + усе восем | `contracts/ui-messages/source.json` (sourceHash `a581b5a8…`); guard-тэст правярае RevenueCat ва ўсіх дзевяці |

`web.ui.privacyAnalytics` і `web.ui.privacyRetention` наўмысна не кранутыя: іх сцверджанні (згода на аналітыку; TTL сырых падзей і агрэгаты) не ўваходзяць у D12; супярэчнасць агрэгатаў — доўг [#849](https://github.com/vokhandcrafts/KUDY/issues/849).

## Сэнсавы рэв'ю перакладаў (G21.19)

Асобны чыстакантэкстны рэв'ю (GLM-5.3, субагент, 2026-10-31): усе 24 радкі (8 моваў × 3 запісы) звераныя з be-крыніцай, кантэкстамі запісаў і глоссарыем; праверкі — сэнс 1:1, адмаўленні і абяцанні доступу, тэрміны purchase/restore-пакупак без рэстаўрацыйнай метафары, брэнды лацініцай, пунктуацыя. Вынік: **15 OK, 9 знаходак**, усе прымененыя ў гэтым жа PR:

1. блакуючая: zh `privacyDeletion` — назва раздзела «KUDY» абрэзана да неіснуючай старонкі; вернута «My KUDY»;
2. en `privacyPurchases` — «tier» замест be «варыянт» (астатнія 7 моваў: variant);
3. uk `privacyPurchases` — калька «тримає облік» → «веде облік»;
4. uk `privacyAppData` — род «пристрій» (м.р.) у рэферэнцыі «її» → «його»; «дані в додатку» → «поставлені в додатку»; «тримаються» → «зберігаються»;
5. es `privacyAppData` — зваблівы суб'ект «Al instalarse, el servidor…» → «Al instalarse la aplicación, …»;
6. sv `privacyAppData` — норма «Betyg av rutter» → «Betyg på rutter»;
7. sv `privacyDeletion` — два ўладальнікі «den tjänsten» → «respektive tjänst»;
8. de `privacyAppData`/`privacyDeletion` — двукроп'е перад поўным сказам: вялікая літара («: Auf dem Server…», «: Diese verwahrt…»).

Страчаных адмаўленняў, дададзеных ад сябе сцвярджэнняў і абяцанняў provider-side deletion рэв'ю не знайшло. Пасля замен перазапушчаны генерацыя і ўсе i18n-гейты — зялёныя.

## Праверкі (2026-10-31, HEAD галінкі)

- ✅ `node --test --experimental-strip-types tools/i18n/privacy-disclosure.test.mjs` — 9 pass / 0 fail.
- ✅ `npm run messages:generate` — 17 файлаў; `npm run messages:generate:check` — «17 files fresh»; `npm run messages:check` — «shipped locales complete, reviewed and fresh».
- ✅ `npm run typecheck` — без памылак (tsc ×3 праекты).
- ✅ `npm run arch:check` — 658 модуляў, 0 парушэнняў (базлайн 2026-10-02).
- ✅ `npx --yes jscpd@5.1.2 --config .jscpd.json --no-tips .` — 0 клонаў.
- ✅ `npm test` — мэтавыя для дыфа сюіты зялёныя паасобку: `tools/i18n/*.test.mjs` + `web/privacy-page.test.ts` — 37/37 (у тым ліку новы guard і абноўлены golden), `test/ui-messages-render-golden.test.mjs` — 1/1, `tools/docs-ledger/ledger.test.mjs` — 12/12, `tools/collector/cli.test.mjs` — 12/12. Поўны бег на гэтай Windows-машыне дадаткова паказаў вядомыя асяроддзевыя фэйлы, пацверджаныя і на чыстым main без дыфа (stash-прабег): `test/apr04-showboat-output.test.mjs` і `tools/ci/g20-35-mutation.test.mjs` (CRLF vs `\n`-анкеры; на ubuntu CI зялёныя), адзін flake пад нагрузкай (`tools/collector/cli.test.mjs`, асобна зялёны) і замярзанне поўнага прабегу; аўтарытэтны поўны гейт — CI ubuntu у гэтым PR. Захаваны вывад дэмы пераздымалася пасля кожнай змены тэкстаў (правіла 11).
- ✅ Golden-захаваныя радкі: `test/ui-messages-render-golden.json` — 9 радкоў (3 запісы × be/en/uk) пераздыманы тэкстальна ў родным фармаце, па прэцэдэнце PR #761 (privacyLocation).
- ✅ `uvx showboat==0.6.1 verify docs/demos/2026-10-31-apr-08-b-privacy-disclosure.md` — exit 0, два прагоны запар; два прагоны дэма-блока байт-ідэнтычныя.

## Handoff #299

*(fill after posting the handoff comment)*
