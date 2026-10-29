# MAP-07 — прататып tap/drag

[Задача #884](https://github.com/vokhandcrafts/KUDY/issues/884) ·
[кананічная спецыфікацыя #881](https://github.com/vokhandcrafts/KUDY/issues/881).
Ізаляваны прататып з простымі фігурамі; асноўны экран і маршруты не змененыя.

## Запуск

З кораня рэпазіторыя:

```bash
node --input-type=module -e "import {createStaticServer} from './tools/serve-static.mjs'; createStaticServer(process.cwd() + '/spikes/MAP-07-tap-drag').listen(8840, '127.0.0.1')"
```

Адкрыйце `http://127.0.0.1:8840`. Спыніце сервер праз Ctrl+C.

```bash
node --test spikes/MAP-07-tap-drag/tap-drag.test.mjs spikes/MAP-07-tap-drag/edge-cases.test.mjs spikes/MAP-07-tap-drag/weighted-motion.test.mjs spikes/MAP-07-tap-drag/pickup-feedback.test.mjs spikes/MAP-07-tap-drag/adapter-pickup.test.mjs
npx playwright install chromium
MAP07_BROWSER=1 node --test spikes/MAP-07-tap-drag/browser.test.mjs
```

`npm test` падхоплівае ўсе файлы праз існуючы glob `spikes/**/*.test.mjs`.
Браўзерная праверка без `MAP07_BROWSER=1` паказвае прычыну пропуску.

## Межы і перадача

`tap-drag.mjs` атрымлівае геаметрыю і callbacks; ён не імпартуе DOM,
React Native, маршруты ці асеты. Adapter перадае каардынаты pointer у адной
сістэме лагічных адзінак; bounds — дазволены прамавугольнік з ужо ўлічанымі
safe area і адступамі ад сістэмных краёў. Поўны bounding box фігуры застаецца
ў ім. Няправільная канфігурацыя або фігура, якая не змяшчаецца, дае RangeError
да пачатку жэста. Змена геаметрыі патрабуе адмяніць жэст і перастварыць engine.

Парог у прыкладзе — 8 CSS px, без чакання long-press для drag.
Да парога няма перамяшчэння; пасля перасячэння жэст ужо не становіцца tap,
нават калі pointer вярнуўся назад. Пры дотыку фігура ледзь прыціскаецца;
пасля 120 мс утрымання яна падымаецца (мікрарух, маштаб і цень).
Drag адразу ўключае гэты стан без таймера; утрыманне без руху не адкрывае
пункт. Адмена або адпусканне скідае візуальны стан; дублікат up не
паўтарае дзеянне. Адмена захоўвае апошнюю бачную пазіцыю і не адкрывае
пункт; наступны асобны жэст працуе. Disabled забараняе
толькі дзеянне. Новая геаметрыя, snap, групы і захаванне стану належаць
наступным задачам MAP.

Браўзерны adapter захоплівае pointer толькі на фігуры. `touch-action: none`
дзейнічае толькі на яе мэце; вольная папера і краявы адступ не блакуюць
пракрутку. Двухмернае перацягванне і скрол адным і тым жа дотыкам на фігуры
не сумяшчаюцца: для скролу ёсць вольная вобласць. Гэта межа гэтага прататыпа,
якую трэба праверыць пры інтэграцыі меню. Падзеі адмены, страты capture,
другі pointer нават па-за фігурай, Escape, страта фокусу і схаванне старонкі
завяршаюць жэст. Звычайны pointer-click не дублюе engine tap; клавіятурны
click застаецца даступным.

Пазіцыя жэста лічыцца сінхронна. Асобны `weighted-motion.mjs`
плаўна падводзіць бачную фігуру да мэты пасля адпускання.
Перамалёўка `transform` аб'ядноўваецца праз `requestAnimationFrame`,
без перабудовы DOM на кожны рух. Анімацыя падхопу выкарыстоўвае асобныя
CSS `scale`/`translate`, каб не змяняць каардынаты рухавіка.
Пры `prefers-reduced-motion` няма пераходаў і інерцыі;
статычны контур паказвае схоплены стан. Падпіскі і ResizeObserver
маюць cleanup.
Гэта не вымярэнне FPS на native-прыладзе і не гатовы React Native adapter.

Browser-тэст прызначаны для mouse/touch, падхопу, reduced-motion,
скролу, disabled і экрана 320 px. Node-тэст правярае адаптар і скід
таймераў без Chromium. Апошняя браўзерная праверка ў гэтым worktree
была заблакаваная Chromium; гэта не доказ фактычнага UI на прыладзе.
Android/iOS сістэмны back і native-прадукцыйнасць застаюцца
неправеранымі: на момант працы `adb devices` не паказваў прылад.
Паўторная native-прыёмка патрэбная ў MAP-11 пры інтэграцыі; гэта не запыт
на ручны крок для завяршэння ізаляванага MAP-07.

Семантыка браўзерных падзей зверыць са
[спецыфікацыяй Pointer Events](https://www.w3.org/TR/pointerevents3/).
[Доказ Showboat](../../docs/demos/2026-10-29-map07-tap-drag.md) і
[вынік](../../docs/agent-tasks/results/MAP-07.md).
