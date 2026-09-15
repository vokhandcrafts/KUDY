# AR-6: npm test runs the .b adversarial suites, live self-skips

*2026-09-15T20:01:31Z by Showboat 0.6.1*
<!-- showboat-id: 1c48b9e2-c8fe-48e2-8dc4-8c3560731a2d -->

Fix for AR-6 (#83): npm test in spikes/G00.03-sandbox-grant ran only test/*.test.mjs (the 20 .a tests) while the G00.03.b negative/mutation suites in tests/ ran only via a separately documented command — a green npm test hid half the coverage. The script now runs both directories; the live file self-skips without G00_03_B_LIVE_URL with its reason visible.

```bash
cd spikes/G00.03-sandbox-grant && env -u G00_03_B_LIVE_URL npm test 2>&1 | tail -n 6
```

```output
ℹ pass 38
ℹ fail 0
ℹ cancelled 0
ℹ skipped 6
ℹ todo 0
ℹ duration_ms 1866.6926
```

```bash
cd spikes/G00.03-sandbox-grant && env -u G00_03_B_LIVE_URL npm test 2>&1 | grep -c '﹣ live:'
```

```output
6
```
