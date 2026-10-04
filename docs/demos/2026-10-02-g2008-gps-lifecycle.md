# G20.08 — спыненне GPS і жыццёвы цыкл «Побач»

*2026-10-02T15:09:00Z by Showboat 0.6.1*
<!-- showboat-id: 32bb5155-1507-4124-ac5b-a465030099c9 -->

Вытворчыя GPS-адаптар і React-хук правераныя праз заменнікі толькі на мяжы Expo і React Native. Доказ правярае парадак аперацый і вызваленне ўладальніка; фізічны GPS, батарэя і Android/iOS тут не правераныя. Параметр testMatch у лакальнай камандзе Jest абмінае праблему абсалютнага Windows-шляху ў тэчцы .codex; стандартная канфігурацыя праекта не змененая.

```python
import os, re, subprocess, sys
sys.stdout.reconfigure(encoding='utf-8', newline='\n')
result = subprocess.run(['node', '--test', '--experimental-strip-types', '--experimental-test-module-mocks', '--test-reporter=spec', 'services/location/expo/expo-location-port.test.ts'], capture_output=True, text=True, encoding='utf-8', env=os.environ | {'NODE_NO_WARNINGS': '1'})
for line in sorted(result.stdout.splitlines()):
    if 'duration_ms' not in line:
        print(re.sub(r' \([\d.]+ms\)$', '', line))
if result.stderr:
    print(result.stderr.strip())
assert result.returncode == 0, result.returncode

```

```output
location adapter: background updates refused (Error: native start refused)
location adapter: background updates refused (Error: native start refused)
location adapter: the background scope is not granted — the session continues on the foreground watch
ℹ cancelled 0
ℹ fail 0
ℹ pass 14
ℹ skipped 0
ℹ suites 0
ℹ tests 14
ℹ todo 0
✔ all_permissions_denied: neither watcher starts and the visible permission state stays accurate
✔ background_denied_limited_path: a background-intent start with the scope denied runs the foreground watch
✔ background_granted_starts_updates: the granted background scope still starts and stops the background task
✔ background_to_foreground: a delayed stopped task cannot survive under a city watch
✔ current_start_rejection: the foreground fallback remains usable and is released
✔ delayed_foreground_after_stop: a pending foreground handle removes itself
✔ delayed_start_after_stop: a late native start leaves no background task
✔ foreground_granted_background_denied: a background denial keeps the granted foreground session running
✔ initial_permission_read_superseded: the constructor read cannot overwrite a newer ask
✔ obsolete_foreground_callback: an old watcher cannot tag its fix as the new owner
✔ old_stop_new_start: a pending native stop finishes before the replacement starts
✔ pending_stop_check_new_start: a delayed status answer cannot stop the replacement
✔ stale_permission_reply: a superseded ask cannot overwrite a newer capability decision
✔ start_rejection_after_stop: a rejected obsolete start never creates a fallback watch
```

```python
import json, subprocess, sys, tempfile
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8', newline='\n')
with tempfile.TemporaryDirectory(prefix='kudy-g2008-') as directory:
    output = Path(directory) / 'result.json'
    result = subprocess.run(['node', 'node_modules/jest/bin/jest.js', '--config', 'jest.config.js', '--runInBand', '--testMatch', '**/app/**/*.test.tsx', '--testNamePattern', 'Nearby app lifecycle', '--json', '--outputFile', str(output), '--', 'app/map.test.tsx'], capture_output=True, text=True, encoding='utf-8')
    if result.returncode:
        print(result.stdout)
        print(result.stderr)
    assert result.returncode == 0, result.returncode
    report = json.loads(output.read_text(encoding='utf-8'))
    cases = [case for suite in report['testResults'] for case in suite['assertionResults'] if any(title.startswith('Nearby app lifecycle') for title in case['ancestorTitles'])]
    assert len(cases) == 4
    for case in cases:
        assert case['status'] == 'passed', case
        print(case['title'] + ': ' + case['status'])

```

```output
nearby_background_foreground: stops its watch and resumes once without duplicates: passed
nearby_background_active_run: background and unmount preserve the walk owner: passed
nearby_disposed_callback: a removed lifecycle listener cannot restart location: passed
nearby_initial_background: a mounted screen waits for foreground before arming: passed
```
