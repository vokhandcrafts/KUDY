# Android E2E retries a transient UI dump failure

*2026-10-16T09:25:20Z by Showboat 0.6.1*
<!-- showboat-id: fa1afbee-ce35-4c53-9185-728eaf80b13c -->

Праверка мадэлюе адсутнасць файла пасля першых трох спроб `adb pull`. Раннер паўтарае dump з кароткай павелічальнай паўзай і прымае файл, калі наступная спроба праходзіць.

```bash
node --test --test-name-pattern='dump retries transiently missing device files' tools/e2e-android/driver.test.mjs 2>&1 | sed -E -e 's/ \([0-9.]+ms\)//g' -e '/^ℹ duration_ms /d'
```

```output
✔ dump retries transiently missing device files before giving up
ℹ tests 1
ℹ suites 0
ℹ pass 1
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```
