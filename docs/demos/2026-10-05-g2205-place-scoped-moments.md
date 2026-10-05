# G22.05 — медыя толькі выбранага месца

*2026-10-05T17:55:12Z by Showboat 0.6.1*
<!-- showboat-id: 7c1e4a2f-93b8-4d06-a5c1-2f8e6b0d91a4 -->

G22.05 (issue #610): чытч фактаў момантаў прымае неабавязковы `options.placeId` — правераныя маніфесты чытаюцца, каб знайсці супадзенні, але аўдыё-проба і `stops.json` разрэшваюцца толькі для супадаючых момантаў; адзін `stops.json` чытаецца і разбіраецца найбольш адзін раз на пакет і мову ў межах аднаго выкліку. Дэма праганяе чытачную світу (фэйкавая крама з метрам чытанняў) і кантролерную — кантролер перадае месца адкрыцця чытчу.

```python
import os, pathlib, subprocess, sys
sys.stdout.reconfigure(encoding='utf-8', newline='\n')
root = pathlib.Path.cwd()
env = dict(os.environ)
env['LD_LIBRARY_PATH'] = str(pathlib.Path.home() / '.local' / 'lib')
run = subprocess.run(
    ['node', '--experimental-strip-types', '--experimental-test-module-mocks', '--test',
     '--test-reporter', 'tap',
     'services/contentRepo/momentFacts.test.ts',
     'controllers/place/placeDetailController.test.ts'],
    capture_output=True, text=True, encoding='utf-8', cwd=root, env=env)
assert run.returncode == 0, run.stdout[-2000:] + run.stderr[-2000:]
plan = None
interesting = ('selected_place_reads_only_matching_media', 'stops_text_read_once_per_package_locale',
               'reopen_observes_new_package_and_locale', 'placeId is refused', 'no manifest matches',
               'own place; a later open')
for line in run.stdout.splitlines():
    if line.startswith('1..'):
        plan = line
    if line.startswith(('ok ', 'not ok ')) and any(k in line for k in interesting):
        print(line)
print(plan)
```

```output
ok 6 - G22.05: each open asks the reader with its own place; a later open never updates the closed binding
ok 17 - G22.05 (AC1): a supplied empty or non-string placeId is refused by name before any store or probe call
ok 18 - G22.05 (AC1): a valid scope with no manifest matches returns no facts and performs no media or text work
ok 19 - G22.05 selected_place_reads_only_matching_media: five packages with twenty stories each — media and text resolve for the one match per package only
ok 20 - G22.05 stops_text_read_once_per_package_locale: two teasers of one package share a single stops read; the preference order is unchanged
ok 21 - G22.05 reopen_observes_new_package_and_locale: the text cache lives inside one call — the next open re-reads a changed package
1..21
```
