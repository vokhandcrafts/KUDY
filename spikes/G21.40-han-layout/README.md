# spikes/G21.40-han-layout — візуальны проб кітайскіх іерогліфаў і вёрсткі

Ізаляваны проб для G21.40 (issue #621). Ён НІЧОГА не актывуе ў прадукце: ні
лакалі, ні шрыфтоў, ні кампанентаў — толькі локальная HTML-старонка з
сінтэтычнымі ўзорамі дзвюх пісьмовых кандыдатаў (zh-Hans / zh-Hant) на
дызайн-токенах KUDY.

## Што проб даказвае

1. Кітайскія гліфы рэальна адлюстроўваюцца на web і на Android (сістэмны
   Noto CJK) пры бягучым шрыфтавым стэку KUDY — бо чатыры зацверджаныя твары
   (Golos Text 400/600, Alegreya 600, Caveat 400) не маюць НІАДНОГА
   кітайскага знака, і ўвесь Han ідзе праз сістэмны фолбэк.
2. Рэгіянальныя формы гліфаў адрозніваюцца паміж членамі сям'і Noto Sans CJK
   SC і TC (секцыя S2 параўноўвае дзесяць агульных кодпойнтаў з `fixtures.js`,
   U+9AA8…U+8349 — у машынных файлах яны захаваныя як \uXXXX-эскейпы).
3. Уклучанае падмноства (S3) цалкам змяшчае набор проба і важыць ~104 КБ на
   вагу (298 знакаў; мінімальны 108-знакавы набор — ~38 КБ), ліцэнзія OFL 1.1.
4. Памылковыя станы: адсутны шрыфт (@font-face з несапраўдным URL) дазваляе
   чытэльны фолбэк; PUA U+E0FF і рэдкі U+2A6B6 даюць празрыстае «тофу» —
   гэта той рэжым, які вытворчы тэкст не павінен паказваць.
5. Машынныя вынікі (fonts.check + скан кліпінгу .ess-элементаў): пры 320px і
   пры 200% тэксце `clipped_essential` пусты; на Android у авіярэжыме
   `onLine: false` і ўсе твары акрамя наўмысна збойнага дазваляюцца.

## Як запусціць (паўторная каманда)

```bash
# 1) збіраць runtime/ (копіі твароў KUDY з node_modules + падмноствы Noto CJK)
python3 spikes/G21.40-han-layout/scripts/build-subsets.py

# 2) падняць лакальны сервер і адкрыць проб
cd spikes/G21.40-han-layout && python3 -m http.server 8789
# web: http://127.0.0.1:8789/probe.html  (viewport 320px; кнопка «text scale» = 200%)

# Android (эмулятар/прылада, офлайн-прагон):
adb reverse tcp:8789 tcp:8789
adb shell cmd connectivity airplane-mode enable
adb shell am start -a android.intent.action.VIEW \
  -d "http://127.0.0.1:8789/probe.html" com.android.chrome
```

## Гейты і эскейпы

Каміт-гейт gitguard (\p{Han}, U+3000–303F) застаецца ўключаным: у машынных
файлах гэтага спайка няма сыравых CJK-байтаў — увесь кітайскі кантэнт ляжыць
у `fixtures.js` як \uXXXX-эскейпы і дэкадуецца браўзерам у рантайме.
Польская лацінка-пашырэнне (Ł, ą, ę …) захавана літаральна: гейты яе не
флагуюць. `runtime/` — генераваныя артыфакты, gitignored у гэтым жа змяненні.

## Эвідэнцыя

- `evidence/summary.json` — звод платформенных фактаў і паказальнікі
- `evidence/app-fonts-cmap.json` — cmap-скан чатырох твароў KUDY (0 Han)
- `evidence/noto-cjk-members.json` — члены хост-калекцыі Noto CJK (поўнае пакрыццё Han)
- `evidence/noto-license.json` — OFL 1.1 з name-табліцы шрыфту
- `evidence/subset-sizes.json` — вымярэнні падмностваў
- `evidence/app-references.json` — агляд кітайскіх праграм (К1, issue #621)
- `evidence/probe-results-web-100.json` / `probe-results-web-200.json` — машынныя вынікі проба
- `evidence/screenshots/` — здымкі web (320px, 200%) і Android (авіярэжым, 200%)

## Абмежаванні

- iOS не прапасаваны (PingFang SC / RN Text на прыладзе) — not verified.
- Android-здымкі ідуць праз Chrome (Blink + сістэмны стэк); вытворчая
  паверхня — React Native Text з per-weight workaround-ам; гэта named
  remaining device check перад G21.42.
- Сістэмны Android font_scale 200% не маштабуе проб (карані :root пінуюцца
  ў px) — на web маштабаванне павінна кіравацца ўласнай механікай праграмы;
  паводзіны RN Text (allowFontScaling) правяраецца асобна.
