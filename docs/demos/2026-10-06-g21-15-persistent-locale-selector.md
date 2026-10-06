# G21.15 — пікіер васьмі моваў з выбарам, што перажывае перазапуск

*2026-10-06T19:50:00Z by Showboat 0.6.1*
<!-- showboat-id: 8f0c1d2a-4b3e-4f6a-9c5d-7e8a1b2c3d4e -->

G21.15 (issue #549): выбар мовы інтэрфейсу ў My KUDY праезджае ўсе восем
поўных каталогаў на адной зманціраванай паверхні без перазапуску і захоўваецца
праз вытворчую кампазіцыю #491 у durable `settings` радок: без запісу —
зацверджаны дэфолт «be», карупцаваны код чытаецца як «няма выбару», збой
запісу не зламвае выбар сесіі і не выкідвае выключэння ў press-апрацоўнік.
БД — сапраўдны SQLite рухавік (node:sqlite) над вытворчым пластом
`services/db`; перазапуск — зачыненне і паўторнае адкрыццё таго ж файла
сховішча (ідыём G09.01 kill/restart).

Каманда 1: інтэграцыйны тэст кампазіцыі (TAP-радкі — стабільны вывад без
таймінгаў). Адкат сэма захоўвання (`uiLocalePersistence` у
`controllers/deviceServices.ts`) робіць ok 3 і ok 4 чырвонымі — праверана
часовым адкатам перад пушам.

```bash
LD_LIBRARY_PATH=$HOME/.local/lib node --test --test-reporter=tap --experimental-strip-types controllers/deviceServices.integration.test.ts 2>/dev/null | grep -E "^(ok|not ok|1\.\.)"
```

```output
ok 1 - G20.20: the free synthetic package walks the whole production composition
ok 2 - G20.20: without a catalog origin the gate answers null and the root passes the empty port set
ok 3 - G21.15: the ui-locale choice survives force-stop/relaunch through the production composition
ok 4 - G21.15: the ui-locale switch leaves the pinned session locale and entitlement untouched
1..4
```

Каманда 2: стора-тэсты гарда запісу — збой durable запісу пакідае выбар
сесіі стаячым, слухачы страляюць, з `set()` не вылятае выключэнне; наступны
пераключальны запіс праходзіць зноў. Адкат try/catch у
`controllers/uiLocaleStore.ts` робіць абедзве радкі чырвонымі — праверана
часовым адкатам перад пушам.

```bash
LD_LIBRARY_PATH=$HOME/.local/lib node --test --test-reporter=tap --experimental-strip-types controllers/uiLocaleStore.test.ts 2>/dev/null | grep -E "^ok.*G21.15"
```

```output
ok 7 - G21.15 \#549: a failed durable write leaves the switch standing and the listeners firing
ok 8 - G21.15 \#549: after a failed write the next switch writes through again
```

Каманда 3: рэндэр-сьюіта паверхні My KUDY — пікіер праезджае ўсе восем
каталогаў на адной зманціраванай паверхні (тэст «the picker walks all eight
catalogues on one mounted surface»), счотч — стабільны радок без таймінгаў.

```bash
LD_LIBRARY_PATH=$HOME/.local/lib npx jest --config jest.config.js app/my.test.tsx 2>&1 | grep -E "^Tests:"
```

```output
Tests:       19 passed, 19 total
```
