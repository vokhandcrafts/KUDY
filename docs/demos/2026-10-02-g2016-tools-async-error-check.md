# G20.16 — зацверджаная праверка async/памылак для tools

*Showboat demo for issue #487 (`tools/validate/tools-check.mjs`, `eslint.config.mjs`), created 2026-10-02.*

Усе блокі дэтэрмінаваныя: піны eslint 10.11.0 / typescript-eslint 8.71.0 /
@types/node 26.6.4 фіксуюць тэксты паведамленьняў, а раннер нармалізуе шляхі
да адносных, таму вывад не залежыць ад хоста. Першы блок — вытворчы прагон:
57 файлаў `tools/**/*.mjs` (без тэстаў і фікстураў) чыстыя па дзвюх правілах —
`@typescript-eslint/no-floating-promises` і `no-empty` (catch без цела):

```sh
LD_LIBRARY_PATH=$HOME/.local/lib node tools/validate/tools-check.mjs
echo "exit=$?"
```

```output
tools-check: 57 production tool files clean
exit=0
```

Другі і трэці блокі — негатыўныя фікстуры праз той самы committed-канфіг
(`--file` абмінае ignore-спіс, каб праверыць сам файл): забыты await і пусты
catch адхіляюцца з імем правілы і ненулявым выхадам; калі правіла прыбраць з
`eslint.config.mjs`, гэтыя ж файлы праходзяць — і гард-тэст чырванее
(implementation-rules 1, гл. results G20.16):

```sh
LD_LIBRARY_PATH=$HOME/.local/lib node tools/validate/tools-check.mjs --file tools/validate/fixtures/floating-promise.mjs
echo "exit=$?"
```

```output

tools/validate/fixtures/floating-promise.mjs
  8:3  error  Promises must be awaited, end with a call to .catch, end with a call to .then with a rejection handler or be explicitly marked as ignored with the `void` operator  @typescript-eslint/no-floating-promises

✖ 1 problem (1 error, 0 warnings)

exit=1
```

```sh
LD_LIBRARY_PATH=$HOME/.local/lib node tools/validate/tools-check.mjs --file tools/validate/fixtures/empty-catch.mjs
echo "exit=$?"
```

```output

tools/validate/fixtures/empty-catch.mjs
  7:19  error  Empty block statement  no-empty

✖ 1 problem (1 error, 0 warnings)

exit=1
```

Чацвёрты блок — станоўчая фікстура: тыя ж дзеі з апрацаванымі памылкамі
(`await` + catch, што паднімае арыгінальную памылку) праходзяць тыя ж правілы,
каб негатыўныя вынікі ішлі ад парушэнняў, а не ад зламанай налады:

```sh
LD_LIBRARY_PATH=$HOME/.local/lib node tools/validate/tools-check.mjs --file tools/validate/fixtures/valid-async-handling.mjs
echo "exit=$?"
```

```output
exit=0
```

Пяты блок — зводка гарда ў `npm test` (свідэр без таймінгаў): адзінаццаць
тэстаў — npm-спроўка, непустое пакрыццё, вытворчы прагон, дзве негатыўныя
фікстуры, станоўчая, покрыццё конфіга, пустая выбарка і fail-closed галінкі:

```sh
LD_LIBRARY_PATH=$HOME/.local/lib node --test tools/validate/tools-check.test.mjs 2>&1 | grep -E "^ℹ (tests|pass|fail)"
```

```output
ℹ tests 11
ℹ pass 11
ℹ fail 0
```
