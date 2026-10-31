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

## Працяг: адчуванне «схапіў» (2026-10-29)

- Дададзена асобная фаза падхопу: пры дотыку лёгкае прыцісканне; пасля
  120 мс утрымання — зрух на 3 px уверх, маштаб 1.035 і мяккі цень.
  Калі перацягванне пачалося раней, гэты стан уключаецца адразу, без затрымкі
  перамяшчэння. Утрыманне без руху не адкрывае раздзел; кароткі tap працуе.
- `pickup-feedback.mjs` валодае таймерам і скідам пры release/cancel.
  `adapter-pickup.test.mjs` правярае рэальнае падключэнне да demo: tap,
  доўгае ўтрыманне, drag, другі pointer і клавіятуру. Ключавыя станы
  пацверджаныя таксама `pickup-feedback.test.mjs`.
- `weighted-motion.mjs` асобна згладжвае толькі бачную пазіцыю; жэставы
  рухавік `tap-drag.mjs` і замарожаныя крытэрыі не змененыя.
  `reduced motion` адключае анімацыю, але захоўвае статычную прыкмету захопу.
- У асобным worktree: `node --test spikes/MAP-07-tap-drag/tap-drag.test.mjs
  spikes/MAP-07-tap-drag/edge-cases.test.mjs
  spikes/MAP-07-tap-drag/weighted-motion.test.mjs
  spikes/MAP-07-tap-drag/pickup-feedback.test.mjs` — 21 pass;
  `node --test spikes/MAP-07-tap-drag/adapter-pickup.test.mjs` — 1 pass.
  `npm run arch:check` — OK (656 modules, 0 violations; лічба абноўлена
  2026-10-31 свежым ранам супраць фінальнага HEAD — issue #897).
- `npm run typecheck` у sandbox гэтага worktree — не правераны:
  TS6053 на `spikes/G00.03-sandbox-grant/server/device-auth.mjs`.
  Браўзерны opt-in E2E — не пройдзены: няма Playwright headless shell;
  сістэмны Chromium у абмежаваным sandbox спыніўся з `SIGTRAP`.
  Android/WayDroid і FPS не правяраліся. Гэта не выдаецца за pass.
  Новы Showboat verify не выкананы: `uvx` недаступны ў sandbox.
  Папярэдні Showboat-доказ адносіцца да базавага drag без новай фазы падхопу.
- Production home, навігацыя, форма гістарычнай карты, snap і persistence
  не закранутыя. Паказальнікі таймера і анімацыі вызваляюцца пры адмене
  і закрыцці старонкі.
