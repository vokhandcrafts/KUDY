# Кананічныя колеры карткі-падказкі R07

*2026-10-14T10:30:39Z by Showboat 0.6.1*
<!-- showboat-id: a3567e01-4f32-45a5-9839-1049341abf4e -->

Картка-падказка атрымлівае фон і мяжу з канона §5. Гард звярае люстра токенаў з канонам, а render-тэст правярае стыль самой карткі.

```bash
set -o pipefail; node --test test/design-tokens.test.mjs 2>&1 | rg "^✔ production surface tokens|^ℹ pass |^ℹ fail " | sed -E "s/ \([^)]*ms\)//"
```

```output
✔ production surface tokens stay verbatim with the canon (G06.01.a)
ℹ pass 18
ℹ fail 0
```

```bash
set -o pipefail; node node_modules/jest/bin/jest.js --config jest.config.js --runInBand app/hint-card.test.tsx 2>&1 | rg "^Test Suites:|^Tests:"
```

```output
Test Suites: 1 passed, 1 total
Tests:       3 passed, 3 total
```
