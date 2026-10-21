# APR-04 — месца-правадка Nearby і лэйбл картак

*2026-10-21T13:43:58Z by Showboat 0.6.1*
<!-- showboat-id: b5565e64-fa1e-48f2-a95d-bd0877c9764d -->

APR-04, issue #809. Два дэфекты з рэгрэсійнымі тэстамі, якія падаюць пры адкаце:

1. app/map.tsx — a11y-лэйбл картак «Побач» чытаў сыры токен offer.access («free»); выпраўлена на uiStrings(locale).access[offer.access]. Тэст app/map.test.tsx пініць лэйбл «Двор сукнараў, Бясплатна».
2. controllers/deviceServices.ts — у літарале ports быў прапушчаны top-level location, таму паверхня «Побач» не ўзбройвалася і сістэмны дыялог дазволу не з'яўляўся на любых device-зборках (кантракт G07.01 / 19 §3.3: run sessions і Nearby surface маюць атрымліваць той самы экзэмпляр). Тэст controllers/deviceServices.integration.test.ts фіксуе біндынг і ідэнтычнасць экзэмпляра.

```bash
npx jest app/map.test.tsx --silent 2>&1 | grep -E '^(Tests|Test Suites):'
```

```output
Test Suites: 1 passed, 1 total
Tests:       25 passed, 25 total
```

```bash
node --test --experimental-strip-types --test-reporter=spec --test-timeout=60000 controllers/deviceServices.integration.test.ts 2>&1 | grep -E 'ℹ (pass|fail)'
```

```output
ℹ pass 8
ℹ fail 0
```

Абодва рэгрэсійныя тэсты падаюць пры адкаце адпаведнае праўкі: праверка зробленая перад камітам (git stash: 1 failed у map.test.tsx; fail кампазіцыйнага тэсту). Полная аўтаматыка на гэтым HEAD: npm test — Node 2626 tests (2595 pass, 31 skipped, 0 fail) + Jest 31 наборы (263 pass); typecheck, arch:check (630 модуляў, 0 парушэнняў), jscpd 5.1.2 (0 clones), showboat verify — усе exit 0.
