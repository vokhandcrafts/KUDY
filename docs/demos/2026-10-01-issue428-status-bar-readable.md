# Issue #428: чытэльны статус-бар на светлай тэме

*Showboat demo задачи #428 (эпік #346): гадзіннік і цішоткі статус-бара мелі
сістэмны дэфолт і знікалі на светлай паперы #faf7f2. Фікс: адна канфігурацыя
expo-status-bar у корані навігацыі `app/_layout.tsx` —
`style={statusBarStyle(theme)}` (тэмавы рэзолвер з #436; у светлым рэжыме
дае dark-content, RN-эквівалент); экраны нічога не задаюць. Створана
2026-10-01.*

<!-- showboat-id: issue428-status-bar -->

Крытэр 1 — канфігурацыя ў адным месцы: па ўсім дадатку літарал
`<StatusBar` сустракаецца ў трох файлах — карань навігацыі, яго даслоўная
люстра ў тэставым хэлперы (каментар люстры анкераваны на
`app/_layout.tsx`) і гард кантракту #436 ў `test/design-runtime-theme.test.mjs`,
які прыбівае адзіную канфігурацыю да кораня; ніводзін экран уласнага
статус-бара не мае.

```sh
git grep -l "<StatusBar" -- app/ components/ test/
```

```output
app/_layout.tsx
test/design-runtime-theme.test.mjs
test/render-helpers.tsx
```

Крытэр 2 — гард `app/status-bar.test.tsx`: мантаваньне рэальнага
RootLayout (не люстры) з жарцамі-прабам на expo-status-bar і праверка, што
корань у змоўклівым (светлым) рэндэры дае `style="dark"`.

```sh
node_modules/.bin/jest app/status-bar.test.tsx 2>&1 | grep -E "^(Tests:|Test Suites:)"
```

```output
Test Suites: 1 passed, 1 total
Tests:       2 passed, 2 total
```

Рэверт-эксперымент (implementation-rules 1): скрыпт выдаляе радок
канфігурацыі з камітнага дрэва (без прывязкі да канцоў радкоў — CRLF/LF),
гард чырвоны (падае дакладна тэст #428), файл аднаўляецца з git — HEAD
камітнага дрэва нясе фікс.

```sh
node --input-type=module -e '
import { readFileSync, writeFileSync } from "node:fs";
const p = "app/_layout.tsx";
const t = readFileSync(p, "utf8");
const line = /^[ \t]*<StatusBar style=\{statusBarStyle\(theme\)\} \/>\r?\n/m;
if (!line.test(t)) { console.error("no config line"); process.exit(1); }
writeFileSync(p, t.replace(line, ""));
console.log("removed the statusBarStyle line");
'
node_modules/.bin/jest app/status-bar.test.tsx 2>&1 | grep -E "^(Tests:|Test Suites:)"
git checkout -- app/_layout.tsx
```

```output
removed the statusBarStyle line
Test Suites: 1 failed, 1 total
Tests:       1 failed, 1 passed, 2 total
```

Крытэр 3 — жывыя скрыншоты. Захаваныя ў `.scratch/issue-428/screens/`
(untracked, як у дэме `2026-10-01-issue431-grain-tiling.md`):
`after-cold-1.png` — халодны старт (суроўны +not-found, статус-бар таксама
чытэльны), `after-explore.png`, `after-my.png` — пасля фікса (маршруты
`/explore` і `/my`; экран /my у інтэрфейсе называецца «KUDY»). Працэдура
жывой праверкі: эмулятар kudy-test (1080×2400), `adb reverse tcp:8082
tcp:8082`, метро з worktree (`npx expo start --port 8082 --dev-client`),
запуск
`kudy://expo-development-client/?url=exp%3A%2F%2F127.0.0.1%3A8082`, далей
deep-лінкі `kudy://explore` і `kudy://my`; экран здымае
`adb exec-out screencap -p`. На ўсіх трох экранах гадзіннік і цішоткі
цёмныя і чытэльныя на паперы — канфігурацыя кораня працуе паўсюль, не
толькі на табах.
