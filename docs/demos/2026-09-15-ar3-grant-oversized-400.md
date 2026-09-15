# AR-3: oversized grant body answers 400 invalid_request instead of a silent reset

*2026-09-15T19:36:31Z by Showboat 0.6.1*
<!-- showboat-id: ee76ab21-9b83-438c-a0ab-153591fdbb8a -->

Fix for AR-3 (#80): readJsonBody used to destroy the socket on the first over-limit chunk, so the documented 400 invalid_request from the closed error list was unreachable and a client could not tell 'rejected' from 'server dead'. The server now stops buffering at MAX_BODY_BYTES, drains (discards) the remainder within a bounded drain limit, and answers 400; a client streaming past the drain limit still gets a reset. The G00.03.b negative test was updated to assert the 400 and fails against the old code.

```bash
cd spikes/G00.03-sandbox-grant && node --test tests/negative-grant.test.mjs 2>&1 | tail -n 8
```

```output
ℹ tests 15
ℹ suites 0
ℹ pass 15
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1457.7098
```
