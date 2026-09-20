# Follow-up PR #138 [Low] — поўная пераверка версійных спек postcss у guard-тэсце

Дэма фіксуе follow-up issue #141: `isAboveAdvisoryRange` у
`web/dependency-guards.test.ts` чытала толькі першы версійны трыпл спекі
(`version.match()` без сцяга `g`), таму спека-аб'яднанне
`^8.5.23 || 8.4.31` праходзіла гент, хоць дазваляла `8.4.31` — версію
ўнутры ўразлівага дыяпазону ўсіх чатырох postcss-адвізорый (<=8.5.22).

## Мера

Спека рэжацца па `||`, і кожная частка правяраецца па сваёй ніжняй
мяжы — бяспечная толькі тая частка, чыя найменш дазволеная версія вышэй
дыяпазону (`matchAll` з сцягам `g` на радку 33 guard-файла). Эксклюзіўная
ніжняя мяжа `>` лічыцца як яе наступнік (`>8.5.22` → правяраецца
`8.5.23`); верхнія межы (`<`, `<=`, правы бок гіфен-дыяпазону) толькі
вузяць мноства і не прымаюцца за доказ бяспекі — частка без ніжняй мяжы
(dist-tag `latest`/`next`, шаблон `8.5.x`, голая верхняя мяжа `<8.6.0`)
рэжацца loudly з іменаванай дыягностыкай (`no version triple` /
`wildcards are not supported` / `no lower bound`; шаблон пазнаецца толькі
ў пазіцыі нумара версіі). `web/package.json` і lockfile не кранаюцца:
override застаецца `^8.5.23`, resolved — 8.5.28.

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
жа фінальных тэстах падаюць роўна два — «every version triple» (на
`^8.5.23 || 8.4.31`, `>8.5.22`, якія стары код ціха адхіляе або прымае
супраць чакання) і «cannot fully enumerate» (на `latest`,
`^8.5.23 || latest`, `^8.5.23 || next`, `8.5.x || ^8.5.23`, `<8.6.0`,
`^8.5.23 || <8.6.0`); `# pass 2 / # fail 2`. Аднаўленне меры — зноў
`# pass 4 / # fail 0`.
