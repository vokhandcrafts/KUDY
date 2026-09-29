# G06.05 — дасяжнасць і чэсныя станы збояў

*Showboat demo for issue #280 (`app/`, `components/`, `controllers/`), created 2026-09-29.*

Абодва блокі ганяюць jest-сьюты гэтай змены праз нязменны канфіг
`jest.config.js`; вывад адсартаваны (`sort`), бо паралельны jest друкуе сьюты
у нясталым парадку, і адчышчаны ад таймінгаў і ANSI-кодаў — вынік
дэтэрмінаваны. Першы блок — крытэрыі задачы на ўзроўні рэндэру і кампанентаў:
банэр забароненага GPS з ручным прайграваннем, абвешчаны збой прайгравання,
нататка адноўленай прагулкі з гублёным ярусам, пераключальнік транскрыптаў
base/extended, недахоп месца з выхадам да My KUDY, рэтай каталога і гісторыі:

```sh
npx jest --config jest.config.js -t "G06.05" --verbose 2>&1 | sed -E 's/ \([0-9.]+ ?m?s\)//; s/\x1b\[[0-9;]*m//g' | grep -E "^(PASS|FAIL)|✓|✕" | grep -v skipped | LC_ALL=C sort
```

```output
    ✓ AC1: the live walk's button is a named button (Прагулка)
    ✓ AC1: the main button is a button with its label and the disabled state
    ✓ AC3/AC4: the card switches story layers, shows each transcript and plays the extended story
    ✓ AC4: a denied GPS renders the contract banner; manual play still launches the audio
    ✓ AC4: insufficient space is a named failure with the retry and the storage exit
    ✓ AC4: the failed catalog load gets its named retry — one press re-runs the refresh
    ✓ AC4: the restored walk announces itself and names the lost tier
    ✓ AC5: a failed story play is announced — the suspended banner names the manual path
    ✓ an unknown locale falls back to Belarusian, the first preference
    ✓ both locales carry the same keys
    ✓ no word is empty in either locale
    ✓ the actions are buttons announcing their labels
    ✓ the canon big-text factor caps the OS font scaling
    ✓ the dialog never animates — the reduced-motion contract stays pinned
  ✓ G06.05: the unavailable history offers the named retry and recovers
PASS app/my.test.tsx
PASS app/preview.test.tsx
PASS app/run.test.tsx
PASS components/modal-dialog.test.tsx
PASS components/scaled-text.test.tsx
PASS components/ui-strings.test.tsx
```

Другі блок — кнопка ручнога прайгравання на картцы кропкі: гэта і ёсць ручны
выхад з забароненага GPS (11 §7 — «кожная прайграецца рукамі»). Тэст ідзе
па прадуктовым шляху да канца: кранае маркер, адкрывае картку, націскае
«Граць» — і каманда `play` даходзіць да фэйкавага порту плэера без адной
GPS-фіксі:

```sh
npx jest --config jest.config.js app/run.test.tsx -t "denied GPS" --verbose 2>&1 | sed -E 's/ \([0-9.]+ ?m?s\)//; s/\x1b\[[0-9;]*m//g' | grep -E "✓|✕|Tests:" | LC_ALL=C sort
```

```output
    ○ skipped G06.03 AC1: Back and the card's ✕ dismiss the panel identically
    ✓ AC4: a denied GPS renders the contract banner; manual play still launches the audio
Tests:       21 skipped, 1 passed, 22 total
```
