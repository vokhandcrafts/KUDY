# UX 06: дыялогі-мадалы і пацверджанне завяршэння (issue #352)

*Showboat demo для эпіка дызайн-выпраўленняў #346, задача #352: дыялог
пераключэння гіда §4.1 быў звычайным оверлеем у дрэве (TalkBack ходзіць па
фоне, сістэмны Back пакідае дыялог), «Скасаваць» быў стылізаваны як
disabled, а «Завяршыць прагулку» рэзаў сесію без пытання. Змены: адна
агульная мадальная абалонка `ModalDialog` (`components/modal-dialog.tsx`,
праз RN Modal — прозрачны, `onRequestClose`), outline-стыль «Скасаваць»,
мадальнае пацверджанне завяршэння прагулкі на экраны Run. Кантролер §4.1 і
транзакцыя пераключэння не кранутыя. Створана 2026-09-28.*

<!-- showboat-id: issue352-modal-dialogs -->

Дэма ганяе UX 06 guard-тэсты абодвух экранаў: AC1 — дыялог §4.1 ёсць
сапраўдная мадаль (RN Modal у дрэве; сістэмны Back праз `onRequestClose`
зачыняе яго на месцы, без навігацыі і без пачатку прагулкі), AC2 —
«Скасаваць» мае ўласны актыўны outline-стыль без disabled-зацямнення,
AC3 — «Завяршыць прагулку» спачытае пацверджанне; адмова і сістэмны Back
пакідаюць сесію актыўнай і нязменнай, пацверджанне завяршае як раней.

```sh
node_modules/.bin/jest app/preview.test.tsx -t "UX 06" 2>&1 | grep -E "^(Test Suites:|Tests:)"
```

```output
Test Suites: 1 passed, 1 total
Tests:       10 skipped, 2 passed, 12 total
```

```sh
node_modules/.bin/jest app/run.test.tsx -t "UX 06" 2>&1 | grep -E "^(Test Suites:|Tests:)"
```

```output
Test Suites: 1 passed, 1 total
Tests:       14 skipped, 1 passed, 15 total
```

Праводка дыялога: адна абалонка на абодва экраны, кнопкі дыялогаў —
агульныя `ModalDialogAccept`/`ModalDialogCancel` (ніводнай другой копіі
стыляў — донары кланаў прагрэсіўна выдаленыя).

```sh
grep -n "ModalDialog" app/route/\[id\].tsx app/run/\[id\].tsx
```

```output
app/route/[id].tsx:20:  ModalDialog,
app/route/[id].tsx:21:  ModalDialogAccept,
app/route/[id].tsx:22:  ModalDialogCancel,
app/route/[id].tsx:270:        <ModalDialog onRequestClose={state.cancelConfirm} testID="confirm-dialog">
app/route/[id].tsx:274:          <ModalDialogAccept
app/route/[id].tsx:289:          <ModalDialogCancel
app/route/[id].tsx:294:        </ModalDialog>
app/run/[id].tsx:26:  ModalDialog,
app/run/[id].tsx:27:  ModalDialogAccept,
app/run/[id].tsx:28:  ModalDialogCancel,
app/run/[id].tsx:561:        <ModalDialog onRequestClose={() => setEndConfirm(false)} testID="end-confirm-dialog">
app/run/[id].tsx:563:          <ModalDialogAccept
app/run/[id].tsx:571:          <ModalDialogCancel
app/run/[id].tsx:576:        </ModalDialog>
```

Эксперымент па зняцці фіксаў (implementation-rules 1) выкананы ў гэтай
сесіі: вяртанне дыялога §4.1 на ін-тры оверлей з disabled-«Скасаваць»
зачырваніла AC1 і AC2 (2 failed), вяртанне `btn-run-end` на прамы
`run.end()` — AC3 (1 failed); пасля аднаўлення тыя ж запускі зелёныя.

Жывая AVD-праверка (TalkBack за дыялогам, скрыншот з актыўнай
«Скасаваць») у гэтай сесіі не знята: на хасце няма adb і эмулятара
(`which adb emulator` → not found), таму візуальная прыёмка не
праводзілася; ізоляцыя TalkBack — уласнасць RN Modal, што ў тэсце
доказанае прысутнасцю native Modal у дрэве, не паводзінамі на прыладзе.
Паводзіны доказаныя праграмна guard-тэстамі вышэй і поўным `npm test`.
