# G21.25 (issue #558): згенераваныя каталогі UI-паведамленняў

*Заўвага да асяроддзя: на хасце, дзе голы `node` патрабуе
`LD_LIBRARY_PATH=$HOME/.local/lib` (зрух libsimdjson 2026-09-30), блокі
запускаюцца з гэтым экспартам — інакш node падае ў кожным блоку.*

*Showboat дэма задачи #558: `tools/i18n/generate-messages.mjs` праецыруе
кананічную крыніцу `contracts/ui-messages/source.json` + правераныя
пераклады `contracts/ui-messages/translations/` у натыўныя, кантролеравыя і
вэб-каталогі (10 файлаў). Паўторная генерацыя — байт-ідэнтычная; `--check`
іменавана завяршаецца збоем на выдаленым, адрэдагаваным ці састарэлым
вывадзе; рэндэр — без eval. Створана 2026-10-04.*

<!-- showboat-id: g2125-generated-messages -->

Свежасць і байт-ідэнтычнасць: два прагоны `--check` запар на камітным дрэве
даюць той самы вывад па ўсіх 10 запланаваных файлах:

```sh
node --experimental-strip-types tools/i18n/generate-messages.mjs --check 2>/dev/null
node --experimental-strip-types tools/i18n/generate-messages.mjs --check 2>/dev/null
```

```output
generated messages: 10 files fresh
generated messages: 10 files fresh
```

Праверка састарэлага вываду (implementation-rules 1): ручная праўка
згенераванага файла — іменаваны правал, рэгенерацыя яго аднаўляе, паўторная
праверка зноў свежая:

```sh
echo "// hand edit" >> components/ui-strings.generated.ts
node --experimental-strip-types tools/i18n/generate-messages.mjs --check 2>&1 | grep -c "stale generated output: components/ui-strings.generated.ts"
node --experimental-strip-types tools/i18n/generate-messages.mjs --check >/dev/null 2>&1; echo "exit=$?"
node --experimental-strip-types tools/i18n/generate-messages.mjs 2>/dev/null | tail -1
node --experimental-strip-types tools/i18n/generate-messages.mjs --check 2>/dev/null
node --experimental-strip-types tools/i18n/generate-messages.mjs --check >/dev/null 2>&1; echo "exit=$?"
```

```output
1
exit=1
generated messages: 10 files written
generated messages: 10 files fresh
exit=0
```

Рэндэр без выканання коду: умоўны хвост `composed` (пусты спіс аўдыё хавае
сегмент), лічбавыя формы `timeCap` і именаваныя формы `detail` праз структуру
`PreviewDetail` — са згенераваных модуляў:

```sh
node --experimental-strip-types -e "Promise.all([import('./components/ui-strings.generated.ts'), import('./controllers/catalog/preview-strings.generated.ts')]).then(([{UI_STRINGS}, {PREVIEW_STRINGS_DATA}]) => { console.log(UI_STRINGS.be.textAudioLine(['be'], [])); console.log(UI_STRINGS.be.textAudioLine(['be'], ['en'])); console.log(UI_STRINGS.uk.timeCap(60)); console.log(UI_STRINGS.uk.timeCap(90)); console.log(PREVIEW_STRINGS_DATA.en.detail({ kind: 'missing-files', count: 3 })); })" 2>/dev/null
```

```output
Тэкст: be
Тэкст: be; аўдыё: en
До години
До 90 хв
missing files: 3
```

Сюты генератара, чэкера перакладаў і залатая матрыца рэндэру (вывад
згенераваных каталогаў = вывад старых ручных, 1484 радкі) на чыстым дрэве:

```sh
node --test --experimental-strip-types tools/i18n/generate-messages.test.mjs contracts/ui-messages/translations.test.mjs test/ui-messages-render-golden.test.mjs 2>&1 | grep -E 'ℹ (tests|pass|fail)'
```

```output
ℹ tests 25
ℹ pass 25
ℹ fail 0
```
