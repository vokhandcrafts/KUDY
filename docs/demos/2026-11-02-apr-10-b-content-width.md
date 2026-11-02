# APR-10.b — кап шырыні кантэнту на планшэтных акнах (issue #959)

Дата: 2026-11-02. Клон: `zcode-959`, галіна `zcode/959`, база main `f348e593`.

Крытэр доказу з issue: «Revert-праверка: зняццё шырынёвага капа робіць камітны
render-тэст чырвоным (implementation-rules 1)».

## Блок 1 — render-guard чатырох паверхняў (правіла 1: зняццё капа чырваніць)

```bash
npx jest --config jest.config.js app/content-width.test.tsx 2>&1 | grep -E "^Tests:"
```

```output
Tests:       6 passed, 6 total
```

Рэвэрт-экспэрымэнт 2026-11-02 у сэсіі змены: выдаленне `...contentWidthStyle`
з `listContent` у `components/guide-card.tsx` (трымтачны рэдакт той самай
сэсіі) даваў `1 failed, 7 skipped, 8 total` на тэсце «the explore menu body
caps at 1280 dp»; аднаўленне — зялёна.

## Блок 2 — канан-гейт токена content.max-width

```bash
node --test test/design-tokens.test.mjs 2>&1 | grep -E "ℹ (tests|pass|fail)"
```

```output
ℹ tests 18
ℹ pass 18
ℹ fail 0
```

Выдаленне токена з канона (`docs/design/visual-language.md`) ці люстры
`contentMaxWidth` з `components/design-tokens.tsx` чырваніць адпаведныя
праверкі гэтага суйту (анкер-каментар — правіла 1).

Вымярэнне па зафіксаваных здымках (AC2) — гл. справаздачу
`docs/agent-tasks/results/APR-10.b.md`: здымкі матрыцы 4 паверхні ×
{800dp, 1280dp} × {шрыфт 1.0, 2.0} ляжаць у
`docs/testing/evidence/2026-11-02-issue959/`; кантэнт ≤ 640 dp па цэнтру
ва ўсіх 16 здымках (вымярэнне PIL на гаспадары; python showboat-ранера
не цягне PIL, таму гэты крок — па-за verify-блокамі).
