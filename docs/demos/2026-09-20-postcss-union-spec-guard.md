# Follow-up PR #138 [Low] — поўная пераверка версійных спек postcss у guard-тэсце

Дэма фіксуе follow-up issue #141: `isAboveAdvisoryRange` у
`web/dependency-guards.test.ts` чытала толькі першы версійны трыпл спекі
(`version.match()` без сцяга `g`), таму спека-аб'яднанне
`^8.5.23 || 8.4.31` праходзіла гент, хоць дазваляла `8.4.31` — версію
ўнутры ўразлівага дыяпазону ўсіх чатырох postcss-адвізорый (<=8.5.22).

## Мера

Спека рэжацца па `||`, і кожная частка судзіцца па сваёй ніжняй мяжы —
бяспечная толькі тая частка, чыя найменш дазволеная версія вышэй
дыяпазону. Інтэрпрэтуецца толькі строгая граматыка поўнага супадзення
(`web/dependency-guards.test.ts:28-30`): ніжнія мяжы `>=`, `>` (як
наступнік), `~`, аліяс `~>` (як тыльда), `^`, голая версія і левы бок
гіфен-дыяпазону; верхнія мяжы `<`, `<=` (у тым ліку частковыя) і правы
бок гіфен-дыяпазону толькі вузяць мноства. Усё па-за граматыкай —
dist-tag (`latest`, `next`), шаблон (`8.5.x`), прэ-рэлізны/білд-суфікс
(`>8.5.22-beta.1`), частковая ніжняя мяжа (`>8.5`), частка без ніжняй
мяжы (`<8.6.0`) — рэжацца loudly з іменаванай дыягностыкай (`unexpected
token` / `wildcards are not supported` / `no lower bound` / `hyphen
range bounds must be bare full versions`). `web/package.json` і lockfile
не кранаюцца: override застаецца `^8.5.23`, resolved — 8.5.28.

Стан override і resolved-версіі (не змяніліся з PR #138):

```sh
node -e "const fs=require('node:fs');const spec=JSON.parse(fs.readFileSync('web/package.json','utf8')).overrides.postcss;const ver=JSON.parse(fs.readFileSync('web/node_modules/postcss/package.json','utf8')).version;const [M,m,p]=ver.split('.').map(Number);const above=M>8||(M===8&&(m>5||(m===5&&p>=23)));console.log('override-spec:',spec);console.log('resolved-postcss:',ver);console.log('above-advisory-range:',above)"
```

```output
override-spec: ^8.5.23
resolved-postcss: 8.5.28
above-advisory-range: true
```

## Guard-тэст у дэфолтным наборы

Чатыры тэсты файла: дзве існыя guard-праверкі (override у package.json,
resolved з lockfile) і дзве новыя адзіночныя на форму спекі:

```sh
node --test --experimental-strip-types --test-reporter=tap web/dependency-guards.test.ts 2>&1 | grep -E '^# (tests|pass|fail)'
```

```output
# tests 4
# pass 4
# fail 0
```

## Рэверт-эксперымент (implementation-rules 1)

Праверана перад push: з вярнутым старым целам (`match` без `g`) пры тых
жа фінальных тэстах падаюць роўна два — «every part allows» (на
`^8.5.23 || 8.4.31` і `>8.5.22`: стары код праходзіць першае і адхіляе
другое супраць чакання; а вось `~>8.5.22` і `8.4.31 - 8.6.0` стары код
дае як новы, таму яны рэгрэсію не ловяць) і «cannot fully enumerate»
(на `latest`, `^8.5.23 || latest`, `^8.5.23 || next`, `8.5.x ||
^8.5.23`, `<8.6.0`, `^8.5.23 || <8.6.0`, `>8.5.22-beta.1`,
`8.5.23 - 8.6`); `# pass 2 / # fail 2`. Аднаўленне меры — зноў
`# pass 4 / # fail 0`.
