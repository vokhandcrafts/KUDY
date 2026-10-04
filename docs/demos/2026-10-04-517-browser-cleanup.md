# PR #517 — абмежаванае закрыццё браузерных тэстаў

*2026-10-04T17:30:28Z by Showboat 0.6.1*
<!-- showboat-id: 5f684f76-47fd-4e17-a736-a7ec04390b1f -->

Паўторныя Linux-запускі Node 22 спыняліся да Jest; першым незафіксаваным вынікам быў браузерны сцэнар карты. Асобная рэгрэсія вытворчага CDP-драйвера ўзнавіла незавершанае чаканне Browser.close пры закрытай сувязі і пры неадказваючым браузеры. Драйвер цяпер заканчвае пры закрыцці сувязі або пасля 2 секунд і вызваляе працэс з часовым профілем. Заменнікі стаяць толькі на мяжы працэсу Chromium і WebSocket; тэсты выклікаюць сапраўдныя launchBrowser і close, правяраюць вызваленне і падаюць без праўкі.

```python
import os, re, subprocess, sys
sys.stdout.reconfigure(encoding='utf-8', newline='\n')
result = subprocess.run(['node','--test','--experimental-test-module-mocks','--test-reporter=spec','test/cdp-browser-close.test.mjs'], capture_output=True, text=True, encoding='utf-8', env=os.environ | {'NODE_NO_WARNINGS':'1'})
for line in result.stdout.splitlines():
    if 'duration_ms' not in line:
        print(re.sub(r' \([\d.]+ms\)$','',line))
if result.stderr:
    print(result.stderr.strip())
assert result.returncode == 0, result.returncode

```

```output
✔ CDP cleanup: a socket closing before the Browser.close reply still kills the child and removes its profile
✔ CDP cleanup: an unresponsive close is bounded and still releases the child and profile
ℹ tests 2
ℹ suites 0
ℹ pass 2
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```
