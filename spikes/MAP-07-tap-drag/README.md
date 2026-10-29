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
node --test spikes/MAP-07-tap-drag/tap-drag.test.mjs spikes/MAP-07-tap-drag/edge-cases.test.mjs
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

Парог у прыкладзе — 8 CSS px, без таймера long-press. Да парога няма руху;
пасля перасячэння жэст ужо не становіцца tap, нават калі pointer вярнуўся
назад. Дублікат up не паўтарае дзеянне. Адмена захоўвае апошнюю бачную
пазіцыю, не адкрывае пункт; наступны асобны жэст працуе. Disabled забараняе
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

Пазіцыя лічыцца сінхронна, а перамалёўка `transform` аб'ядноўваецца праз
`requestAnimationFrame`; няма перабудовы DOM на кожны рух. Пры завяршэнні
фінальная пазіцыя малюецца адразу. Падпіскі і ResizeObserver маюць cleanup.
Гэта не вымярэнне FPS на native-прыладзе і не гатовы React Native adapter.

Рэальныя mouse/touch-падзеі, скрол, disabled і памер 320 px правяраюцца ў
Chromium. Android/iOS сістэмны back і native-прадукцыйнасць застаюцца
неправеранымі: на момант працы `adb devices` не паказваў прылад.
Паўторная native-прыёмка патрэбная ў MAP-11 пры інтэграцыі; гэта не запыт
на ручны крок для завяршэння ізаляванага MAP-07.

Семантыка браўзерных падзей зверыць са
[спецыфікацыяй Pointer Events](https://www.w3.org/TR/pointerevents3/).
[Доказ Showboat](../../docs/demos/2026-10-29-map07-tap-drag.md) і
[вынік](../../docs/agent-tasks/results/MAP-07.md).
