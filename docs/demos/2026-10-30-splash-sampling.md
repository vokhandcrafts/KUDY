# Splash sampling: proof for #871

The fixed 7,000 ms splash previously called the React state setter every 32 ms, including static holds. The phase-aware scheduler now plans **130** scene samples before the 6,000 ms brand endpoint, versus **219** periodic callbacks across seven seconds (ceil(7000 / 32)). This measures scheduled JS callbacks, **not** native frame rate or GPU rendering time.

The first focused regression measures those counts from the production `nextSplashSampleMs` function. The second checks the head matrix changes during the 1,500–3,000 ms head-drop window. The third rejects any periodic `setInterval` introduced into the cold-start route.

<!-- showboat-id: splash-sampling-2026-10-30 -->

```bash
set -o pipefail; npx jest --config jest.config.js --runInBand app/animated-splash.test.tsx --testNamePattern="head descends|phase clock emits|cold start does not run any periodic" --no-color 2>&1 | grep -E "^(PASS|FAIL)|^(Tests|Test Suites):" | sed -E 's/ \([0-9.]+ (s|ms)\)$//' | LC_ALL=C sort
```

```output
PASS app/animated-splash.test.tsx
Test Suites: 1 passed, 1 total
Tests:       4 skipped, 3 passed, 7 total
```

This is a deterministic Jest proof under fake timers, not an Android FPS measurement. Device profiling is still needed to quantify frame smoothness. The output above must be re-verified with `uvx showboat==0.6.1 verify docs/demos/2026-10-30-splash-sampling.md` on the final PR head; the local MCP command runner was unavailable in the authoring session.
