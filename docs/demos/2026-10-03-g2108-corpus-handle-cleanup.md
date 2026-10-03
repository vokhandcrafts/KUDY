# G21.08 — карпусныя SQLite-хэндлы зачыняюцца да тэставага cleanup

*Showboat demo for issue #541 (`tools/corpus/store.test.mjs`, `tools/corpus/backup.test.mjs`), created 2026-10-03.*

Дэфект: сем тэстаў `store.test.mjs` (праз `makeStore`) і `restore_roundtrip`
у `backup.test.mjs` выдалялі свае часовыя тэчкі над жывым злучэннем
`node:sqlite` — на Windows гэта восем EPERM пры cleanup (задача #541). Фікс:
`closeCorpus` да выдалення + агульны цэнзус
`assertNoOpenHandlesUnder` (`tools/corpus/fixtures/handles.mjs`), які
правярае праз `/proc/self/fd`, што ніводзін дэскрыптар не ўказвае ў
пясочніцу; на Windows той самы кантракт дае сам `rmSync`.

Кожны блок задае `LD_LIBRARY_PATH=$HOME/.local/lib` яўна: node гэтага хоста
патрабуе `libsimdjson.so.33` з `~/.local/lib`, а Showboat запускае блокі ў
ачышчаным асяроддзі (implementation-rules 9).

Першы блок — факт асяроддзя: пруф платформы камандай, не прозай
(implementation-rules 9):

```sh
LD_LIBRARY_PATH="$HOME/.local/lib" node -p "process.platform"
```

```output
linux
```

Другі блок — механізм дэфекта да фікса на ўмове, якую цэнзус вымярае:
пакуль злучэнне жывое, census-fail = 1 (на Windows той самы момант дае
EPERM на `rmSync`); пасля `close()` — 0. Выхад 0 толькі пры гэтай пары
значэнняў, выпадковы шлях пясочніцы не друкуецца:

```sh
LD_LIBRARY_PATH="$HOME/.local/lib" node --input-type=module -e "
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { assertNoOpenHandlesUnder } from './tools/corpus/fixtures/handles.mjs';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kudy-demo-'));
const db = new DatabaseSync(path.join(dir, 'corpus.db'));
db.prepare('CREATE TABLE t (x INTEGER)').run();
let whileOpen = 0;
try { assertNoOpenHandlesUnder(dir); } catch { whileOpen = 1; }
db.close();
let afterClose = 0;
try { assertNoOpenHandlesUnder(dir); } catch { afterClose = 1; }
fs.rmSync(dir, { recursive: true, force: true });
console.log('census fails while the handle is open: ' + whileOpen + ', after close: ' + afterClose);
if (whileOpen !== 1 || afterClose !== 0) process.exit(1);
"
```

```output
census fails while the handle is open: 1, after close: 0
```

Трэці блок — пасля фікса: абодва сюты зялёныя, у cleanup-часе ніводнага
жывога дэскрыптара (інакш after-хук падаў бы тэст, як у прагоне да фікса —
восем чырвоных, гл. вынікі G21.08):

```sh
LD_LIBRARY_PATH="$HOME/.local/lib" node --test tools/corpus/store.test.mjs tools/corpus/backup.test.mjs 2>&1 | grep -E "ℹ (tests|pass|fail|skipped) [0-9]+"
```

```output
ℹ tests 12
ℹ pass 12
ℹ fail 0
ℹ skipped 0
```
