# G20.20 — вытворчая кампазіцыя прылады: скразны цыкл

*2026-10-06T12:40:00Z by Showboat 0.6.1*
<!-- showboat-id: b05711bf-b5f3-4a6e-9023-531737765b12 -->

G20.20 (issue #491): бясплатны сінтэтычны пакет праходзіць увес цыкл праз
вытворчую кампазіцыю — каталог → загрузка/хэш/актывацыя → Start → Pause →
restart → End — плюс яўна недаступная купля. Стэнд-іны стаяць толькі на мяжы
Expo/OS (фэйкавыя File/Directory класы, фэйкавыя парты GPS/гуку, стаб fetch);
БД — сапраўдны SQLite рухавік (node:sqlite) над вытворчым пластом
`services/db`, дайджэст — сапраўдны node:crypto над тымі ж байтамі, што
хэшуе expo-crypto на прыладзе.

Каманда 1: інтэграцыйны тэст кампазіцыі (TAP-радкі — стабільны вывад без
таймінгаў). Адкат люстэркі кампазіцыі (lock-запіс, readiness-брама,
unavailable-парт) робіць гэты прагон чырвоным. Перазахоп 2026-10-06: сюіта
дасягнула чатырох тэстаў — G21.15 (#549) дадаў свае два пруфы ў гэты файл.

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

Каманда 2: машынная брама межаў слаёў на змененым дрэве — кампазіцыйныя
карані кантролераў (createServices/sessionPorts/deviceServices/deviceRoot)
дазволеныя value-імпартаваць `services/`, астатнія — не; `app/` не
імпартуе `services/` прама. Парушэнняў — нуль. Перазахоп 2026-10-06:
worktree zcode-491 пасля мержу прыбраны, брама знята з асноўнага чэкаўта.

```bash
cd /home/viktar/Projects/KUDY && LD_LIBRARY_PATH=$HOME/.local/lib npm run arch:check --silent 2>&1 | grep -o "arch:check: OK"
```

```output
arch:check: OK
```
