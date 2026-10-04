# Ацэнка крыніцы: пераклады інтэрфейсу Android (AOSP)

Задача: [G21.28 (#560)](https://github.com/vokhandcrafts/KUDY/issues/560), эпік [G21 (#532)](https://github.com/vokhandcrafts/KUDY/issues/532).
Дата доступу: 2026-10-03/04 UTC. Выканаўца: zcode session (GLM-5.3-Flash).
Спец: `docs/specifications/technical-completion/2026-10-03-single-source-translations.md`.
Машынны маніфест доказаў: `docs/reports/localization-sources/android.evidence.json`.

## 1. Вынік-рэзюмэ

| Пытанне | Адказ |
|---|---|
| Ці афіцыйная крыніца | Так: AOSP-рэпы `platform/frameworks/base`, `platform/packages/apps/Settings`, `platform/packages/providers/DownloadProvider`, `platform/packages/apps/TV` |
| Пакрыццё васьмі моваў (be, en, uk, de, es, fr, cs, sv) | Core: усе 8; Settings: усе 8; DownloadProvider: усе 8; TV: be адсутнічае |
| Поўнасць ядра | 2293 з 2314 унікальных ключоў ва ўсіх 7 перакладах; 22 адсутныя — тэхнічныя (typeface-імёны, bugreport, SPN-фарматэры); 1 лішні састарэлы ключ (`rating_label`) ва ўсіх перакладах, у ангельскай яго ўжо няма |
| Ліцэнзія | Apache-2.0 (NOTICE у рэпе; `MODULE_LICENSE_APACHE2`) |
| Падыходзіць для chrome-тэрмінаў (Back, Cancel, Settings, OK) | Так — поўнае пакрыццё, жывы кантэкст экранаў |
| Падыходзіць для дамейнавых тэрмінаў (guide, walk, purchase, download-кнопка) | Не: guide — іншы сэнс (тэлегід EPG), walk і purchase адсутнічаюць, download — толькі статус-фразы, не дзеяслоў-кнопка |
| Рэкамендацыя | Ужываць як **даведачную** крыніцу chrome-тэрмінаў пры праверцы сэнсу; як крыніцу дамейнавай лексікі KUDY — не ўжываць. Праекты follow-up — раздзел 8 |

Гэта рэзюмэ — назіранні, не рашэнні. Рашэнне фіксуе G21.33 (#565).

## 2. Што гэта за крыніца

AOSP — адкрытыя зыходнікі Android. Радкі інтэрфейсу захоўваюцца як Android-рэсурсы
(`values-<мова>/strings.xml`) побач з ангельскім дэфолтам (`values/strings.xml`) у тых жа
рэпах. Зыходнікі публічныя ў Gerrit/Gitiles на `android.googlesource.com`.

Даследаваныя рэпы (усе — афіцыйныя `platform/*`):

| Рэпа | Што ў ёй | Доля бэнчмарку |
|---|---|---|
| `platform/frameworks/base` (`core/res`) | сістэмныя радкі фреймворку (кнопкі дыялогаў, навігацыя, медыя-транспарт) | Back, Cancel, Stop, OK |
| `platform/packages/apps/Settings` | сістэмныя налады | Settings, Restore, unavailable-вузкія |
| `platform/packages/providers/DownloadProvider` | сістэмны загрузнік | download-статусы |
| `platform/packages/apps/TV` | тэлевізійны інтэрфейс | guide — сэнс «тэлегід» |

Крама Play і іншыя Google-прыкладанні ў AOSP адсутнічаюць (іх зыходнікі не публікуюцца).
Афіцыйнай цытаты пра гэта на source.android.com знайсці не ўдалося (пошук 2026-10-04,
см. раздзел 7) — гэта запісана як абмежаванне, не як правераны факт з першаснай крыніцай.

## 3. Спосаб доступу і ўзнаўляльнасць

Рабочы прыём — Gitiles-сыравыя URL з `?format=TEXT` (base64) і `?format=JSON`
(метаданныя файла з blob-id). Ніякіх акаўнтаў і ключоў не патрэбна.

```bash
# сыравы файл (base64):
curl -s "https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/core/res/res/values-be/strings.xml?format=TEXT" | base64 -d
# версійны пін (blob-id):
curl -s "https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/core/res/res/values-be/strings.xml?format=JSON"
# рэліз-тэгі:
git ls-remote https://android.googlesource.com/platform/frameworks/base "refs/tags/android-1[567].0.0_r*"
```

Версійны стан на 2026-10-03/04 UTC:

- Файлы ўзятыя з `refs/heads/main` (development-лінія). Наяўнасць рэліз-тэгаў
  праверана: `android-17.0.0_r1` (найноўшы тэг Android 17), `android-16.0.0_r4`
  (найноўшы тэг 16-й лініі).
- Кожны скарыстаны файл запінаваны blob-id (8 core-файлаў + 8 Settings-файлаў +
  8 DownloadProvider-файлаў + 1 TV-файл = 25; поўны спіс у манефесце). Blob-id адназначна
  пінуе байты файла незалежна ад руху main.

Абмежаванне ўзнаўляльнасці: старонкі гісторыі файлаў (+log) у Gitiles на гэтую дату
аддаюць `403: Forbidden — Please sign in to view the history pages` — дату апошняй
змены файла ананімна не атрымаць. Таму «версія» тут = blob-id, не дата каміта.

## 4. Пакрыццё васьмі моваў

Core `frameworks/base/core/res` (унікальныя ключы, знятыя з XML; лікі — з рэальнага
прагону; лікі апісваюць стан пінаваных blob-id на дату доступу, жывы main AOSP
працягвае рухацца):

| Мова | Тэчка | Унікальных ключоў | Адсутнічае ад en | Лішніх |
|---|---|---|---|---|
| en (дэфолт) | `values` | 2314 | — | — |
| be | `values-be` | 2293 | 22 | 1 |
| uk | `values-uk` | 2293 | 22 | 1 |
| de | `values-de` | 2293 | 22 | 1 |
| es | `values-es` | 2293 | 22 | 1 |
| fr | `values-fr` | 2293 | 22 | 1 |
| cs | `values-cs` | 2293 | 22 | 1 |
| sv | `values-sv` | 2293 | 22 | 1 |

- 22 адсутныя ключы аднолькавы для ўсіх моваў і тэхнічныя: імёны шрыфтоў
(`sans_serif`, `radial_numbers_typeface`…), `bugreport_status`, SPN/WFC-фарматэры,
`notification_inbox_ellipsis` і пад. Ніводнага chrome-тэрміну сярод іх няма.
- Лішні ўсім перакладам `rating_label` у ангельскім дэфолце ўжо зняты — жывы прыклад
састарэлай сінхранізацыі ў самім AOSP. Дадаткова: у значэнні гэтага ключа ў be —
шаблон множнага ліку (`{rating,plural, =1{Адна зорка з {max}}one{…}few{…}many{…}other{…}}`),
катэгорыі one/few/many/other — дакладны вузак для G21.30 (CLDR).
- `packages/apps/Settings` і `providers/DownloadProvider`: values-тэчкі ўсіх васьмі
моваў прысутнічаюць (праўерана listing-ам, каманды ў манефесце).
- `packages/apps/TV`: values-be **адсутнічае** (151 values-* тэчка станам на дату
  доступу; набор моў старэйшы, чым у core) —
пакрыццё мовы адрозніваецца ад рэпы да рэпы, агульнай гарантый «Android перакладзены
на be» няма; ёсць толькі па-рэпавая праверка.

## 5. Бэнчмарк

Агульны бэнчмарк задачы: Back, Cancel, Settings, guide, stop, walk, download,
purchase, restore, unavailable — з кантэкстам KUDY (гід/экскурсія, аўдыё-спыненне,
загрузка гіда, купля, аднаўленне куплі, недаступнасць кантэнту).

Значэнні цытаваныя даслоўна з запінаваных файлаў; вонкавыя двайныя дужкі
Android-сынтаксісу рэсурсаў знятыя. «—» = ключа ў рэпе няма.

### 5.1 Табліца значэнняў

| Тэрмін (сэнс KUDY) | Крыніца-рэпа і ключ | en | be | uk | de | es | fr | cs | sv |
|---|---|---|---|---|---|---|---|---|---|
| Back (вяртанне) | core: `back_button_label` | Back | Назад | Назад | Zurück | Atrás | Retour | Zpět | Tillbaka |
| Back (accessibility) | core: `action_bar_up_description` | Navigate up | Перайсці ўверх | Перейти вгору | Nach oben navigieren | Desplazarse hacia arriba | Parcourir vers le haut | Přejít nahoru | Navigera uppåt |
| Cancel (скасаванне) | core: `cancel` | Cancel | Скасаваць | Скасувати | Abbrechen | Cancelar | Annuler | Zrušit | Avbryt |
| Settings | Settings: `settings_label` | Settings | Налады | Налаштування | Einstellungen | Ajustes | Paramètres | Nastavení | Inställningar |
| Stop (медыя) | core: `lockscreen_transport_stop_description` | Stop | Спыніць | Зупинити | Beenden | Detener | Arrêter | Zastavit | Avbryt |
| OK | core: `ok` | OK | ОК | OK | OK | Aceptar | OK | OK | OK |
| Restore (бэкап) | Settings: `restore` | Restore | Аднавіць | Відновити | Wiederherstellen | Restaurar | Restaurer | Obnovit | Återställ |
| Download (статус) | DownloadProvider: `notification_download_complete` | Download complete. | Спампаванне завершана | Завантаження закінчено. | Download abgeschlossen | Descarga completada | Téléchargement terminé. | Stahování dokončeno. | Nedladdningen har slutförts. |
| Unavailable (вузкі сэнс) | Settings: `settings_license_activity_unavailable` | There is a problem loading the licenses. | Немагчыма загрузіць ліцэнзіі. | Під час завантаж. ліцензій виникла пробл. | Beim Laden der Lizenzen ist ein Problem aufgetreten. | Se ha producido un problema al intentar cargar las licencias. | Un problème est survenu lors du chargement des licences. | Při načítání licencí došlo k chybě. | Ett problem inträffade när licenserna lästes in. |
| guide (тэлегід, не гід) | TV: `channels_item_program_guide` | Program guide | — (values-be у TV няма) | — | — | — | — | — | — |
| walk | — | — | — | — | — | — | — | — | — |
| purchase | — | — | — | — | — | — | — | — | — |

Поўныя цытаты гэтых значэнняў і каманды здабычы — у манефесце
(`android.evidence.json`); тут яны пададзеныя даслоўна без разбивки.

### 5.2 Станоўчыя прыклады

- Back, Cancel, Settings, OK, Stop-медыя, Restore-бэкап: поўнае афіцыйнае пакрыццё
васьмі моваў з рэальным кантэкстам экрана — гэта наймацнейшая доля крыніцы.
- uk і be тут розныя дзе там, дзе сапраўды розныя сэнсы («Спыніць» vs «Зупинити») —
пераклады вядуцца асобна, не праз рускі пасадкавы лист.

### 5.3 Адмоўныя прыклады і сэнсавыя неадпаведнасці

- **walk, purchase — адсутнічаюць цалкам.** Гэта дамейнавыя словы KUDY; у AOSP іх
няма ні ў адным даследаваным рэпе.
- **guide — іншы сэнс.** У Android «guide» — гэта тэлевізійны program guide
(`channels_item_program_guide` = «Program guide» у TV). Кантэкст KUDY «экскурсавод/
гід па горадзе» AOSP не пакрывае; ужываць TV-пераклад як паходжанне для гіда —
памылка сэнсу.
- **download — не кнопка.** Ёсць толькі статус-фразы (спампоўванае скончана, у чарзе);
дзеяслоўнай кнопкі «Спампаваць» у ядры няма.
- **stop — кантэкст медыя.** Сэнс супадае з KUDY (спыніць аўдыё), але:
  - у sv «Stop» = «Avbryt» = тое самае слова, што і Cancel («Avbryt») — у шведскай
    абодва тэрміна маюць адну форму; пры пераносе ў KUDY гэта трэба ўсведамляць;
  - у de абраны «Beenden» (завяршыць), не літаральнае «Stoppen» — рашэнне vendor-а.
- **restore — кантэкст бэкапу.** Побач у тым жа рэпе `menu_restore`
(«Reset to default») перакладзены іншым словам: be «Скінуць налады», es
«Restablecer ajustes», cs «Obnovit výchozí». Асобныя сэнсы — асобныя словы; гэта
прамы вузак да правіла G21.24/G21.27 пра розныя запісы для аднолькавых слов з
розным кантэкстам. Сэнс «restore purchases» AOSP не пакрывае наогул.
- **unavailable — толькі вузкія сэнсы** (біметрыка, служба друку, ліцэнзіі, хотспот).
Агульнай кнопкі/эткеткі «Недаступна» у ядры няма.
- **OK у be = «ОК»** кірыліцай, у uk — лацініцай «OK» — розныя традыцыі ў адной крыніцы.
- У uk-фразе пра ліцэнзіі скарочаныя словы («завантаж.», «пробл.») — vendor-стыль
uk-перакладу; яго прычына (ліміты даўжыні ці іншае) у крыніцы не дакументаваная.

## 6. Ліцэнзія і атрыбуцыя

- Ліцэнзія кода і рэсурсаў AOSP — Apache-2.0: у рэпах `NOTICE`
(«NOTICE file corresponding to the section 4 d of the Apache License, Version 2.0»)
і маркер `MODULE_LICENSE_APACHE2`; абодва скарыстаны як доказ (манефест).
- Практычна для KUDY: капіраванне асобных радкоў магчыма з захаваннем NOTICE-атрыбуцыі;
файл-строкі цалкам несумяшчальны з правілам «адзін запіс — адзін ключ» спецыфікацыі
(`docs/specifications/technical-completion/2026-10-03-single-source-translations.md`);
`contracts/ui-messages/source.json` — запланаваны G21.24 шлях, якога на main яшчэ няма.
Цягнуцца павінны тэрміны і паходжанне, не файлы.
- Атрыбуцыя пры запазычанні: «The Android Open Source Project» + спасылка на рэпу
і blob-id.

## 7. Абмежаванні і кошт падтрымання

1. Гісторыя файлаў (+log) пад паролем (403) — дату змены бачым толькі праз рэліз-тэгі
   і blob-id; аўтаматычны манітор «што змянілася» без гэтага немагчымы.
2. Пераклады вядзе vendor-канвеер Google; стыль — чужы глоссарый сістэмнага UI,
   не турыстычны дамейн.
3. Рэліз-рытм: new Android version → масавыя змены; пры сталым ужыванні патрэбна
   штогадовая рэвізія па новых тэгах.
4. Састарэлыя ключы ў саміх файлах (`rating_label`) — крыніца не ідэальна чыстая,
   нарэзку рабіць па ключах, не па файлах.
5. Пошук «purchase» у AOSP абмежаваны трыма рэпамі ядра + TV; агульнарэпавага
   пошуку па ўсім AOSP без interactive UI (code search у браўзэры) не рабілася —
   запісана як абмежаванне метаду.
6. Не каміціць скачаныя strings.xml цалкам у рэпу — дробныя цытаты ў рэпарце і
   манефест; паўныя файлы застаюцца лакальна ў /tmp.

## 8. Праекты follow-up (для G21.33 #565)

Чарнавікі — толькі з выкладзеных вышэй назіранняў. Фармулёўкі для дэдуплікацыі
праз G21.33; публікацыя — G21.33, не гэтая задача.

**F1 — AOSP як даведачная крыніца chrome-тэрмінаў пры праверцы перакладаў**
- Outcome: пры праверцы сэнсу chrome-радкоў (Back, Cancel, Settings, OK, Stop-медыя,
  Restore-бэкап) перакладчык/агент фіксуе ў запісу паходжання AOSP-значэнне мовы як
  адну з даведак (не абавязковая ідэнтычнасць — толькі спасылка і разбор розніцы).
- Scope: форма запісу паходжання (G21.27/G21.19), без інтэграцыі і MCP.
- Dependencies: G21.27 (форма запісу), G21.24 (запісы).
- Acceptance: у запісе паходжання для паказаных тэрмінаў можна спаслацца на
  `android.googlesource.com` + blob-id; праверка сэнсу раіць розніцу.
- Proof: прыклад запісу для «Back» у be з AOSP-спасылкай; адкліканне крыніцы —
  запіс застаецца без яе.
- Report: гэты файл, раздзелы 5.1–5.3.

**F2 — не ўжываць AOSP для дамейнавай лексікі KUDY**
- Outcome: адмова (documented): guide/walk/purchase/download-кнопка/агульнае
  unavailable — не пакрыта або пакрыта іншым сэнсам; альтэрнатывы — G21.29–G21.32.
- Scope: запіс рашэння ў G21.33; задачы не ствараюцца.
- Proof: гэты файл, раздзел 5.3; маніфест, benchmark-адказы.
- Report: гэты файл.

**F3 — працэдура рэвізіі AOSP-даведкі пры новым рэлізе Android** (калі прынята F1)
- Outcome: штогадовая крок у працэсе G21.19: абуленні blob-id па новым тэге
  (`android-N.0.0_r1`), разбор розніц тэрмінаў; кошт — адзін прагон каманд манефесту.
- Scope: дадатак у працэсавы дак G21.19; без кода.
- Dependencies: F1.
- Proof: паўторны прагон каманд раздзела 3 на новым тэге дае новыя blob-id.

## 9. Спасылкі

Усе спасылкі адчыненыя/скачаныя 2026-10-03/04 UTC (манефест мае каманды для кожнай):

- Core-рэсурсы: https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/core/res/res/ (listing), файлы `values/`, `values-be/`, `values-uk/`, `values-de/`, `values-es/`, `values-fr/`, `values-cs/`, `values-sv/` (`strings.xml`)
- NOTICE: https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/NOTICE
- Settings: https://android.googlesource.com/platform/packages/apps/Settings/+/refs/heads/main/res/ (listing), `values*/strings.xml`
- DownloadProvider: https://android.googlesource.com/platform/packages/providers/DownloadProvider/+/refs/heads/main/res/ (listing), `values*/strings.xml`
- TV: https://android.googlesource.com/platform/packages/apps/TV/+/refs/heads/main/res/ (listing; values-be адсутнічае), `values/strings.xml`
- Тэгі: `git ls-remote https://android.googlesource.com/platform/frameworks/base "refs/tags/android-1[567].0.0_r*"`
- AOSP-дакументацыя (агульная): https://source.android.com/ , FAQ: https://source.android.com/docs/setup/start/faqs
