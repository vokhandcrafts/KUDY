# G21.36 — Windows-набор android-build у абавязковым CI

*Showboat demo for the `windows-regressions-skipped-in-ci` guard (`tools/ci/check-required-checks.mjs`, `.github/workflows/required-checks.yml`), created 2026-10-08.*

Першы блок — гард зялёны, пакуль крок стаіць у `windows-portable`.

```sh
node tools/ci/check-required-checks.mjs
```

```output
guard-required-checks: OK — required-checks runs npm ci + npm test + web build + server:typecheck + arch:check + windows portable subset
```

Другі блок — той самы гард на копіі, з якой прыбраны радок `node --test "tools/android-build/*.test.mjs"`.

```sh
rm -rf /tmp/kudy-g2136-ci-guard && mkdir -p /tmp/kudy-g2136-ci-guard/tools/ci && cp -a .github /tmp/kudy-g2136-ci-guard/.github && cp package.json AGENTS.md /tmp/kudy-g2136-ci-guard/ && cp tools/ci/fetch-gitleaks.mjs tools/ci/check-required-checks.mjs /tmp/kudy-g2136-ci-guard/tools/ci/ && perl -ni -e 'print unless /node --test "tools\/android-build\/\*\.test\.mjs"/' /tmp/kudy-g2136-ci-guard/.github/workflows/required-checks.yml && (cd /tmp/kudy-g2136-ci-guard && node tools/ci/check-required-checks.mjs); echo "exit=$?"
```

```output
guard-required-checks: FAIL
- required-checks.yml windows-portable job does not run `node --test "tools/android-build/*.test.mjs"` — Windows-only android-build regressions are skipped in CI
exit=1
```
