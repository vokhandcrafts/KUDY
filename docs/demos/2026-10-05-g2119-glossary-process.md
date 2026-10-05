# G21.19 — глоссарый і працэс змены мов у адным каміце

*2026-10-05T08:21:40Z by Showboat 0.6.1*
<!-- showboat-id: 875f78ab-a26a-4b96-a1b2-ce927b7cd8b9 -->

G21.19 (issue #543): версляваны глоссарый сямі тэрмінаў з анкерамі на кананічныя запісы і follow-up паходжаннем, кернел-фікс крыж-файлавых $ref у чытальніку схем, крытэрыйны набор лічэбнікаў (0/1/2/5/11/21, дробавыя, мяжы timeCap 60/120/240) праз жывыя селектары. Дэма праганяе тэсты кантракту глоссара і рэндэру лічэбнікаў на рэальным дрэве (ён не мяняецца) і завяршае жывым запускам гейта выпушчаных моў.

```python
import os, pathlib, subprocess, sys
sys.stdout.reconfigure(encoding='utf-8', newline='\n')
root = pathlib.Path.cwd()
env = dict(os.environ)
env['LD_LIBRARY_PATH'] = str(pathlib.Path.home() / '.local' / 'lib')
run = subprocess.run(
    ['node', '--experimental-strip-types', '--test', '--test-reporter', 'tap',
     'contracts/ui-messages/glossary.test.mjs', 'test/ui-messages-number-render.test.mjs'],
    capture_output=True, text=True, encoding='utf-8', cwd=root, env=env)
assert run.returncode == 0, run.stdout[-2000:] + run.stderr[-2000:]
plan = None
for line in run.stdout.splitlines():
    if line.startswith('1..'):
        plan = line
    if line.startswith(('ok ', 'not ok ')) and ('glossary' in line or 'date-typed' in line or 'timeCap' in line or 'stopsCount' in line):
        print(line)
print(plan)
gate = subprocess.run(
    ['node', '--experimental-strip-types', 'tools/i18n/check-messages.mjs'],
    capture_output=True, text=True, encoding='utf-8', cwd=root, env=env)
assert gate.returncode == 0, gate.stdout + gate.stderr
print(gate.stdout.strip())
```

```output
ok 1 - the shipped glossary passes schema and cross-file rules
ok 3 - glossary_anchor_unknown: an entry anchored outside the canonical source is rejected
ok 4 - glossary_locale_missing: a shipped locale without a reviewed term is rejected
ok 5 - glossary_locator_mismatch: the locator path must name the entry locale
ok 6 - glossary_locator_unresolved: a locator record missing from the shipped set is rejected
ok 8 - glossary_schema_version_denied: a foreign envelope version is rejected
ok 12 - the canonical source has no date-typed parameters (rendered dates are pre-formatted strings)
ok 13 - [be] stopsCount: values 0/1/2/5/11/21/5.5 render substituted, never blank or raw
ok 21 - [be] timeCap: discrete forms switch exactly at 60/120/240, everything else interpolates
ok 22 - [en] stopsCount: values 0/1/2/5/11/21/5.5 render substituted, never blank or raw
ok 30 - [en] timeCap: discrete forms switch exactly at 60/120/240, everything else interpolates
ok 31 - [uk] stopsCount: values 0/1/2/5/11/21/5.5 render substituted, never blank or raw
ok 39 - [uk] timeCap: discrete forms switch exactly at 60/120/240, everything else interpolates
1..39
check-messages: shipped locales complete, reviewed and fresh
```
