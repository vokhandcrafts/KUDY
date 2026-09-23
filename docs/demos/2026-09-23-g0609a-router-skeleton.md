# G06.09.a — Expo Router navigation skeleton

*2026-09-23T20:52:00Z by Showboat 0.6.1*
<!-- showboat-id: 8aa7d7df-3e17-4485-bc79-f1cc440fe9be -->

Issue #208: the `App.tsx` entry is replaced by Expo Router — the routes of
19 §2.5 exist as placeholders that name the screen and its route params, an
unknown path renders `+not-found`, and the 11 §16.1–16.2 walk (City → Guides →
preview → Run; Back from Run returns without ending anything) is exercised by
`renderRouter` tests. The `app/ ↛ services/` layer rule is enforced by
`npm run arch:check` and fails on a deliberate violating import. The Proof:
deleting the Guides route file fails the walk-through suite at the Guides step.

```python
import subprocess
r = subprocess.run("npx jest --config jest.config.js --silent 2>&1 | grep -Ev '^Time:|estimated'", shell=True, text=True, capture_output=True)
print(r.stdout.strip())
```

```output
PASS app/navigation.test.tsx

Test Suites: 1 passed, 1 total
Tests:       9 passed, 9 total
Snapshots:   0 total
```

```python
import subprocess, pathlib
p = pathlib.Path('app/violation-check.tsx')
try:
    p.write_text('import "../services/device";\n')
    r = subprocess.run(
        ['node', 'tools/arch/arch-check.mjs', '--config', '.dependency-cruiser.cjs',
         '--baseline', 'tools/arch/baseline.json', 'core', 'services', 'contracts',
         'tools', 'web', 'app'],
        capture_output=True, text=True)
    print('violating exit:', r.returncode)
    print([l for l in (r.stdout + r.stderr).splitlines() if 'app-no-services' in l][0])
finally:
    p.unlink()
r2 = subprocess.run(
    ['node', 'tools/arch/arch-check.mjs', '--config', '.dependency-cruiser.cjs',
     '--baseline', 'tools/arch/baseline.json', 'core', 'services', 'contracts',
     'tools', 'web', 'app'],
    capture_output=True, text=True)
print('clean exit:', r2.returncode)
```

```output
violating exit: 1
- app-no-services: app/violation-check.tsx -> services/device.ts
clean exit: 0
```

```python
import subprocess, shutil, pathlib
src = pathlib.Path('app/city/[id]/guides.tsx')
bak = pathlib.Path('app/city/guides.tsx.g0609a-proof')
try:
    shutil.move(src, bak)
    r = subprocess.run("npx jest --config jest.config.js --silent 2>&1 | grep -m1 'Cannot find module'", shell=True, text=True, capture_output=True)
    print(r.stdout.strip())
finally:
    if bak.exists(): shutil.move(bak, src)
print('restored:', src.exists())
```

```output
Cannot find module './city/[id]/guides' from 'app/navigation.test.tsx'
restored: True
```
