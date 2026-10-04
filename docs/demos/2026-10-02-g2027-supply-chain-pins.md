# G20.27 — імутабныя піны actions і digest-верыфікацыя спампоўвання gitleaks

*Showboat demo for issue #500 (`tools/ci/fetch-gitleaks.mjs`, `tools/ci/check-required-checks.mjs`, `.github/workflows/*.yml`), created 2026-10-02.*

Усе блокі дэтэрмінаваныя. Першы — workflow-equivalent фікстуры
пайплайна: чатыры сцэнары (сапраўдны пінаваны архіў, скажаны архіў,
адсутная сума, HTTP-адмова), fs-збой да любога спампоўвання і кантракт
канстант — на лакальным HTTP-серверы з фейкавым сканерам-лёгерам;
«нуль выкананняў» — факт пра файл-маркер, не пра тэкст.
Другі — гвард workflow-wiring: зняцце піна, прамы curl, апустошаная
канстанта або новы чацвёрты workflow з тэгавым рэфам робяць яго чырвоным
(рэверц-эксперыменты A/B/C/D2 — у results G20.27).
Трэці — сапраўдны прадукцыйны шлях: рэальны рэлізны архіў, верыфікацыя
digest-а перад распакоўкай, выхад толькі кодам.

Першы блок — усе шэсць тэстаў фікстур зялёныя:

```sh
LD_LIBRARY_PATH=$HOME/.local/lib node --test tools/ci/gitleaks-fetch.test.mjs 2>&1 | grep -E "^ℹ (tests|pass|fail|skipped)"
```

```output
ℹ tests 6
ℹ pass 6
ℹ fail 0
ℹ skipped 0
```

Другі блок — гард required-checks зелёны на пінаваным стане (унутры яго —
той самы 40-hex рэгэксп па ўсіх трох workflow-файлах, праверка выкліку
`fetch-gitleaks.mjs` і наяўнасці абедзвюх канстант):

```sh
LD_LIBRARY_PATH=$HOME/.local/lib node tools/ci/check-required-checks.mjs
```

```output
guard-required-checks: OK — required-checks runs npm ci + npm test + web build + server:typecheck + arch:check + windows portable subset
```

Трэці блок — сапраўднае спампоўванне gitleaks 8.24.3 з верыфікаваным digest-ам
(`9991e0b2…ee29c` з checksums.txt рэлізу і незалежнага лакальнага sha256sum) і
сканам рэпазіторыя; карысны вывад сканера прыглушаны, лічыцца толькі код
выхаду:

```sh
LD_LIBRARY_PATH=$HOME/.local/lib node tools/ci/fetch-gitleaks.mjs > /dev/null 2>&1; echo exit=$?
```

```output
exit=0
```
