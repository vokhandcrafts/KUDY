# G21.05 — партатыўныя мяжы параўнання шляхоў у CI-гвардах

*Showboat demo for issue #538 (`tools/ci/deno-typecheck.test.mjs`, `tools/ci/test-discovery.test.mjs`), created 2026-10-03.*

Дэфект з рэтэсту 2026-10-03: на Windows `path.relative` і `discoverTests`
адказваюць натыўнымі раздзяляльнікамі (`device\index.ts`), а параўнанні ў
гвардах цытавалі літэралы з `/` — абедзьве няўдачы запісаныя ў
`docs/testing/evidence/2026-10-03-retest/npm-test.log`. Фікс — ідыём A26-08
(`.split(path.sep).join('/')`) на мяжы параўнання + трыпвайры, што
рэгенеруюць win32-формы з лагу на любым хасце. Кожны блок задае
`LD_LIBRARY_PATH=$HOME/.local/lib` яўна: node гэтага хаста патрабуе
`libsimdjson.so.33` з `~/.local/lib`, а Showboat запускае блокі ў ачышчаным
асяроддзі (implementation-rules 9).

Першы блок — факт асяроддзя: пруф платформы камандай, не прозай
(implementation-rules 9):

```sh
LD_LIBRARY_PATH="$HOME/.local/lib" node -p "process.platform"
```

```output
linux
```

Другі блок — механізм абедзвюх запісаных няўдач да фіксу: мяжа параўнання
бяз канверсіі, фактычны бок згенераваны win32-семантыкай (той самы API, што
даў `device\index.ts` у лагу). Параўнанне падае — выхад 1:

```sh
LD_LIBRARY_PATH="$HOME/.local/lib" node --input-type=module -e "
import path from 'node:path';
import assert from 'node:assert/strict';
const win = path.win32.join('C:', 'kudy', 'supabase', 'functions');
const actual = ['device/index.ts', 'events/index.ts', 'grant/index.ts', 'rc-webhook/index.ts']
  .map((entry) => path.win32.join(win, entry))
  .map((entry) => path.win32.relative(win, entry));
assert.deepEqual(actual, ['device/index.ts', 'events/index.ts', 'grant/index.ts', 'rc-webhook/index.ts']);
" 2>/dev/null; echo "pre-fix boundary exit=$?"
```

```output
pre-fix boundary exit=1
```

Трэці блок — пасля фіксу: абодва гварды зялёныя, абодва новыя трыпвайры
G21.05 прабягаюць (яны і ёсць камітованая праверка, што падае пры зняцці
канверсіі), у наборы нуль няўдачаў. Дэном Deno 2.9.7 знойдзены, таму
рантайм-тэсты бяжыць жывымі, без скіпаў:

```sh
LD_LIBRARY_PATH="$HOME/.local/lib" node --test tools/ci/deno-typecheck.test.mjs tools/ci/test-discovery.test.mjs 2>&1 | grep -E "G21\.05|fail [0-9]" | sed -E 's/ \([0-9.]+m?s\)//'
```

```output
✔ the enumeration comparison holds for Windows separators (G21.05)
✔ the jest-wiring zone prefixes hold for Windows separators (G21.05)
ℹ fail 0
```

Чацвёрты блок — пасаджаная прадукцыйная фікстура A26-01 па-ранейшаму
адхіляецца з іменаванай TS-дыягностыкай (адна памылка, адмова — не крэш):

```sh
LD_LIBRARY_PATH="$HOME/.local/lib" NO_COLOR=1 KUDY_DENO="$HOME/.local/bin/deno" node tools/ci/deno-typecheck.mjs --file supabase/functions/_fixtures/deno-async-mismatch.ts 2>/tmp/kudy-g2105-fixture.log; echo "exit=$?"; grep -cE "TS[0-9]+" /tmp/kudy-g2105-fixture.log
```

```output
exit=1
1
```

Пяты блок — зняты jest-wiring па-ранейшаму дае поўны спіс unowned-сьютаў
з абедзвюма зонамі, іменаванымі праз тую ж мяжу канверсіі (лічбы не
друкуем — яны гніюць пры кожным новым сьюце):

```sh
LD_LIBRARY_PATH="$HOME/.local/lib" node --input-type=module -e "
import path from 'node:path';
import { discoverTests } from './tools/ci/test-discovery.mjs';
import fs from 'node:fs';
const stripped = fs.readFileSync('jest.config.js', 'utf8').replace(/testMatch:\s*\[[^\]]*\]/u, 'testMatch: []');
const { unowned } = discoverTests({ jestConfigSource: stripped });
const inRepoStyle = unowned.map((file) => file.split(path.sep).join('/'));
console.log('app zone named:', inRepoStyle.some((file) => file.startsWith('app/')));
console.log('components zone named:', inRepoStyle.some((file) => file.startsWith('components/')));
"
```

```output
app zone named: true
components zone named: true
```
