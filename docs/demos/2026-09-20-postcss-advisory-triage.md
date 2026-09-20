# Follow-up PR #135 handover [High] — трыяж чатырох адвізорый postcss у вэб-канале

Дэма фіксуе трыяж і меру follow-up з handover PR #133 (issue #137): `npm
audit` у `web/` паказвае чатыры адвізорыі на адзін пакет `postcss`, што
цягнецца транзытыўна праз `next` (точны пін 8.4.31 ва ўсіх версіях з
дыяпазону, які пакрывае наш `^15.5.0`; resolved — 15.5.25). Уразлівы
дыяпазон — `<=8.5.22`, фікс — `8.5.23`.

## Трыяж дастасавальнасці (AC 1)

Усе чатыры адвізорыі — адзін клас прычыны: давераны ўваход CSS у
парсер/стрынгіфайер postcss. Назвы — даслоўна з вываду `npm audit`:

- «PostCSS has XSS via Unescaped `</style>` in its CSS Stringify Output»
  (GHSA-qx2v-qp2m-jg93, high);
- «PostCSS: Arbitrary file read and information disclosure via
  attacker-controlled sourceMappingURL in CSS comments»
  (GHSA-6g55-p6wh-862q, moderate);
- «PostCSS: incomplete fix of GHSA-6g55-p6wh-862q — attacker-controlled
  sourceMappingURL reads arbitrary .map files when `from` is unset»
  (GHSA-fxqj-rqcc-2cmp, moderate);
- «PostCSS: Path Traversal in Previous Source Map Auto-Loading
  (sourceMappingURL) leads to Arbitrary .map File Disclosure»
  (GHSA-r28c-9q8g-f849, high).

Факты стану на вэб-канал (праверана камандамі ніжэй і `find web -name
"*.css" -not -path "*/node_modules/*" -not -path "*/out/*" -not -path
"*/.next/*"` — пуста):

1. У вэб-канале няма ніводнага CSS-файла і ніводнага CSS-імпарту;
   postcss ініцыялізуецца механізмам зборкі next, але не апрацоўвае
   ніякага CSS-уваходу.
2. Кантэнт вэба — JSON-бандлы праз `build-content.ts` і `scan-rendered.ts`;
   CSS у іх не перавозіцца.
3. Вэб — статычны экспарт (`out/`), postcss у рантайме не запускаецца.

Вывад па адвізорыях: ніводная не дастасавальная сёння — патрабуецца
злоснасны CSS-файл у рэпазітары на момант зборкі, гэта значыць злы
каміт/PR. Практычны рызыка — нізкі. Мера ўсё роўна прынята, бо каштуе
аднаго радка і здымае знаходкі да таго, як у канале з'явіцца сапраўдны
CSS (дызайн G10.01).

## Рашэнне і мера (AC 2)

`overrides.postcss: "^8.5.23"` у `web/package.json`; lockfile
пера-вырашаны на 8.5.28 (актуальная 8.5.x на 2026-09-20); `npm ci` з
гэтага lockfile паўтарае 8.5.28. Мажорнае абнаўленне next да 16.3.5 не
праводзіцца (за межамі задачы, issue #137). Guard на абедзве састаўныя
(override у package.json + устаноўленая ў node_modules версія з гэтага
lockfile) — `web/dependency-guards.test.ts`,
падключаны існуючым glob `web/**/*.test.ts` без правак тэст-скрыпта
(implementation-rules 1, 7).

Стан override і resolved-версіі:

```sh
node -e "const fs=require('node:fs');const spec=JSON.parse(fs.readFileSync('web/package.json','utf8')).overrides.postcss;const ver=JSON.parse(fs.readFileSync('web/node_modules/postcss/package.json','utf8')).version;const [M,m,p]=ver.split('.').map(Number);const above=M>8||(M===8&&(m>5||(m===5&&p>=23)));console.log('override-spec:',spec);console.log('resolved-postcss:',ver);console.log('above-advisory-range:',above)"
```

```output
override-spec: ^8.5.23
resolved-postcss: 8.5.28
above-advisory-range: true
```

Guard-тэст у дэфолтным наборы (падае пры рэверце абодвух састаўных —
праверана рэвертам перад push: без override `npm install` вяртае
8.4.31, абодва тэсты падаюць з названай дыягностыкай):

```sh
node --test --experimental-strip-types --test-reporter=tap web/dependency-guards.test.ts 2>&1 | grep -E '^# (tests|pass|fail)'
```

```output
# tests 4
# pass 4
# fail 0
```

## npm audit да/пасля (rule 13 — датаваныя капчуры)

- Да (2026-09-20, main 3ee7ac6, lockfile з postcss 8.4.31): `cd web &&
  npm audit` — чатыры радкі адвізорый на postcss, зводка «2
  vulnerabilities (1 moderate, 1 high)».
- Пасля (2026-09-20, гэтая галіна): `cd web && npm audit` — «found 0
  vulnerabilities» (вынік таксама пацверджаны `npm ci`).

## Поўная верыфікацыя зборкі з 8.5.28

`npm run build` у web (прэбілд кантэнту + `next build` + scan-rendered)
— зялёны, «rendered-output scan: clean»; падлікі свежай прагонкі — у
PR-апісанні (rule 13).
