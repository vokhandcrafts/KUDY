# Непраслуханыя гісторыі пасля End — #746

Праверка новага спіса праз рэальную кампазіцыю Run: пачутая асноўная гісторыя,
непачутая дадатковая, закрытая гісторыя, пусты спіс і ручное адкрыццё пасля End.

```bash
npx jest --config jest.config.js app/run.test.tsx --runInBand -t G23.04-P2 --silent --json --outputFile=/tmp/kudy-746-demo.json > /tmp/kudy-746-demo.log 2>&1
python3 - <<'PYTEST'
import json
with open('/tmp/kudy-746-demo.json') as f:
    result = json.load(f)
assert result['numFailedTests'] == 0
assert result['numPassedTests'] == 4
print('G23.04-P2 UI tests: 4 passed, 0 failed')
PYTEST
```

```output
G23.04-P2 UI tests: 4 passed, 0 failed
```
