# Запуск Chromium у абавязковай браўзернай праверцы

*2026-10-15 by Showboat 0.6.1*

Браўзерная праверка запускаецца ва ўсталяваным Chromium. Ліміт чакання
DevTools складае 35 секунд пры 60-секундным ліміце тэста. Калі запуск не
ўдаецца, памылка змяшчае апошнія паведамленні Chromium для дыягностыкі ў CI.

```sh
node --test --experimental-strip-types --test-timeout=60000 web/city-map.browser.test.ts 2>&1 | grep -E '^ℹ (tests|pass|fail) '
```

```output
ℹ tests 1
ℹ pass 1
ℹ fail 0
```
