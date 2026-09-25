# Адзіны візуальны кірунак і кампаненты (G06.07)

Канон дызайнерскіх значэнняў KUDY: колеры, шрыфты з правамі выкарыстання,
інтэрвалы, тыпы картак, кнопкі, маркеры, панэль Run, дракон і назвы станаў —
у адным дакуменце. Гэта **адзіная крыніца** візуальных значэнняў для
production-экранаў G06.01+ і для прататыпа G06.08: асобнага выгляду «на кожную
задачу» больш няма (backlog `16` §G06, радок 157).

Што замяняе: draft-палітру `:root` у
`spikes/G06.08-prototype/prototype/styles.css`. Кожны draft-токен мае яўную
замену — карта supersession у машынным блоку ў канцы дакументу; тэст
`test/design-tokens.test.mjs` падае пры любым расыходжанні канона, draft-файла
ці кантрасту.

Ухваленне заснавальніка — крок рэвью PR, які закрые issue #180 (крытэрый 6);
да мержу дакумент працоўны, пасля мержу — канон.

## 1. Статус і як чытаць гэты дакумент

- Значэнні жывуць у адным машынным JSON-блоку ў канцы дакументу («Дадатак»).
  Проза тлумачыць правілы выкарыстання і не дублюе значэнні.
- Кожны токен мае значэнне і правіла выкарыстання (`use`). Гард правярае
  запаўненне, кантрастныя пары і адпаведнасць draft-файла прататыпа.
- Крыніцы кантрактаў: `screens.md` пакета G06.08 (станы, a11y-плашка),
  `docs/design/screens-and-transitions.md` (G06.06), ADR G01.01–G01.03,
  `06` §1 (дракон), `09` §6.5 (панэль), `11` §3.2/§15, `20` §7 (шкала),
  `21` §5.4 (delivery). Гэты дакумент не пераўзначае іх — ён фіксуе
  візуальнае ўвасабленне прынятых кантрактаў.

## 2. Колеры

Адзіны акцэнт для ўсіх галоўных дзеянняў (кнопкі, націснутыя чыпы, фокус,
прагрэс). Тэкст на акцэнце і на маркерных заливках — заўсёды
`color.accent-ink`. Маркеры мапы фарбуюцца строга па стане кропкі; збоі
маюць сваю пару фон/межа (notice — папярэджанне, error — збой). Пазнакі
`paid/free/mixed/lock` адрозніваюцца фонам, тэкст пазнакі — асноўны
`color.ink`.

## 3. Шрыфты і правы на выкарыстанне

- Канонавы стэк — **system-ui, sans-serif**: інтэрфейс малюе сістэмнымі
  шрыфтамі прылады. Файлаў шрыфтоў у рэпазітары і ў бандле няма, таму
  ліцэнзійных абавязкаў на дастаўку няма; правы на сістэмныя шрыфты — у
  вытворцы АС, выкарыстанне праз API інтэрфейсу законнае.
- Калі з'явіцца брендавы шрыфт, ён трапляе ў гэты канон толькі разам з
  запісам правоў: ліцэнзія дазваляе ўбудоўванне ў прадукт (лічбавае
  выкарыстанне), файл self-host у рэпазітары, спасылка на тэкст ліцэнзіі.
  Убудоўваць шрыфт без такога запісу забаронена.
- Вагі: звычайны тэкст 400, назвы і загалоўкі 600. Базавы памер 16px,
  міжрадковая 1.45.
- **Буйны тэкст** (a11y-плашка `screens.md`: ≥ 1.2× базавага): канонавы
  множнік 1.25× → 20px. Draft-значэнне 19px (1.1875×) перазапісанае як
  ніжэй за плашку — гл. «Дадатак», `cssOverrides`.

## 4. Інтэрвалы, радыусы і памеры

Шкала інтэрвалаў 4/8/12/16px: 4 — мінімальны зазор у радах, 8 — зазоры сетак
і радоў, 12 — падшэўка картак і панэляў, 16 — падзел секцый. Радыус 10px для
картак, кнопак, дыялога і прагрэсу; 99px — пілюлі чыпаў і пазнак. Маркер
кропкі — круг 34px з белым абводам 2px і цень; кропка пазіцыі карыстальніка —
18px з белым абводам 3px; паласа прагрэсу — 6px; кнопка шкалы ацэнак — 40px;
цела панэлі Run — не вышэй за 320px без пракруткі; дыялог — да 400px шырыні;
ніжняе паветра пад фіксаванай стужкай — 70px.

## 5. Кампаненты

### Карткі — роўна тры віды

1. **Звычайная картка** (`card`): белы фон, межа `color.line`, радыус 10,
   падшэўка 12 — кантэйнер экранаў Explore, My KUDY, спісаў.
2. **Картка-падказка R07** (`hintcard`): ЦІХАЯ неаўдыё-картка іншага гіда
   (`11` §15, G07.04) — сіняваты фон; хаваецца падчас аўдыё/паўзы/камерцыйнага
   дыялогу; паказу за сесію на гіда.
3. **Картка Moment** (`momentcard`): тэйзер Moment з яўным Play (ADR
   G01.02 §3.6) — цёплае адценне.

Іншых відаў картак канон не задае; новы выгляд — гэта допіс у гэты дакумент,
не мясцовая стылізацыя.

### Кнопкі і чыпы

- Primary: фон `color.accent`, тэкст `color.accent-ink` — адно галоўнае
  дзеянне на экран (прэв'ю: `Download → Start`, 09 §6.5).
- Звычайная: фон `color.card`, межа `color.line`.
- Выключаная: opacity 0.5 + `cursor: not-allowed` — прычына недаступнасці
  заўсёды пазначаная побач (`11` §7).
- Фокус: outline 3px `color.accent` з змяшчэннем 1px — аднолькавы для ўсіх
  інтэрактыўных элементаў (кнопкі, чыпы, маркеры, кнопкі шкалы).
- Чып-фільтр: націснуты (`aria-pressed=true`) — фон `color.accent`.

### Панэль Run

Адна паверхня Run: мапа як фонавы рэжым + панэль у трох становішчах
Peek/Half/Full (09 §6.5, `11` §3.2). Peek-бар: радок now-playing (уладальнік
`guide` або `moment`), радок 2 — 13px `color.muted`, індыкатар live-паўзы.
Цела панэлі мае мяжу пракруткі 320px. Паласа прагрэсу — 6px, запаўненне
`color.accent` на трэку `color.line`.

### Маркеры мапы і кропка пазіцыі

Адзінка маркера — stop; станы і іх умовы — даслоўна ADR G01.01 §4.5:
`locked` / `playing` / `played` / `available` / `pending`. Візуал: заливка
па стане, белая літара першай літары стану, белы абвод 2px, цень. Стан чытаецца
**не толькі па колеры**: літара, `aria-label` і `title` маркера нясуць назву
стану. Тап па маркеры адкрывае прэв'ю, ніколі не гук. Кропка пазіцыі —
`color.person`, без сувязі са станамі кропак.

### Дыялог і стужкі

Дыялог — да 400px, зацміценне backdrop 35% чорнага. Notice-блок — цёплая пара
фон/межа; error-блок — чырвоная пара; крытычныя паведамленні ніколі не
mascot-only (a11y-плашка `screens.md`).

## 6. Дракон

- Дракон — **гід і твар брэнда, не лагатып** (06 §1): сцэнарны характар,
  не чат-бот.
- Станы асетаў — даслоўна з 06 §1: **спакойны / здзіўлены / кліча /
  святкуе**. Формат — спрайты або кароткія відэа; асеты жывуць у адным месцы
  і назвы станаў не перафразоўваюцца.
- Крытычныя паведамленні ніколі не перадаюцца толькі маскотам: стан збою
  чытаецца без дракона (a11y-плашка `screens.md`, `11` §7).
- Правы: гліняная фігурка, фота і лічбавы персанаж — уласнасць заснавальніка
  KUDY; выкарыстанне асетаў — толькі ў прадукце KUDY і яго матэрыялах.
  Любы новы асет дракона трапляе у канон разам з запісам права на выкарыстанне.

## 7. Назвы станаў — без новых назваў

Візуальны канон не ўводзіць ніводнай новай назвы стану; ён фарбуе прынятыя:

- Сем'і сумленных станаў: **Пусты / Offline / Denied / Error**
  (`docs/design/screens-and-transitions.md`, «Кантроль покрыцця станаў»).
- Маркеры кропкі: `locked / playing / played / available / pending`
  (ADR G01.01 §4.5).
- Стан сесіі: `active / paused / finished` (ADR G01.03 §3.1, `screens.md`
  My KUDY).
- Дастаўка водгуку: `draft → pending → sending → sent`; збой вяртае
  `pending`; `409 → conflict`; `401/422 → action_required` (21 §5.4,
  даслоўна).

Колькі-небудзь «адлюстравання» станаў (напрыклад, жоўты для `pending`) канон
не дадае: колер маркера = стан з ADR, азначэнне стану жыве ў ADR, не тут.

## 8. Шкала ацэнак 1–5

- Ацэнка 1–5 зорак без загадзя выбранага значэння (20 §7); прапусціць можна
  заўсёды і нічога не запісваецца (F01).
- Публічнага сярэдняга, чужых водгукаў і сартавання паводле іх у MVP няма
  (20, «У MVP няма публічнага рэйтынгу»); уласная форма і ўласная ацэнка
  бачныя толькі чалавеку.
- Дасяжнасць: група з пяці кнопак 40px (`role="group"`, `aria-pressed`),
  фокус па агульным правіле; прычыны — замкнёныя спісы па віду target,
  максімум 3 унікальныя (20 §7).

## 9. Чытэльнасць на вуліцы

- Кантраст тэксту — WCAG 1.4.3: 4.5:1 для звычайнага тэксту. Кантраст
  графічных аб'ектаў — WCAG 1.4.11: 3:1 (маркеры на мапе і вуліцах, кропка
  пазіцыі, фокус і акцэнт, запаўненне прагрэсу на трэку).
- Пары, якія гард лічыць па рэальных значэннях, — у машынным блоку
  (`contrastPairs`); змена значэння без перадумірання пар = падзенне тэсту.
- Буйны тэкст 1.25× (плашка a11y `screens.md`), screen-reader подпісы на
  кожнай icon-only кнопцы, reduced-motion без пераходаў і аўтапанавання.
- Тры маркеры і фон падказкі перазапісаныя супраць draft у дакуменце
  прататыпа дзеля гэтых плашак — гл. «Дадатак» (`cssOverrides` і
  `supersession` з прычынамі).

## 10. Правілы змены канона

- Новыя значэнні дадаюцца ў JSON-блок і толькі разам з правілам выкарыстання;
  кантрастныя пары для новых колераў — у тым жа допісе.
- Draft-файл пратотыпа больш не з'яўляецца крыніцай: змена візуальнага значэння
  ідзе сюды, пратотыпа і production спажываюць канон.
- Гард `test/design-tokens.test.mjs` падае пры: пустым значэнні токена,
  расыходжанні draft-файла з канонам без яўнага перазапісу, парушэнні
  кантрастнай пары, змене назваў станаў супраць крыніц, выпадзенні тэсту з
  `npm test`.

## Дадатак: машынныя значэнні токенаў

```json
{
  "tokens": {
    "color.paper":            { "value": "#faf7f2", "use": "фон экрана" },
    "color.ink":              { "value": "#22262b", "use": "асноўны тэкст" },
    "color.muted":            { "value": "#6b7280", "use": "другарадны тэкст і подпісы" },
    "color.accent":           { "value": "#1d6b4f", "use": "галоўныя дзеянні, націснутыя чыпы, фокус, запаўненне прагрэсу" },
    "color.accent-ink":       { "value": "#ffffff", "use": "тэкст і гліфы на акцэнце і на маркерных заливках" },
    "color.card":             { "value": "#ffffff", "use": "фон картак, кнопак, панэлі Run і верхняй стужкі" },
    "color.line":             { "value": "#d8d2c6", "use": "межы картак, падзяляльнікі табліц, трэк прагрэсу" },
    "color.map":              { "value": "#eef3ee", "use": "фон мапы Побач і Run" },
    "color.street":           { "value": "#dfe7df", "use": "вуліцы на мапе" },
    "color.person":           { "value": "#1f5aa8", "use": "кропка пазіцыі карыстальніка" },
    "color.warn":             { "value": "#b3331f", "use": "памылковы тэкст і акцэнты збою" },
    "color.marker.played":    { "value": "#1d6b4f", "use": "маркер played" },
    "color.marker.playing":   { "value": "#b3331f", "use": "маркер playing" },
    "color.marker.available": { "value": "#8a610e", "use": "маркер available" },
    "color.marker.pending":   { "value": "#646c77", "use": "маркер pending" },
    "color.marker.locked":    { "value": "#67707a", "use": "маркер locked" },
    "color.notice.bg":        { "value": "#fdf1d7", "use": "фон notice-блока" },
    "color.notice.border":    { "value": "#e6c98c", "use": "межа notice-блока" },
    "color.error.bg":         { "value": "#fdeaea", "use": "фон error-блока" },
    "color.error.border":     { "value": "#e0a2a2", "use": "межа error-блока" },
    "color.hint.bg":          { "value": "#f6faff", "use": "фон карткі-падказкі R07" },
    "color.hint.border":      { "value": "#bcd2f0", "use": "межа карткі-падказкі R07" },
    "color.moment.bg":        { "value": "#fff7ec", "use": "фон карткі Moment" },
    "color.moment.border":    { "value": "#ecd9b0", "use": "межа карткі Moment" },
    "color.badge.paid":       { "value": "#fdf1d7", "use": "фон пазнакі paid" },
    "color.badge.free":       { "value": "#e7f2ec", "use": "фон пазнакі free" },
    "color.badge.mixed":      { "value": "#ece7f8", "use": "фон пазнакі mixed" },
    "color.badge.lock":       { "value": "#eceff1", "use": "фон пазнакі замка" },
    "color.note":             { "value": "#fffbe8", "use": "фон дэма-стужкі прататыпа" },
    "font.family":            { "value": "system-ui, sans-serif", "use": "усё тэкставае; правы — раздзел 3" },
    "font.base-size":         { "value": "16px", "use": "базавы памер тэксту" },
    "font.line-height":       { "value": "1.45", "use": "міжрадковая адлегласць" },
    "font.weight-regular":    { "value": "400", "use": "звычайнае начарканне" },
    "font.weight-strong":     { "value": "600", "use": "назвы і загалоўкі" },
    "font.size-title":        { "value": "18px", "use": "назва экрана ў верхняй стужцы" },
    "font.size-secondary":    { "value": "13px", "use": "другі радок peek-плэера" },
    "font.size-small":        { "value": "12px", "use": "пазнакі і дэма-стужка" },
    "font.size-table":        { "value": "14px", "use": "табліцы" },
    "font.big-text-factor":   { "value": "1.25", "use": "множнік буйнога тэксту; плашка a11y screens.md патрабуе ≥ 1.2" },
    "space.xs":               { "value": "4px", "use": "мінімальны зазор" },
    "space.s":                { "value": "8px", "use": "зазоры радоў і сетак" },
    "space.m":                { "value": "12px", "use": "падшэўка картак і панэляў" },
    "space.l":                { "value": "16px", "use": "падзел секцый" },
    "space.safe-bottom":      { "value": "70px", "use": "паветра пад фіксаванай дэма-стужкай" },
    "radius.base":            { "value": "10px", "use": "карткі, кнопкі, дыялог, кантэйнер прагрэсу" },
    "radius.pill":            { "value": "99px", "use": "чыпы і пазнакі" },
    "size.marker":            { "value": "34px", "use": "дыяметр маркера кропкі" },
    "size.person":            { "value": "18px", "use": "дыяметр кропкі пазіцыі" },
    "size.progress":          { "value": "6px", "use": "вышыня паласы прагрэсу" },
    "size.scale-button":      { "value": "40px", "use": "шырыня кнопкі шкалы ацэнак" },
    "panel.body-max-height":  { "value": "320px", "use": "межа пракруткі цела панэлі Run" },
    "dialog.max-width":       { "value": "400px", "use": "максімальная шырыня дыялога" }
  },
  "cardKinds": ["base", "hint", "moment"],
  "markers": ["locked", "playing", "played", "available", "pending"],
  "stateFamilies": ["Пусты", "Offline", "Denied", "Error"],
  "deliveryStates": ["draft", "pending", "sending", "sent", "conflict", "action_required"],
  "sessionStates": ["active", "paused", "finished"],
  "ratingScale": { "min": 1, "max": 5, "default": null, "publicAverage": false },
  "dragonStates": ["спакойны", "здзіўлены", "кліча", "святкуе"],
  "bigText": {
    "baseToken": "font.base-size",
    "factorToken": "font.big-text-factor",
    "cssClass": ".big-text",
    "cssValue": "20px"
  },
  "contrastPairs": [
    { "fg": "color.ink", "bg": "color.paper", "min": 4.5 },
    { "fg": "color.ink", "bg": "color.card", "min": 4.5 },
    { "fg": "color.muted", "bg": "color.paper", "min": 4.5 },
    { "fg": "color.muted", "bg": "color.card", "min": 4.5 },
    { "fg": "color.accent-ink", "bg": "color.accent", "min": 4.5 },
    { "fg": "color.muted", "bg": "color.note", "min": 4.5 },
    { "fg": "color.ink", "bg": "color.notice.bg", "min": 4.5 },
    { "fg": "color.ink", "bg": "color.error.bg", "min": 4.5 },
    { "fg": "color.ink", "bg": "color.hint.bg", "min": 4.5 },
    { "fg": "color.ink", "bg": "color.moment.bg", "min": 4.5 },
    { "fg": "color.muted", "bg": "color.hint.bg", "min": 4.5 },
    { "fg": "color.muted", "bg": "color.moment.bg", "min": 4.5 },
    { "fg": "color.accent-ink", "bg": "color.marker.played", "min": 4.5 },
    { "fg": "color.accent-ink", "bg": "color.marker.playing", "min": 4.5 },
    { "fg": "color.accent-ink", "bg": "color.marker.available", "min": 4.5 },
    { "fg": "color.accent-ink", "bg": "color.marker.pending", "min": 4.5 },
    { "fg": "color.accent-ink", "bg": "color.marker.locked", "min": 4.5 },
    { "fg": "color.marker.playing", "bg": "color.map", "min": 3 },
    { "fg": "color.marker.played", "bg": "color.map", "min": 3 },
    { "fg": "color.marker.available", "bg": "color.map", "min": 3 },
    { "fg": "color.marker.pending", "bg": "color.map", "min": 3 },
    { "fg": "color.marker.locked", "bg": "color.map", "min": 3 },
    { "fg": "color.marker.playing", "bg": "color.street", "min": 3 },
    { "fg": "color.marker.played", "bg": "color.street", "min": 3 },
    { "fg": "color.marker.available", "bg": "color.street", "min": 3 },
    { "fg": "color.marker.pending", "bg": "color.street", "min": 3 },
    { "fg": "color.marker.locked", "bg": "color.street", "min": 3 },
    { "fg": "color.person", "bg": "color.map", "min": 3 },
    { "fg": "color.accent", "bg": "color.paper", "min": 3 },
    { "fg": "color.accent", "bg": "color.card", "min": 3 },
    { "fg": "color.accent", "bg": "color.line", "min": 3 }
  ],
  "supersession": {
    "--kudy-paper":      { "token": "color.paper" },
    "--kudy-ink":        { "token": "color.ink" },
    "--kudy-muted":      { "token": "color.muted" },
    "--kudy-accent":     { "token": "color.accent" },
    "--kudy-accent-ink": { "token": "color.accent-ink" },
    "--kudy-locked":     { "token": "color.marker.locked", "override": true, "draftValue": "#9aa2ab", "reason": "белая літара стану на маркеры (2.58:1) і заливка на вуліцы (2.05:1) ніжэй за плашкі → 5.03:1 і 3.98:1" },
    "--kudy-played":     { "token": "color.marker.played" },
    "--kudy-available":  { "token": "color.marker.available", "override": true, "draftValue": "#b07d1f", "reason": "літара на маркеры (3.62:1) і заливка на вуліцы (2.87:1) ніжэй за плашкі → 5.53:1 і 4.38:1" },
    "--kudy-pending":    { "token": "color.marker.pending", "override": true, "draftValue": "#7c8691", "reason": "літара на маркеры (3.70:1) і заливка на вуліцы (2.93:1) ніжэй за плашкі → 5.31:1 і 4.21:1" },
    "--kudy-playing":    { "token": "color.marker.playing" },
    "--kudy-warn":       { "token": "color.warn" },
    "--kudy-line":       { "token": "color.line" },
    "--kudy-card":       { "token": "color.card" },
    "--kudy-note":       { "token": "color.note" },
    "--kudy-map":        { "token": "color.map" },
    "--kudy-street":     { "token": "color.street" },
    "--kudy-person":     { "token": "color.person" },
    "--kudy-hint-bg":    { "token": "color.hint.bg" },
    "--kudy-hint-border":  { "token": "color.hint.border" },
    "--kudy-moment-bg":    { "token": "color.moment.bg" },
    "--kudy-moment-border": { "token": "color.moment.border" },
    "--kudy-notice-bg":    { "token": "color.notice.bg" },
    "--kudy-notice-border": { "token": "color.notice.border" },
    "--kudy-error-bg":     { "token": "color.error.bg" },
    "--kudy-error-border":  { "token": "color.error.border" },
    "--kudy-badge-paid":   { "token": "color.badge.paid" },
    "--kudy-badge-free":   { "token": "color.badge.free" },
    "--kudy-badge-mixed":  { "token": "color.badge.mixed" },
    "--kudy-badge-lock":   { "token": "color.badge.lock" },
    "--radius":          { "token": "radius.base" }
  },
  "cssOverrides": [
    {
      "selector": ".hintcard",
      "property": "background",
      "token": "color.hint.bg",
      "draftValue": "#f2f7ff",
      "reason": "muted-подпіс на падказцы меў 4.49:1 — ніжэй за 4.5:1; на #f6faff — 4.61:1"
    },
    {
      "selector": ".big-text",
      "property": "font-size",
      "fromTokens": ["font.base-size", "font.big-text-factor"],
      "draftValue": "19px",
      "reason": "19px = 1.1875× базавага — ніжэй за плашку a11y ≥ 1.2×; 20px = 1.25×"
    }
  ]
}
```
