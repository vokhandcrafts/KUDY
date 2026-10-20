# G20.36 — аднолькавыя праверкі на Windows і Linux

*2026-10-18T00:40:19Z by Showboat 0.6.1*
<!-- showboat-id: e458e2bf-c4c7-48e7-badf-bbc6174f38ba -->

Задача #816. Праверкі параўноўваюць дакладныя байты генератара, загружаюць модуль са шляху з прабелам, # і %, выдаляюць абароненыя радкі ў часовых копіях і правяраюць шляхі ў паведамленнях. DOMAINS задае поўны спіс файлаў, якім Git павінен захоўваць LF. Перавод шляхоў у слэшы адбываецца толькі пры складанні паведамленняў; праверка сапраўдных шляхоў не змяняецца.

```bash
node -p "process.platform + ' ' + process.version"
git config core.autocrlf
set -o pipefail
node --test --experimental-strip-types --experimental-test-module-mocks --test-reporter=tap tools/ci/adapter-revert-guard.test.mjs tools/ci/windows-android-build-guard.test.mjs tools/i18n/check-messages.test.mjs tools/i18n/generate-messages.test.mjs web/lib/content/attribution-guard.test.ts web/lib/content/exported-language.test.ts tools/ci/eol-pins.test.mjs 2>/dev/null | grep -E '^(# tests |# pass |# fail |# skipped |not ok)'

```

```output
win32 v24.13.0
true
# tests 48
# pass 48
# fail 0
# skipped 0
```
