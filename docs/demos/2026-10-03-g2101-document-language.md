# G21.01: `<html lang>` на экспартаваных web-старонках адпавядае URL-лакалі

*Showboat-дэма задачи #534: сем старонак /en аддавалі `lang="be"` — карань
дакумента быў зашыты ў адзінай каранёвай раскладцы. Цяпер дрэва маршрутаў
падзеленае на дзве экспартныя групы з уласнымі каранёвымі раскладкамі:
старонкі без прэфікса нясуць `lang="be"`, старонкі пад `/en` нясуць
`lang="en"` — рэндэр серверны (статычны экспарт), кліенцкай мутацыі
`documentElement` няма; URL і спасылкі не змененыя. Адзіны `404.html`
абслугоўвае невядомыя URL абедзвюх лакалей, уласнай URL-лакалі не мае і нясе дэфолтную
`be` (змест — двухмоўны, як і раней). Створана 2026-10-03.*

<!-- showboat-id: g2101-document-language -->

Паводзінная праверка `checkExportedDocumentLanguage` (юніт-тэст над
сінтэтычным дрэвам экспарту, у тым ліку тыя самыя сем старонак /en і 404):

```sh
node --test --experimental-strip-types web/lib/content/exported-language.test.ts 2>&1 | grep -E 'ℹ (tests|pass|fail)'
```

```output
ℹ tests 6
ℹ pass 6
ℹ fail 0
```

Факт на рэальным экспарце гэтай галінкі (`web/out/` — gitignored, свежы
`npm run build` у web/; галоўная en, галоўная be і агульны 404):

```sh
grep -o '<html lang="[^"]*"' web/out/en.html web/out/index.html web/out/404.html
```

```output
web/out/en.html:<html lang="en"
web/out/index.html:<html lang="be"
web/out/404.html:<html lang="be"
```

Білд-скан (`web/scripts/scan-rendered.ts`, туды ж, дзе leak-скан) — усе
пятнаццаць экспартных HTML праходзяць праверку мовы дакумента:

```sh
node --experimental-strip-types web/scripts/scan-rendered.ts
```

```output
rendered-output scan: clean
document-language scan: clean
```

Экспэрымент па зняцці фіксу (implementation-rules 1) выкананы ў гэтай сесіі:
`lang="en"` у `web/app/(en)/layout.tsx` часова вернуты да `lang="be"`,
паўторны `npm run build` зачырвонеў на выхадзе 1 з сямю
`wrong-document-language` парушэннямі, якія называюць усе сем старонак /en
(`en.html`, `en/app.html`, `en/map.html`, `en/privacy.html`,
`en/guides/demo-route-a1.html` і абедзве кропкі); пасля аднаўлення фіксу той
жа білд — зелёны (вывад блокаў вышэй). Гварды над старой структурай дрэва
(`collectRoutes` у `internal-links.test.ts`, спіс файлаў у
`stop-page.test.ts` і `privacy-page.test.ts`) абноўленыя ў тым жа змяненні —
выдаленне старонкі з групы па-ранейшаму чырванее.
