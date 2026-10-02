# G20.28 — поўнае выяўленне тэстаў і engine:regressions у абавязковай праверцы

*Showboat demo for issue #501 (`tools/ci/test-discovery.mjs`, `package.json` test globs, `required-checks.yml`), created 2026-10-02.*

Блокі дэтэрмінаваныя: вывад фільтруе таймінгі і часовая тэчка; клон
стаіць з каміта, у якім лічбы фіксаваныя (задакументаваныя ў
`docs/agent-tasks/results/G20.28.md`). Кожны блок задає
`LD_LIBRARY_PATH=$HOME/.local/lib` яўна: node гэтага хаста патрабуе
`libsimdjson.so.33` (implementation-rules 9). npm ci — `--offline`:
пакеты ўжо ў лакальным кэшы, сеткавыя ваганні ў доказ не ўваходзяць.

Блок 1 — крытэрый 1, зялёны бок: гвард сапраўднага выяўлення на рэальнай
рэпе — кожны закамічиваны тэставы файл належыць node або jest, дыягностык
няма:

```sh
set -o pipefail; LD_LIBRARY_PATH="$HOME/.local/lib" node --test --experimental-strip-types tools/ci/test-discovery.test.mjs 2>&1 | grep -E '^ℹ (tests|pass|fail) '; echo "exit=$?"
```

```output
ℹ tests 6
ℹ pass 6
ℹ fail 0
exit=0
```

Блок 2 — крытэрый 2, node-runner sentinel: у часовым клоне дадаецца
названы сінтэтычны тэст, які кідае; стандартная каманда яго ВЫКОНВАЕ і
падае (адзінае падзенне — сэнтынел), а не толькі знаходзіць яго тэкст:

```sh
set -o pipefail; rm -rf /tmp/kudy-g2028-demo; T=/tmp/kudy-g2028-demo; git clone -q file://"$PWD" "$T" && cd "$T" && LD_LIBRARY_PATH="$HOME/.local/lib" npm ci --offline --no-audit --no-fund >/dev/null 2>&1 && (cd web && LD_LIBRARY_PATH="$HOME/.local/lib" npm ci --offline --no-audit --no-fund >/dev/null 2>&1) && printf 'import test from "node:test";\ntest("G20.28 node-runner sentinel must execute and fail (sentinel-failure-g20-28-node)", () => { throw new Error("sentinel-failure-g20-28-node"); });\n' > test/g20-28-node-sentinel.test.mjs && LD_LIBRARY_PATH="$HOME/.local/lib" npm test 2>&1 | grep -E '^(ℹ (tests|pass|fail) |✖ G20\.28 node-runner sentinel)' | sed -E 's/ \([0-9.]+ms\)$//'; echo "exit=$?"
```

```output
✖ G20.28 node-runner sentinel must execute and fail (sentinel-failure-g20-28-node)
ℹ tests 1913
ℹ pass 1906
ℹ fail 1
✖ G20.28 node-runner sentinel must execute and fail (sentinel-failure-g20-28-node)
exit=1
```

Блок 3 — крытэрый 2, jest-runner sentinel: у тым жа часовым клоне node
сэнтынел здымается, дадаецца app-сэнтынел; node крок зялёны, jest крок
выконвае названы сэнтынел і падае адзінай сютай:

```sh
set -o pipefail; cd /tmp/kudy-g2028-demo && rm test/g20-28-node-sentinel.test.mjs && printf 'it("G20.28 jest-runner sentinel must execute and fail (sentinel-failure-g20-28-jest)", () => { throw new Error("sentinel-failure-g20-28-jest"); });\n' > app/g20-28-jest-sentinel.test.tsx && NO_COLOR=1 LD_LIBRARY_PATH="$HOME/.local/lib" npm test 2>&1 | grep -E '^(Test Suites:|Tests:|  ● G20\.28 jest-runner sentinel)'; echo "exit=$?"
```

```output
  ● G20.28 jest-runner sentinel must execute and fail (sentinel-failure-g20-28-jest)
  ● G20.28 jest-runner sentinel must execute and fail (sentinel-failure-g20-28-jest)
Test Suites: 1 failed, 24 passed, 25 total
Tests:       1 failed, 178 passed, 179 total
exit=1
```

Блок 4 — крытэрый 3, missing_engine_workflow_step: выдаленне кроку
`npm run engine:regressions` з абавязковага workflow робіць незалежны
гвард чырвоным з назвай гварда (заўвага: `engine:regressions` у клоне
зялёны — 21/21; proof у выніках задачы):

```sh
cd /tmp/kudy-g2028-demo && perl -ni -e 'print unless /run: npm run engine:regressions/' .github/workflows/required-checks.yml && LD_LIBRARY_PATH="$HOME/.local/lib" node tools/ci/check-required-checks.mjs; echo "exit=$?"; rm -rf /tmp/kudy-g2028-demo
```

```output
guard-required-checks: FAIL
- missing_engine_workflow_step: required-checks.yml does not run `npm run engine:regressions`
exit=1
```
