# G21.35 — Windows-сепаратары ў document-language gate

*2026-10-05T19:10:07Z by Showboat 0.6.1*
<!-- showboat-id: ad482455-9033-443b-998d-68f2641fc0d8 -->

G21.35 (issue #591): `expectedDocumentLocale` чытала першы сегмент URL толькі пасля дзялення па `/`. На Windows `listFiles` аддае rel-шляхы з `\` (гэта `path.relative`), таму `en\app.html` правальваўся ў дэфолт `be`, і карэктна адрындэраныя English-старонкі падалі скан зборкі як `wrong-document-language` — шэсць парушэнняў на чыстым экспорце. Фікс нармалізуе сепаратары да URL-выгляду перад чытаннем прэфікса (той самы ідыём `replaceAll`, што і `unsafeSegments` у `leak-guard.ts`). Дэма праганяе прычэплены рэпра па ўсіх фігурах старонак экспарту ў абодвух сепаратарах: slash-версія і яе backslash-блізнюк павінны даць аднолькавы URL-лакаль.

```python
import os
import pathlib
import subprocess
import sys

sys.stdout.reconfigure(encoding="utf-8", newline="\n")

root = pathlib.Path.cwd()
env = dict(os.environ)
env["LD_LIBRARY_PATH"] = str(pathlib.Path.home() / ".local" / "lib")

script = root / ".g2135-demo-exported-language.ts"
script.write_text(r'''
import { expectedDocumentLocale } from './web/lib/content/exported-language.ts';

const shapes = [
  'en.html',
  'en/app.html',
  'en/index.html',
  'en/guides/demo-route-a1.html',
  'en/guides/demo-route-a1/stops/stop-1.html',
  'index.html',
  'app.html',
  'guides/demo-route-a1/stops/stop-1.html',
  '404.html',
];

for (const slash of shapes) {
  const back = slash.replaceAll('/', '\\');
  const a = expectedDocumentLocale(slash);
  const b = expectedDocumentLocale(back);
  console.log(`${back} -> ${b}${a === b ? '' : ` MISMATCH slash=${a}`}`);
}
''', encoding="utf-8")

run = subprocess.run(
    ["node", "--experimental-strip-types", "--no-warnings", script.name],
    cwd=root,
    env=env,
    capture_output=True,
    text=True,
)
script.unlink()
assert run.returncode == 0, (run.stdout + run.stderr)[-2000:]
sys.stdout.write(run.stdout)
```

```output
en.html -> en
en\app.html -> en
en\index.html -> en
en\guides\demo-route-a1.html -> en
en\guides\demo-route-a1\stops\stop-1.html -> en
index.html -> be
app.html -> be
guides\demo-route-a1\stops\stop-1.html -> be
404.html -> be
```
