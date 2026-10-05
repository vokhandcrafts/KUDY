# G22.02 — тэйзер-аўдыё без загрузкі цела файла

*2026-10-05T11:53:26Z by Showboat 0.6.1*
<!-- showboat-id: d910d9dd-ee71-4184-b944-1fabed4dda0c -->

G22.02 (issue #607): тэйзер-аўдыё вырашаецца праз асобны TeaserAudioProbe — чытэльны няпусты звычайны файл — ніколі не чытаючы .m4a праз краму. Дэма праганяе чытачную світу (фэйкавая крама, 10 тэстаў), новы набор рэальнага адаптара nodeBundlesStore (5 тэстаў: лічыльнік байтаў, метаданныя негатывы, POSIX permission, адпусканне дэскрыптароў) і revert-факт: пры поўначытанні метр бачыць аўдыё-байты.

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
     'services/contentRepo/nodeBundlesStore.test.ts'],
    capture_output=True, text=True, encoding='utf-8', cwd=root, env=env)
assert run.returncode == 0, run.stdout[-2000:] + run.stderr[-2000:]
plan = None
interesting = ('teaser_discovery', 'invalid_media_metadata', 'metadata_probe_releases',
               'missing probe', 'empty teaser media')
for line in run.stdout.splitlines():
    if line.startswith('1..'):
        plan = line
    if line.startswith(('ok ', 'not ok ')) and any(k in line for k in interesting):
        print(line)
print(plan)
```

```output
ok 9 - G22.02 (AC2): an empty teaser media is not a playable path — the fallback continues to the next locale
ok 10 - G22.02: a missing probe is the named configuration error — refused before any store call
ok 11 - teaser_discovery_does_not_read_audio_body: the card resolves the teaser path without the .m4a bytes
ok 12 - invalid_media_metadata_falls_back: empty media falls to the next locale, never a dead path
ok 13 - invalid_media_metadata_falls_back: a permission-denied media file is not playable (POSIX)
ok 15 - metadata_probe_releases_handles: the bounded open closes on every path
1..15
```
