# G21.21 — змешаныя мовы праз вытворчую кампазіцыю

*2026-10-07 by Showboat 0.6.1*

G21.21 (issue #553): fr-тэкст і en-аўдыё праходзяць увес цыкл праз вытворчую
кампазіцыю (#491) — чыпы аўдыё ў прэв'ю → загрузка абодвух пластаваў →
Start-брама выбранага аўдыёплата → dwell гучыць en-шляхам для fr-гісторыі →
Pause → restart з аднаўленнем піна і прагрэсу (ADR G21.20 §3.4) → End; плюс
text-only гід без адзінай аўдыёкаманды. Стэнд-іны — толькі на мяжы Expo/OS,
як у прынятым цыкле G20.20.

Каманда 1: рухавік — сцэнары ADR §4 на рэдуктары (шлях ад аўдыёпіна,
пер-пластовае пашырэнне грантаў, text-only, foreign_grant_denied, адкат
няладнага запуску). Адкат выразу шляху ці маршрутызацыі `AccessReady` робіць
сюіту чырвонай.

```bash
cd /home/viktar/worktrees/zcode-553 && LD_LIBRARY_PATH=$HOME/.local/lib node --test --test-reporter=tap core/engine/audio-pin.test.ts 2>/dev/null | grep -cE "^ok"
```

```output
14
```

Каманда 2: кампазіцыя — змешаны цыкл і text-only праз рэальныя сэрвісы
(каталог → загрузка/хэш/актывацыя абодвух пластаваў → Start → dwell →
restart → End, TAP-радкі — стабільны вывад без таймінгаў). Адкат кампазіцыйнай
праводкі (lock-запіс, readiness-брама выбранага аўдыёплата, §3.4
аднаўленне піна) робіць гэты прагон чырвоным.

```bash
cd /home/viktar/worktrees/zcode-553 && LD_LIBRARY_PATH=$HOME/.local/lib node --test --test-reporter=tap --experimental-strip-types controllers/deviceServices.integration.test.ts 2>/dev/null | grep -E "^(ok|not ok|1\.\.)"
```

```output
ok 1 - G20.20: the free synthetic package walks the whole production composition
ok 2 - G20.20: without a catalog origin the gate answers null and the root passes the empty port set
ok 3 - G21.15: the ui-locale choice survives force-stop/relaunch through the production composition
ok 4 - G21.15: the ui-locale switch leaves the pinned session locale and entitlement untouched
ok 5 - G21.21 mixed_language_offline_restart: fr text and en audio through the production composition
ok 6 - G21.21 text_only_no_audio: a guide without audio walks text-only through the composition
1..6
```

Каманда 3: машынная брама межаў слаёў на змененым дрэве. Парушэнняў — нуль.

```bash
cd /home/viktar/worktrees/zcode-553 && LD_LIBRARY_PATH=$HOME/.local/lib npm run arch:check --silent 2>&1 | grep -o "arch:check: OK"
```

```output
arch:check: OK
```
