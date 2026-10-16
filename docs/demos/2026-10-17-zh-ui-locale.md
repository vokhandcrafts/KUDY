# G21.46 (issue #670): дзявяты UI-код zh — рэестр, поўны каталог, пікер

*2026-10-16T23:52:38Z by Showboat 0.6.1*
<!-- showboat-id: e0e94a06-ee6c-4428-9e8b-f633aadb7c97 -->

Showboat-дэма задачы #670. Кантракт: `zh` — поўны UI-лакаль (рэестр-запіс і
каталог разам, канон G21.09), генератар застаецца адзінай крыніцай праекцый,
а кітайскія словы не пакідаюць CJK у байтах рэпо (толькі `\uXXXX`). Крытэрыі
5–6 (бачны пікер, маршрут вэба) выконваюцца за гейтам G21.50: сёння бачныя
паверхні васьмікодавыя, дзявяты код адкрывае флаг
`EXPO_PUBLIC_OPEN_UI_LOCALES`. Створана 2026-10-17.

## Каталог: поўны, з рэвью, свежы

Гейт выпушчаных моў валідуе каталог zh цалкам, а генератар пацвярджае, што
ўсе 17 выхадаў — байт-у-байт свежыя праекцыі:

```sh
node --no-warnings tools/i18n/check-messages.mjs
node --no-warnings tools/i18n/generate-messages.mjs --check

```

```output
check-messages: shipped locales complete, reviewed and fresh
generated messages: 17 files fresh
```

Лічбы каталога і доказ CJK-free байтаў проста ў файле каталога (эскейпы
дэкодуюцца ў рэальныя гліфы ў рантайме):

```sh
node --no-warnings --input-type=module -e "
import { readFileSync } from 'node:fs';
const BS = String.fromCharCode(92);
const esc = (c) => BS + 'u' + c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0');
const raw = readFileSync('contracts/ui-messages/translations/zh.json', 'utf8');
const doc = JSON.parse(raw);
const byId = new Map(doc.records.map((r) => [r.id, r.value]));
const han = [...raw].filter((c) => /\p{Script=Han}/u.test(c)).length;
console.log('records:', doc.records.length, '| raw Han bytes:', han, '| escaped code points:', raw.split(BS + 'u').length - 1);
console.log('terminology traces:', doc.records.filter((r) => r.terminology).length);
console.log('native.chrome.back:', JSON.stringify(byId.get('native.chrome.back')).replace(/[^\x20-\x7E]/g, esc));
console.log('native.chrome.walk:', JSON.stringify(byId.get('native.chrome.walk')).replace(/[^\x20-\x7E]/g, esc));
console.log('native.chrome.catalogUnavailable:', JSON.stringify(byId.get('native.chrome.catalogUnavailable')).replace(/[^\x20-\x7E]/g, esc));
"

```

```output
records: 295 | raw Han bytes: 0 | escaped code points: 2844
terminology traces: 18
native.chrome.back: "\u4E0A\u4E00\u6B65"
native.chrome.walk: "\u6563\u6B65"
native.chrome.catalogUnavailable: "\u76EE\u5F55\u4E0D\u53EF\u7528"
```

## Кітайскія словы рэндэрацца праз прадакшн-селектары

Сюіта рэестра рэндэра (усе восем натыўных сямей у дамене zh):

```sh
node --no-warnings --experimental-strip-types --test --test-reporter=tap test/ui-messages-zh-render.test.mjs 2>/dev/null | grep -E '^# (tests|pass|fail)'

```

```output
# tests 6
# pass 6
# fail 0
```

Праверка на байтах (крытэрый 7): правіла gitguard (Han/Kana/Hangul/CJK-пунктуацыя) па ўсім дрэве — 0 файлаў, а ўсе файлы гэтай задачы (каталог, рэестр, глосарый, генераваныя праекцыі, вэб-каталог) не маюць і поўнашырыннага CJK (U+FF00–FFEF). Лік прасканаваных файлаў ідзе за дрэвам рэпо: калі дрэва вырасце, гэты блок трэба перазапісаць — `uvx showboat==0.6.1 verify` пакажа рознасць:

```sh
python3 - <<'PY'
import subprocess

files = [f.decode() for f in subprocess.run(['git', 'ls-files', '-z'], capture_output=True).stdout.split(b'\0') if f]
GUARD = [(0x3000, 0x303F), (0x3040, 0x30FF), (0x3400, 0x4DBF), (0x4E00, 0x9FFF), (0xF900, 0xFAFF), (0xAC00, 0xD7AF)]
WIDE = [(0xFF00, 0xFFEF)]

def scan(path, ranges):
    try:
        text = open(path, encoding='utf-8').read()
    except (UnicodeDecodeError, IsADirectoryError, FileNotFoundError, OSError):
        return 0
    return sum(1 for c in text if any(lo <= ord(c) <= hi for lo, hi in ranges))

def count(path):
    return scan(path, GUARD), scan(path, WIDE)

guard_bad = [p for p in files if count(p)[0]]
wide_bad = [p for p in files if count(p)[1]]
print('tracked text files scanned:', len(files))
print('gitguard rule hits (Han/Kana/Hangul/CJK punctuation):', len(guard_bad), guard_bad[:3])
print('fullwidth forms (U+FF00-FFEF, outside the hook rule):', len(wide_bad), wide_bad[:3])
task_files = [
    'contracts/ui-messages/translations/zh.json',
    'contracts/ui-locales.ts',
    'contracts/ui-messages/glossary.json',
    'components/ui-strings.generated.ts',
    'components/guide-hint-strings.generated.ts',
    'controllers/run/runMap-strings.generated.ts',
    'web/lib/i18n/zh.ts',
    'app/my-locale-zh.test.tsx',
    'test/ui-messages-zh-render.test.mjs',
]
print('task-owned zh files with any CJK or fullwidth byte:', sum(1 for p in task_files if any(count(p))))
PY

```

```output
tracked text files scanned: 2532
gitguard rule hits (Han/Kana/Hangul/CJK punctuation): 0 []
fullwidth forms (U+FF00-FFEF, outside the hook rule): 3 ['docs/reports/chinese/frontend.md', 'docs/reports/chinese/language-and-dictionaries.md', 'docs/reports/chinese/translation-voice-evidence.json']
task-owned zh files with any CJK or fullwidth byte: 0
```

## Гейт G21.50: zh поўны, але зачынены, пакуль флаг яго не назаве

Без флага пікер і вэб-маршруты бачаць восем кодаў (крытэрыі 5–6 сёння):

```sh
node --no-warnings --input-type=module -e "
const BS = String.fromCharCode(92);
const esc = (c) => BS + 'u' + c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0');
const { COMPLETE_UI_LOCALES, OPEN_UI_LOCALES, releaseOpenUiLocales, uiLocaleNativeName } = await import('./contracts/ui-locales.ts');
const { uiLocales, prefixedUiLocales } = await import('./web/lib/i18n/index.ts');
console.log('complete:', COMPLETE_UI_LOCALES.join('/'));
console.log('open (no flag):', OPEN_UI_LOCALES.join('/'), '| chips:', OPEN_UI_LOCALES.length);
console.log('web routes:', uiLocales.join('/'));
console.log('web prefixed routes:', prefixedUiLocales.join('/'));
console.log('flag zh opens:', releaseOpenUiLocales('zh').join('/'));
console.log('zh native name (escaped):', [...uiLocaleNativeName('zh')].map(esc).join(''));
"

```

```output
complete: be/en/uk/de/es/fr/cs/sv/zh
open (no flag): be/en/uk/de/es/fr/cs/sv | chips: 8
web routes: be/en/uk/de/es/fr/cs/sv
web prefixed routes: en/uk/de/es/fr/cs/sv
flag zh opens: be/en/uk/de/es/fr/cs/sv/zh
zh native name (escaped): \u7B80\u4F53\u4E2D\u6587
```

З флагам той самы рэзолвер дае дзявяты код — такім чынам пікер і вэб-маршрут
адкрываюцца адным рашэннем уладара (G21.50/#711), без зменаў гэтай задачы:

```sh
EXPO_PUBLIC_OPEN_UI_LOCALES=zh node --no-warnings --input-type=module -e "
const { OPEN_UI_LOCALES } = await import('./contracts/ui-locales.ts');
const { uiLocales } = await import('./web/lib/i18n/index.ts');
console.log('open (flag zh):', OPEN_UI_LOCALES.join('/'), '| chips:', OPEN_UI_LOCALES.length);
console.log('web routes (flag zh):', uiLocales.join('/'));
"

```

```output
open (flag zh): be/en/uk/de/es/fr/cs/sv/zh | chips: 9
web routes (flag zh): be/en/uk/de/es/fr/cs/sv/zh
```
