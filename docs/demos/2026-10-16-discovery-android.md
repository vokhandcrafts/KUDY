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
