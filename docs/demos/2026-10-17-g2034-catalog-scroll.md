# G20.34 — пракрутка каталога

*2026-10-17T12:44:50Z by Showboat 0.6.1*
<!-- showboat-id: fcfaec8a-100b-414e-97f1-ca508e75fb94 -->

Рэндэр-тэст праходзіць праз сапраўдныя экраны Explore і Guides з 100 сінтэтычнымі гідамі. Ён фіксуе FlatList, парадак, ключы, моўны фільтр, адаптыўныя калонкі і апошні радок. На Android Emulator API 36 асобна правераны пракрутка і пераход у прэв’ю; здымкі і паўторныя крокі — у [evidence](../testing/evidence/2026-10-17-g2034/README.md). FPS і памяць не вымяраліся.

```bash
set -o pipefail; node_modules/.bin/jest --config jest.config.js --runInBand app/catalog-list.test.tsx 2>&1 | grep -E "^(Test Suites:|Tests:)"
```

```output
Test Suites: 1 passed, 1 total
Tests:       8 passed, 8 total
```
