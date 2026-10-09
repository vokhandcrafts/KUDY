# Мяжа часу для завіслага браузернага тэста

*2026-10-08T10:09:08Z by Showboat 0.6.1*
<!-- showboat-id: adc14915-96d2-43a8-8a4b-dd50b0d3182a -->

Доказ карты чакаў адказ Chrome без мяжы. Калі DevTools не адказваў, працэс тэста не завяршаўся і журнал CI спыняўся пасля апошняга надрукаванага тэста. Каманда CDP цяпер мае мяжу і забівае працэс браўзера. `--test-timeout` адмяняе тэст і называе яго. Мяжа `timeout-minutes: 10` спыняе працэс, які трымаюць жывыя дэскрыптары. Версію Node друкуе вывад.

```python
import os, re, subprocess, sys, textwrap, time
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

node = subprocess.check_output(['node', '--version'], text=True, encoding='utf-8').strip()
print('node', node)

workflow = Path('.github/workflows/required-checks.yml').read_text(encoding='utf-8')
tests_job = workflow.split('\n  windows-portable:', 1)[0]
assert 'timeout-minutes: 10' in tests_job
print('спыненне працэсу з жывымі дэскрыптарамі: timeout-minutes: 10')

hang = Path('/tmp/kudy-deliberate-hang.test.mjs')
hang.write_text(textwrap.dedent('''\
import { test } from 'node:test';
test('deliberate hang names this test', async () => {
  await new Promise((resolve) => setTimeout(resolve, 1500));
});
'''), encoding='utf-8')
print('command timeout:')
rc_timeout = show(['node', '--test', '--experimental-test-module-mocks', '--test-reporter=spec', 'test/cdp-command-timeout.test.mjs'])
print('per-test timeout:')
started = time.monotonic()
rc_hang = show(['node', '--test', '--test-reporter=spec', '--test-timeout=200', str(hang)])
outlived = time.monotonic() - started > 1
print('жывыя дэскрыптары трымалі працэс пасля мяжы:', 'так' if outlived else 'не')
assert rc_timeout == 0, rc_timeout
assert rc_hang != 0, rc_hang
assert outlived
```

```output
node v24.13.0
спыненне працэсу з жывымі дэскрыптарамі: timeout-minutes: 10
command timeout:
✔ CDP command: a command that never replies fails within its timeout and kills the child
✔ CDP command: send() without a timeout uses the 15000ms default and kills the child
✔ CDP command: close rejects an in-flight command that never replies
ℹ tests 3
ℹ suites 0
ℹ pass 3
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
per-test timeout:
✖ deliberate hang names this test
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 0
ℹ cancelled 1
ℹ skipped 0
ℹ todo 0

✖ failing tests:

test at ../tmp/kudy-deliberate-hang.test.mjs:2:1
✖ deliberate hang names this test
  'test timed out after 200ms'
жывыя дэскрыптары трымалі працэс пасля мяжы: так
```
