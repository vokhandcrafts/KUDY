# G20.33 — дэдлайн поўнай перадачы публічнага бандла

*2026-10-17T11:42:39Z by Showboat 0.6.1*
<!-- showboat-id: 68a30568-96ca-4efa-9396-ffe8f71734a1 -->

Issue #795. Тэст выкарыстоўвае вытворчы createOriginByteSource і activate з сінтэтычным fetch: цела першай адпаведзі завісае, дэдлайн абрывае сігнал, актывацыя вяртае partial; наступная спроба завяршаецца. Адкат пераносу arrayBuffer() у межы withWaitLimit робіць гэты прагон чырвоным.

```bash
set -o pipefail; node --test --experimental-strip-types --experimental-test-module-mocks --test-reporter=tap --test-timeout=1000 services/download/origin-bytes.test.ts 2>/dev/null | grep -E "^(ok|not ok|1\\.\\.)"
```

```output
ok 1 - successful bytes and non-200 status keep the response contract and redact the URL
ok 2 - delayed headers abort at the named deadline
ok 3 - stalled body aborts at the named deadline; a late body cannot succeed
ok 4 - a delayed body that finishes before the deadline returns its bytes
ok 5 - fetch rejection is named and does not expose the source URL
ok 6 - body rejection is named and does not expose the source URL
ok 7 - activate stays partial after a body timeout and completes on retry
1..7
```
