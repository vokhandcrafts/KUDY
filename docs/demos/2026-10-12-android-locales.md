# Android: праверкі моў, кнопак і аднаўлення налад

*2026-10-12T00:17:36Z by Showboat 0.6.1*
<!-- showboat-id: 79396272-22db-4334-9546-cd62eec6c588 -->

Гэты доказ запускае праверкі парсера Android, выбару мовы, межаў кнопак, ачысткі працэсаў і аднаўлення памеру шрыфту. Ён не пацвярджае жывы прагон васьмі моў на прыладзе. Праверка жывой прагулкі чакае выпраўлення #727; такое абмежаванне прынята карыстальнікам 12.10.2026.

```powershell
node --no-warnings --test --test-reporter=dot tools/e2e-android/driver.test.mjs tools/e2e-android/locales.test.mjs tools/e2e-android/wiring.test.mjs
```

```output
....................
...........
```

```powershell
node -p process.platform
```

```output
win32
```
