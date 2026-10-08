# Мяжа часу для завіслага браузернага тэста

*2026-10-08T10:09:08Z by Showboat 0.6.1*
<!-- showboat-id: adc14915-96d2-43a8-8a4b-dd50b0d3182a -->

Доказ карты чакаў адказ Chrome без мяжы. Калі DevTools не адказваў, працэс тэста не завяршаўся і журнал CI спыняўся пасля апошняга надрукаванага тэста. Каманда CDP цяпер мае мяжу і забівае працэс браўзера. `--test-timeout` асобна спыняе файл, які сам не завяршаецца, і называе яго ў вывадзе.

```python
import os, re, subprocess, sys, textwrap
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8', newline='\n')
env = os.environ | {'NODE_NO_WARNINGS': '1'}

def show(args):
    result = subprocess.run(args, capture_output=True, text=True, encoding='utf-8', env=env)
    for line in result.stdout.splitlines():
        if 'duration_ms' in line:
            continue
        print(re.sub(r' \([\d.]+ms\)$', '', line))
    err = result.stderr.strip()
    if err:
        print(err)
    return result.returncode

hang = Path('/tmp/kudy-deliberate-hang.test.mjs')
hang.write_text(textwrap.dedent('''\
import { test } from 'node:test';
test('deliberate hang names this file', async () => {
  await new Promise((resolve) => setTimeout(resolve, 120000));
});
'''), encoding='utf-8')
print('command timeout:')
rc_timeout = show(['node', '--test', '--experimental-test-module-mocks', '--test-reporter=spec', 'test/cdp-command-timeout.test.mjs'])
print('per-test timeout:')
rc_hang = show(['node', '--test', '--test-reporter=spec', '--test-timeout=1000', str(hang)])
assert rc_timeout == 0, rc_timeout
assert rc_hang != 0, rc_hang
```

```output
command timeout:
✔ CDP command: a command that never replies fails within its timeout and kills the child
ℹ tests 1
ℹ suites 0
ℹ pass 1
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
per-test timeout:
✖ /tmp/kudy-deliberate-hang.test.mjs
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 0
ℹ cancelled 1
ℹ skipped 0
ℹ todo 0

✖ failing tests:

test at ../tmp/kudy-deliberate-hang.test.mjs:1:1
✖ /tmp/kudy-deliberate-hang.test.mjs
  'test timed out after 1000ms'
```
