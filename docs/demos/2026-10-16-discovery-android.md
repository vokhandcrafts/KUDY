# G23.06 Android discovery seams

*2026-10-16T20:50:35Z by Showboat 0.6.1*
<!-- showboat-id: a4dc9dce-ac80-4d3c-92b8-436c7c986a98 -->

Synthetic fixtures exercise the published Discovery index, a private feedback endpoint, and Android runner wiring. The commands below require no emulator; the installed-app result is recorded in docs/agent-tasks/results/G23.06.md.

```bash
node --test tools/e2e-origin/e2e-origin.test.mjs tools/e2e-android/wiring.test.mjs >/dev/null && echo "synthetic origin and Android wiring: PASS"
```

```output
synthetic origin and Android wiring: PASS
```

```bash
node --test services/contentRepo/discoverySnapshot.test.ts controllers/deviceServices.integration.test.ts controllers/moment/momentPlayController.test.ts >/dev/null && echo "device persistence, composition and Moment takeover: PASS"
```

```output
device persistence, composition and Moment takeover: PASS
```

```bash
node --test tools/build-bundle/build-bundle.test.mjs services/contentRepo/momentFacts.test.ts >/dev/null && echo "locked Moment manifest and device reader: PASS"
```

```output
locked Moment manifest and device reader: PASS
```

Паўторная кампазіцыя аднаўляе кропкі падказак з праверанага пакета. Адно
вяртанне ў foreground перад тэрмінам паўтору водгуку ставіць таймер на
`next_attempt_at` і адпраўляе той самы mutation ID. Першая offline-адпраўка
без рэгістрацыі таксама атрымлівае таймер; пасля аднаўлення сеткі адкрытая
форма паказвае пацверджаны стан без пераходу ў background.

```bash
node --test controllers/deviceServices.integration.test.ts controllers/useNearbyController.test.ts >/dev/null && echo "restart hints, offline registration retry and live feedback state: PASS"
```

```output
restart hints, offline registration retry and live feedback state: PASS
```

Публічны індэкс цяпер змяшчае кропкі гіда, вылічаныя пры зборцы з
`route.json` і `places.json`. Падказка знаходзіць другі гід праз гэты індэкс,
нават калі яго пакет яшчэ не ўсталяваны.

```bash
node --test --experimental-strip-types --experimental-test-module-mocks --test-concurrency=1 contracts/contracts.test.mjs controllers/useNearbyController.test.ts services/catalog/catalogService.test.ts tools/build-bundle/build-bundle.test.mjs tools/e2e-origin/e2e-origin.test.mjs >/dev/null && echo "uninstalled guide preview hint: PASS"
```

```output
uninstalled guide preview hint: PASS
```

Пасля аварыйнага закрыцця падчас адпраўкі водгук у стане `sending`
плануецца на паўтор пры наступным запуску кампазіцыі. Праверка таксама
супастаўляе ўбудаваны demo catalog з вынікам публікатара пасля змены індэкса.

```bash
node --test --experimental-strip-types --experimental-test-module-mocks controllers/deviceServices.integration.test.ts test/demo-catalog.test.mjs >/dev/null && echo "feedback crash recovery and published demo bytes: PASS"
```

```output
feedback crash recovery and published demo bytes: PASS
```

Android-сцэнар пасля рэдагавання водгуку цяпер чытае прыватны сінтэтычны
endpoint і чакае новай рэвізіі з ацэнкай 5. Рэгрэсійны тэст правярае, што
ранейшы адказ з ацэнкай 4 не лічыцца поспехам.

```bash
node --test tools/e2e-android/wiring.test.mjs tools/e2e-origin/e2e-origin.test.mjs >/dev/null && echo "feedback revision assertion: PASS"
```

```output
feedback revision assertion: PASS
```

Пасля крашу сямідзённы тэрмін дзейнічае і для запісу `sending`:
пратэрмінаваны водгук патрабуе пацвярджэння перад сеткавай спробай.
Сінтэтычны endpoint адхіляе няправільны HTTP-метад для кожнай аперацыі.

```bash
node --test --experimental-strip-types --experimental-test-module-mocks tests/feedback/queue-sync.test.ts tools/e2e-origin/e2e-origin.test.mjs >/dev/null && echo "expired sending and feedback methods: PASS"
```

```output
expired sending and feedback methods: PASS
```

Калі Place перакрыты прэв’ю гіда, апытанне фізічнага Moment спыняецца;
вяртанне на Place аднаўляе апытанне. Тэст пакідае кампанент змантаваным,
мяняе pathname і правярае лік рэальных чытанняў playback да пераходу,
падчас прэв’ю і пасля вяртання.

```bash
npx jest --config jest.config.js --runInBand --runTestsByPath app/place/place.test.tsx --silent >/dev/null 2>&1 && echo "Place playback focus: PASS"
```

```output
Place playback focus: PASS
```

Сінтэтычнае чытанне водгуку сканчаецца ў агульны тэрмін і пры завіслым
HTTP-адказе. Origin адказвае 413 на цела больш за 8 KiB і прымае наступны
сапраўдны запыт.

```bash
node --test tools/e2e-android/wiring.test.mjs tools/e2e-origin/e2e-origin.test.mjs >/dev/null && echo "feedback HTTP deadlines and body limit: PASS"
```

```output
feedback HTTP deadlines and body limit: PASS
```

Пасля dispose кантролер Nearby вызваляе падпіскі на GPS, аўдыя і Run;
стары кантролер больш не апрацоўвае іх падзеі. Сінтэтычны endpoint адхіляе
8193 байты з 413 паводле кантракта §5.3.

```bash
node --test --experimental-strip-types --experimental-test-module-mocks controllers/useNearbyController.test.ts controllers/deviceServices.integration.test.ts >/dev/null && node --test tools/e2e-origin/e2e-origin.test.mjs >/dev/null && echo "Nearby teardown and 8 KiB feedback limit: PASS"
```

```output
Nearby teardown and 8 KiB feedback limit: PASS
```
