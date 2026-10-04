# PR #517 — актыўны стан у тэстах карткі падказкі

*2026-10-04T17:01:29Z by Showboat 0.6.1*
<!-- showboat-id: 0cd031a8-442b-43ab-be07-056c84f213c9 -->

Тры тэсты карткі падказкі падалі на чаканні адной GPS-падпіскі: заменнік React Native не задаваў актыўны стан дадатку. Падрыхтоўка гэтага набору цяпер задае active, як у тэстах «Побач». Доказ запускае абодва наборы, уключаючы сцэнар, дзе першапачатковы фон не запускае GPS; вытворчы кантролер не зменены. CLI testMatch патрэбны для лакальнага Windows-шляху пад .codex. Фізічны GPS і прылады тут не правяраюцца.

```python
import json, pathlib, subprocess, sys, tempfile
sys.stdout.reconfigure(encoding='utf-8', newline='\n')
with tempfile.TemporaryDirectory(prefix='kudy-hint-proof-') as folder:
    report = pathlib.Path(folder) / 'jest.json'
    result = subprocess.run(['node', 'node_modules/jest/bin/jest.js', '--config', 'jest.config.js', '--runInBand', '--runTestsByPath', 'app/hint-card.test.tsx', 'app/map.test.tsx', '--testMatch', '**/app/**/*.test.tsx', '--json', '--outputFile', str(report)], capture_output=True, text=True, encoding='utf-8')
    if result.returncode != 0:
        print(result.stdout)
        print(result.stderr)
    assert result.returncode == 0, result.returncode
    data = json.loads(report.read_text(encoding='utf-8'))
    assert data['numFailedTests'] == 0
    for suite in data['testResults']:
        for test in suite['assertionResults']:
            if any(name in test['fullName'] for name in ('Guide hint card (G07.05)', 'Nearby app lifecycle (G20.08)')):
                print(test['status'] + ': ' + test['fullName'])
    print('Jest: ' + str(data['numPassedTests']) + ' passed; ' + str(data['numFailedTests']) + ' failed')

```

```output
passed: Nearby app lifecycle (G20.08) nearby_background_foreground: stops its watch and resumes once without duplicates
passed: Nearby app lifecycle (G20.08) nearby_background_active_run: background and unmount preserve the walk owner
passed: Nearby app lifecycle (G20.08) nearby_disposed_callback: a removed lifecycle listener cannot restart location
passed: Nearby app lifecycle (G20.08) nearby_initial_background: a mounted screen waits for foreground before arming
passed: Guide hint card (G07.05) PROOF: the card renders only from a ready hint state — background never renders it
passed: Guide hint card (G07.05) a tap opens the guide preview the usual way — no audio, no Start
passed: Guide hint card (G07.05) the dismissal clears the card and records the dismissed event
Jest: 27 passed; 0 failed
```
