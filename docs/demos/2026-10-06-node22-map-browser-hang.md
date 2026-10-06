# CDP-каманды браузернага тэсту больш не чакаюць бясконца

*2026-10-06T15:23:23Z by Showboat 0.6.1*
<!-- showboat-id: fb666e37-e049-4f34-a32e-c393bd4d111b -->

Адмененыя заданні Node 22 спыняліся на шасці гадзінах без выніку сцэнара G21.03: каманда DevTools без адказу не адхілялася, таму праверка чакання паміж адказамі не даходзіла да сваёй мяжы. Закрыццё сокета цяпер адхіляе каманду адразу, адсутны адказ — па зададзенай мяжы, а паўадкрытае злучэнне гарнэса не трымае server.close().

```python
import os, re, subprocess, sys
sys.stdout.reconfigure(encoding='utf-8', newline='\n')
env = os.environ | {'NODE_NO_WARNINGS': '1'}
version = subprocess.run(['node', '-v'], capture_output=True, text=True, encoding='utf-8')
print('node', version.stdout.strip())
result = subprocess.run(
    ['node', '--test', '--experimental-strip-types', '--experimental-test-module-mocks', '--test-reporter=spec',
     'test/cdp-browser-close.test.mjs', 'test/map-harness-server-close.test.mjs'],
    capture_output=True, text=True, encoding='utf-8', env=env)
for line in result.stdout.splitlines():
    if 'duration_ms' not in line:
        print(re.sub(r' \([\d.]+ms\)$', '', line))
if result.stderr.strip():
    print(result.stderr.strip())
assert result.returncode == 0, result.returncode

```

```output
node v22.14.0
✔ CDP cleanup: a socket closing before the Browser.close reply still kills the child and removes its profile
✔ CDP cleanup: an unresponsive close is bounded and still releases the child and profile
✔ CDP command: a reply settles the command
✔ CDP command: a null DevTools frame does not drop the real reply
✔ CDP command: a socket close rejects an in-flight command instead of leaving it pending
✔ CDP command: no reply rejects within the command timeout
✔ harness server close does not wait on a half-open connection
ℹ tests 7
ℹ suites 0
ℹ pass 7
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```
