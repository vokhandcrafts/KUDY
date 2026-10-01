# Issue #431: зярно паперы — тылінг да краёў экрана

*Showboat demo задачи #431 (эпік #346): фактура G06.10.e пакрывала толькі
левы верхні кут спакойных экранаў — адзін тайл ≈180dp, астатні фон плоскі.
Прычына на Android: «repeat» малюецца праз постпрацэсар, што стварае
замошчаную бітмапу памерам view у момант загрузкі; з вымяраным
`absoluteFillObject` першы submit малюнка бяжыць да мантажоўкі, а кэш Fresco
вяртае сапсаваны адналакальны вынік і на паўторным запыце. Фікс: пласт зерня
мае явны памер з `useWindowDimensions`, таму першы submit ужо бачыць усю
паверхню. Створана 2026-10-01.*

<!-- showboat-id: issue431-grain-tiling -->

Крытэр 1 — гард рэжыму тылінгу ў `components/paper-surface.test.tsx`:
явныя `width`/`height` з акна (шпіён на `Dimensions.get` дае сінтэтычныя
411×875, сам хук застаецца сапраўдным) плюс `resizeMode: repeat`.

```sh
node_modules/.bin/jest components/paper-surface.test.tsx 2>&1 | grep -E "^(Tests:|Test Suites:)"
```

```output
Test Suites: 1 passed, 1 total
Tests:       4 passed, 4 total
```

Рэверт-эксперымент (implementation-rules 1): скрыпт адкатвае кампанент да
вымяранага запаўнення, гард чырвоны (падае дакладна тэст #431), файл
аднаўляецца з git — HEAD камітнага дрэва нясе фікс.

```sh
node --input-type=module -e '
import { readFileSync, writeFileSync } from "node:fs";
const p = "components/paper-surface.tsx";
let t = readFileSync(p, "utf8");
const swaps = [
  [/  useWindowDimensions,\n/u, ""],
  [/  \/\/ Issue #431[\s\S]*?surface \(the wrapper.s contract is a full-screen calm surface\)\.\n/u, "    ...StyleSheet.absoluteFillObject,\n"],
  [/  const \{ width, height \} = useWindowDimensions\(\);\n/u, ""],
  [/style=\{\[styles\.grain, \{ width, height \}\]\}/u, "style={styles.grain}"],
];
for (const [re, to] of swaps) {
  if (!re.test(t)) { console.error("no mutation: " + re.source.slice(0, 40)); process.exit(1); }
  t = t.replace(re, to);
}
writeFileSync(p, t);
console.log("reverted to absoluteFillObject");
'
node_modules/.bin/jest components/paper-surface.test.tsx 2>&1 | grep -E "^(Tests:|Test Suites:)"
git checkout -- components/paper-surface.tsx
```

```output
reverted to absoluteFillObject
Test Suites: 1 failed, 1 total
Tests:       1 failed, 3 passed, 4 total
```

Крытэр 3 — правіла месцаў: змяніўся толькі спосаб памеравання пласта,
новых спажыўцоў зерня няма; сюты Run і мапы пінаваюць намаляванае дрэва
без пласта, імпарт-прагулка (`test/design-tokens.test.mjs`) ідзе ў `npm test`.

```sh
node_modules/.bin/jest app/run.test.tsx app/map.test.tsx 2>&1 | grep -E "^(Tests:|Test Suites:)"
```

```output
Test Suites: 2 passed, 2 total
Tests:       41 passed, 41 total
```

Крытэр 2 — жывыя скрыншоты. Захаваныя ў `.scratch/issue-431/screens/`
(untracked, як у дэмах `2026-09-28-issue347-screens-scroll.md` /
`2026-09-28-issue348-navigation-frame.md`): `before-explore-main.png` —
рэпрадукцыя на main 80bee5e (тайл толькі ў куце), `after-explore.png`,
`after-my.png` — пасля фікса (маршруты `/explore` і `/my`; экран /my у
інтэрфейсе называецца «KUDY»), `after-cold-1..3.png` — тры халодныя старты
з аднолькавым зярном. Працэдура жывой праверкі: эмулятар kudy-test
(1080×2400), `adb reverse tcp:8082 tcp:8082`, метро з worktree
(`npx expo start --port 8082 --dev-client`), запуск
`kudy://expo-development-client/?url=exp%3A%2F%2F127.0.0.1%3A8082`, далей
deep-лінкі `kudy://explore` і `kudy://my`; экран здымае
`adb exec-out screencap -p`.
