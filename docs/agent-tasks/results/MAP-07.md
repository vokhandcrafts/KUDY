# MAP-07 — рухавік tap/drag

Дата: 2026-10-29. Задача: [#884](https://github.com/vokhandcrafts/KUDY/issues/884).
Канон: [#881](https://github.com/vokhandcrafts/KUDY/issues/881).

## Вынік паводле крытэрыяў

1. Кароткі tap выклікае дзеянне адзін раз; невялікі зрух не перасоўвае
   фігуру. Drag пачынаецца пасля парога без чакання і не ператвараецца назад
   у tap. Замарожаныя тэсты AC1 правяраюць callback і пазіцыю; браўзерная
   праверка — фактычныя mouse/touch і клавіятурныя дзеянні.
2. AC2 правярае cancel, lostPointer, multi-touch і межы поўнага bounding box.
   Браўзерная праверка дадаткова правярае Escape, страту capture, другі
   дотык па-за фігурай, скрол па вольнай паверхні, пераразлік межаў пры
   шырыні 320 px і адну змену transform на пакет pointermove у адным кадры.
   Рух на фігуры забірае двухмерны жэст; скрол даступны на вольнай паперы.
   Краявыя адступы захаваныя, але native system back і FPS не правераныя.
3. AC3 пацвярджае, што disabled рухаецца і не выклікае дзеянне. Рухавік
   атрымлівае толькі геаметрыю і callbacks; круглая і прамавугольная фігуры
   выкарыстоўваюць адну рэалізацыю. Няма залежнасці ад DOM ці маршрутаў.
4. [Прататып](../../../spikes/MAP-07-tap-drag/README.md), асобныя unit-тэсты і
   [Showboat](../../demos/2026-10-29-map07-tap-drag.md) захаваныя. Production
   home, маршруты, карта, snap/merge і persisted-стан не змененыя.

## Тэсты да рэалізацыі

Незалежны аўтар замарозіў `spikes/MAP-07-tap-drag/tap-drag.test.mjs` у
`4ae22793243e59eb526598370a92d7ea91e92d9a`. Ён пацвердзіў red на адсутным
новым модулі, green на часовай рэалізацыі і адхіленне дзевяці памылковых
варыянтаў; часовы модуль выдалены перад перадачай. Замарожаны файл не
зменены. Дадатковыя праверкі рэалізатара — у асобных файлах.

Паўтаральны proof: `node spikes/MAP-07-tap-drag/proof.mjs`. Ён запускае
замарожаныя тэсты ў часовай тэчцы: арыгінал праходзіць, навігацыя disabled,
навігацыя пасля drag і выдаленне руху адхіляюцца праз AssertionError.

## Праверкі ў гэтай сесіі

- `node --test spikes/MAP-07-tap-drag/tap-drag.test.mjs spikes/MAP-07-tap-drag/edge-cases.test.mjs`:
  13 pass, 0 fail.
- `MAP07_BROWSER=1 node --test spikes/MAP-07-tap-drag/browser.test.mjs`: 1 pass, 0 fail.
- `npm test`: Node — 2760 tests, 2727 pass, 33 skipped, 0 fail;
  Jest — 35 suites, 287 tests passed. Пропускі маюць прычыны ў reporter.
  Першапачатковыя памылкі адсутных `web/node_modules` ліквідаваныя праз
  `npm ci --ignore-scripts` у `web/`; lockfile не зменены.
- `npm run typecheck`, `npm run arch:check` — паспяхова.
- `npx --yes jscpd@5.1.2 --config .jscpd.json --no-tips .` — без клонаў.
- `uvx showboat==0.6.1 verify docs/demos/2026-10-29-map07-tap-drag.md` — паспяхова.
- `adb devices`: спіс прылад пусты. Android-доказ не выкананы; Chromium
  не выдаецца за native-прыёмку.

## Decisions

- 2026-10-29 · Codex: прататып выкарыстоўвае парог 8 лагічных адзінак,
  адмена захоўвае апошнюю пазіцыю, браўзер малюе transform праз RAF.
  Гэта інжынерныя налады асобнага прыкладу, не зацверджаныя production
  параметры; іх можна змяніць пры native-інтэграцыі.
- 2026-10-29 · Codex: перад production патрэбныя React Native adapter,
  прыладавая праверка жэстаў і поўная a11y-прыёмка ў наступных MAP-задачах.
  Форма карты, snap, захаванне пазіцый і новыя пункты меню тут не вызначаюцца.
