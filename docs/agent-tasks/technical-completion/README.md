# G21 — завяршэнне праграмы і восем моў інтэрфейсу

План паводле паўторнага тэставання main і рашэння ўладара ад 2026-10-03. Гэта нарэзка задач; рэалізацыя гэтым дакументам не запускаецца. Уладар 2026-10-03 дазволіў паставіць agent:ready адкрытым падзадачам G21. Занятыя выканаўцамі задачы захоўваюць свой статус; залежнасці Blocked-by працягваюць забараняць заўчасны пачатак.

Мовы інтэрфейсу: be, en, uk, de, es, fr, cs, sv. Паказваюцца толькі гіды з тэкстам на выбранай мове; аўдыё можа быць на іншай, выразна названай мове. Калі адпаведнага тэксту няма, каталог пусты з перакладзеным тлумачэннем. Запіс і пераклад рэальнага кантэнту не ўваходзяць у гэтыя тэхнічныя задачы.

[Спецыфікацыя](../../specifications/technical-completion/2026-10-03-completion-and-locales.md). Бацькоўская Issue: [#532](https://github.com/vokhandcrafts/KUDY/issues/532). Створаныя 34 новыя падзадачы; існыя 37 картак пералічаныя без дублікатаў.

## Новыя задачы

| ID | Вынік | Issue | Залежнасці |
|---|---|---|---|
| [G21.00](G21.00.md) | Апублікаваць план, карткі і моўнае рашэнне ў main | [#533](https://github.com/vokhandcrafts/KUDY/issues/533) | — |
| [G21.01](G21.01.md) | Правільная мова дакумента на вэб-старонках | [#534](https://github.com/vokhandcrafts/KUDY/issues/534) | #533 |
| [G21.02](G21.02.md) | Чытэльныя подпісы карты MapLibre | [#535](https://github.com/vokhandcrafts/KUDY/issues/535) | #533 |
| [G21.03](G21.03.md) | Бачнае паведамленне пры збоі карты | [#536](https://github.com/vokhandcrafts/KUDY/issues/536) | #533 |
| [G21.04](G21.04.md) | Прайгравальнае сінтэтычнае аўдыё для тэстаў | [#537](https://github.com/vokhandcrafts/KUDY/issues/537) | #533 |
| [G21.05](G21.05.md) | Аднолькавыя параўнанні шляхоў у Windows і Linux | [#538](https://github.com/vokhandcrafts/KUDY/issues/538) | #533 |
| [G21.06](G21.06.md) | Кананічныя байты фікстур і пераносы радкоў | [#539](https://github.com/vokhandcrafts/KUDY/issues/539) | #533 |
| [G21.07](G21.07.md) | Праверкі бяспекі файлаў з яўнымі магчымасцямі платформы | [#540](https://github.com/vokhandcrafts/KUDY/issues/540) | #533 |
| [G21.08](G21.08.md) | Закрываць SQLite перад уборкай часовых тэставых файлаў | [#541](https://github.com/vokhandcrafts/KUDY/issues/541) | #533 |
| [G21.09](G21.09.md) | Адзін рэестр моў і поўныя тыпаваныя наборы паведамленняў | [#542](https://github.com/vokhandcrafts/KUDY/issues/542) | #533, #556, #557 |
| [G21.19](G21.19.md) | Усе выпушчаныя мовы правяраюцца ў камміце змены арыгіналу | [#543](https://github.com/vokhandcrafts/KUDY/issues/543) | #533, #542, #556, #558, #559, #566 |
| [G21.10](G21.10.md) | Нямецкі інтэрфейс | [#544](https://github.com/vokhandcrafts/KUDY/issues/544) | #533, #542, #543 |
| [G21.11](G21.11.md) | Іспанскі інтэрфейс | [#545](https://github.com/vokhandcrafts/KUDY/issues/545) | #533, #542, #543 |
| [G21.12](G21.12.md) | Французскі інтэрфейс | [#546](https://github.com/vokhandcrafts/KUDY/issues/546) | #533, #542, #543 |
| [G21.13](G21.13.md) | Чэшскі інтэрфейс | [#547](https://github.com/vokhandcrafts/KUDY/issues/547) | #533, #542, #543 |
| [G21.14](G21.14.md) | Шведскі інтэрфейс | [#548](https://github.com/vokhandcrafts/KUDY/issues/548) | #533, #542, #543 |
| [G21.15](G21.15.md) | Даступны выбар васьмі моў з захаваннем пасля перазапуску | [#549](https://github.com/vokhandcrafts/KUDY/issues/549) | #533, #542, #544, #545, #546, #547, #548, #491 |
| [G21.16](G21.16.md) | Восем кантэнтных лакаляў без выдуманай даступнасці аўдыё | [#550](https://github.com/vokhandcrafts/KUDY/issues/550) | #533, #542 |
| [G21.17](G21.17.md) | Адбор па мове тэксту і незалежная мова кнопак | [#551](https://github.com/vokhandcrafts/KUDY/issues/551) | #533, #542, #550 |
| [G21.20](G21.20.md) | Зацвердзіць асобную ідэнтычнасць тэксту і аўдыё | [#552](https://github.com/vokhandcrafts/KUDY/issues/552) | #533, #550 |
| [G21.21](G21.21.md) | Прайграваць яўна выбранае іншамоўнае аўдыё побач з тэкстам | [#553](https://github.com/vokhandcrafts/KUDY/issues/553) | #533, #552, #550, #551, #491 |
| [G21.22](G21.22.md) | Вэб-маршруты васьмі моў незалежна ад запісу голасу | [#554](https://github.com/vokhandcrafts/KUDY/issues/554) | #533, #542, #544, #545, #546, #547, #548, #550, #534 |
| [G21.18](G21.18.md) | Прыёмка васьмі інтэрфейсаў на прыладах і вэбе | [#555](https://github.com/vokhandcrafts/KUDY/issues/555) | #533, #549, #551, #553, #554, #534, #535, #536, #537 |

| [G21.23](G21.23.md) | Апублікаваць дадатак пра адзіную крыніцу і даследаванні | [#556](https://github.com/vokhandcrafts/KUDY/issues/556) | #533 |
| [G21.24](G21.24.md) | Адзін асноўны запіс кожнага радка з кантэкстам | [#557](https://github.com/vokhandcrafts/KUDY/issues/557) | #556 |
| [G21.25](G21.25.md) | Ствараць натыўныя і вэб-пераклады з адных даных | [#558](https://github.com/vokhandcrafts/KUDY/issues/558) | #556, #557, #542 |
| [G21.26](G21.26.md) | Адхіляць прапушчаныя, састарэлыя і неправераныя пераклады | [#559](https://github.com/vokhandcrafts/KUDY/issues/559) | #556, #558 |
| [G21.27](G21.27.md) | Абавязковы пошук пры няпэўнасці і запіс крыніцы | [#566](https://github.com/vokhandcrafts/KUDY/issues/566) | #556, #565 |
| [G21.28](G21.28.md) | Справаздача пра пераклады інтэрфейсу Android | [#560](https://github.com/vokhandcrafts/KUDY/issues/560) | #556 |
| [G21.29](G21.29.md) | Справаздача пра тэрміналогію Microsoft | [#561](https://github.com/vokhandcrafts/KUDY/issues/561) | #556 |
| [G21.30](G21.30.md) | Справаздача пра CLDR і правілы моў | [#562](https://github.com/vokhandcrafts/KUDY/issues/562) | #556 |
| [G21.31](G21.31.md) | Справаздача пра Вікіслоўнік і спампаваныя базы | [#563](https://github.com/vokhandcrafts/KUDY/issues/563) | #556 |
| [G21.32](G21.32.md) | Справаздача пра IATE | [#564](https://github.com/vokhandcrafts/KUDY/issues/564) | #556 |
| [G21.33](G21.33.md) | Ператварыць пяць справаздач у рашэнні і GitHub-задачы | [#565](https://github.com/vokhandcrafts/KUDY/issues/565) | #556, #560, #561, #562, #563, #564 |

## Існыя задачы — паўторна не ствараюцца

Стан ніжэй з GitHub на момант нарэзкі. Крытэрыі і статусы выканаўцаў захаваныя. Залежнасці гэтых задач жывуць у іх арыгінальных картках; гэты індэкс іх не замяняе.

| Issue | Задача | Стан |
|---|---|---|
| [#492](https://github.com/vokhandcrafts/KUDY/issues/492) | G20.21 — Verify sandbox entitlement and signed-media access end to end | адкрытая |
| [#491](https://github.com/vokhandcrafts/KUDY/issues/491) | G20.20 — Compose real device services at the application root | адкрытая |
| [#485](https://github.com/vokhandcrafts/KUDY/issues/485) | G20.14 — Run real Expo adapter behavior in the standard test command | адкрытая |
| [#483](https://github.com/vokhandcrafts/KUDY/issues/483) | G20.12 — Verify payment-event minimization and retention after G09.03 | адкрытая |
| [#479](https://github.com/vokhandcrafts/KUDY/issues/479) | G20.08 — Prove and enforce GPS start-stop and screen ownership | занятая выканаўцам |
| [#470](https://github.com/vokhandcrafts/KUDY/issues/470) | G20 — Надзейнасць прагулкі, бяспечныя межы і праверкі архітэктуры | адкрытая |
| [#466](https://github.com/vokhandcrafts/KUDY/issues/466) | G19.09 — Private end-to-end pilot and bulk-run decision | адкрытая |
| [#465](https://github.com/vokhandcrafts/KUDY/issues/465) | G19.07 — Author review and private research export | адкрытая |
| [#464](https://github.com/vokhandcrafts/KUDY/issues/464) | G19.06 — Selected facts and relationships with exact evidence | адкрытая |
| [#463](https://github.com/vokhandcrafts/KUDY/issues/463) | G19.05 — Search and explicit research-case selection | адкрытая |
| [#462](https://github.com/vokhandcrafts/KUDY/issues/462) | G19.04 — Budgeted first-level model annotation | адкрытая |
| [#461](https://github.com/vokhandcrafts/KUDY/issues/461) | G19.08 — Private pilot inputs and approved model policy | патрабуе знешняга кроку |
| [#456](https://github.com/vokhandcrafts/KUDY/issues/456) | G19 — Бібліятэка матэрыялаў і пошук гісторый | адкрытая |
| [#436](https://github.com/vokhandcrafts/KUDY/issues/436) | Цёмная тэма (tracking, рашэнне ўладара) | адкрытая |
| [#430](https://github.com/vokhandcrafts/KUDY/issues/430) | Чытэльны disabled-стан галоўнай кнопкі прэв | занятая выканаўцам |
| [#429](https://github.com/vokhandcrafts/KUDY/issues/429) | Брэнд-іконка і splash дадатка (гейчана асетам ўладара) | адкрытая |
| [#400](https://github.com/vokhandcrafts/KUDY/issues/400) | G06.10 — стылёвы пакет «Гліна і папера» (эпік) | адкрытая |
| [#346](https://github.com/vokhandcrafts/KUDY/issues/346) | Эпік: дызайн-выпраўленні мабільнага дадатку па рэвью 2026-09-28 | адкрытая |
| [#330](https://github.com/vokhandcrafts/KUDY/issues/330) | [чалавечы крок] Акаўнты крам: Google Play Console і Apple Developer Program — рэгістрацыя, верыфікацыя і тэст-гейт | патрабуе знешняга кроку |
| [#320](https://github.com/vokhandcrafts/KUDY/issues/320) | G10.02.b — SEO, публікацыя на Vercel і правераны адкат | адкрытая |
| [#307](https://github.com/vokhandcrafts/KUDY/issues/307) | G14.04.f — uk-прыёмка: L01/L02 і сумесны прагон | адкрытая |
| [#306](https://github.com/vokhandcrafts/KUDY/issues/306) | G14.04.e — uk-аўдыё-запіс першага гіда | адкрытая |
| [#299](https://github.com/vokhandcrafts/KUDY/issues/299) | G11.04 — Рэліз у крамы і reviewer-рэжым | адкрытая |
| [#298](https://github.com/vokhandcrafts/KUDY/issues/298) | G11.03 — Runbook кантэнту, доступу і аднаўлення | адкрытая |
| [#297](https://github.com/vokhandcrafts/KUDY/issues/297) | G11.02 — Палявыя праходы і канфігурацыя | адкрытая |
| [#296](https://github.com/vokhandcrafts/KUDY/issues/296) | G11.01 — Скразная прыёмка MVP | адкрытая |
| [#288](https://github.com/vokhandcrafts/KUDY/issues/288) | G09.03 — Выдаленне і тэрмін захавання | занятая выканаўцам |
| [#154](https://github.com/vokhandcrafts/KUDY/issues/154) | G17 epic — Web collection: sources → raw library → cleaned Source for 07 | адкрытая |
| [#112](https://github.com/vokhandcrafts/KUDY/issues/112) | G10.02 — лінкі, QR, індэксацыя і публікацыя (вэб, пераход у дадатак) | адкрытая |
| [#110](https://github.com/vokhandcrafts/KUDY/issues/110) | G03.05 — першы апублікаваны гід і правераны бясплатны вэб-пласт (tracking) | адкрытая |
| [#108](https://github.com/vokhandcrafts/KUDY/issues/108) | G10 — вэб як канал бясплатнага кантэнту (вэб-аўдыёверсія) | адкрытая |
| [#75](https://github.com/vokhandcrafts/KUDY/issues/75) | G16.04 — Справаздача, захаванне і прыёмка водгукаў | адкрытая |
| [#74](https://github.com/vokhandcrafts/KUDY/issues/74) | G16.03 — Добраахвотная форма ацэнкі | адкрытая |
| [#73](https://github.com/vokhandcrafts/KUDY/issues/73) | G16.02 — Чарга і сховішча ўласных ацэнак | адкрытая |
| [#72](https://github.com/vokhandcrafts/KUDY/issues/72) | G16.01 — Прыватнае сховішча і API ацэнак | адкрытая |
| [#37](https://github.com/vokhandcrafts/KUDY/issues/37) | G16 — Непублічныя ацэнкі і справаздача аўтара | адкрытая |
| [#36](https://github.com/vokhandcrafts/KUDY/issues/36) | G15 — Аўтарскі падбор месцаў, падборак і гідаў | адкрытая |

G19 — асобныя тэхнічныя інструменты падрыхтоўкі кантэнту; яны ўжо маюць задачы і не блакуюць тэхнічны MVP. #306 — запіс украінскага аўдыё; кантэнтная праца. #436 — адкладзеная цёмная тэма. Бацькоўскія эпікі не выконваюцца як самастойныя задачы.

## Парадак

Спачатку G21.00 публікуе дакументы. Пасля гэтага выпраўленні сайта і Windows могуць ісці незалежна ад існай прагулкі. Моўны напрамак: G21.23 → G21.24 → G21.09 → G21.25 → G21.26; паралельна G21.28–G21.32 → G21.33 → G21.27. Абедзве часткі патрэбныя для G21.19 → пяць перакладаў; схемы G21.16 → фільтр G21.17; вэб G21.22. Змешаныя тэкст/аўдыё: зацверджаны дызайн G21.20 → G21.21 пасля падключэння #491. Выбар мовы G21.15 чакае сапраўднага захоўвання #491. Агульная моўная прыёмка G21.18 завяршае напрамак.

Існая асноўная чарга: #479 → #485 → #491; #288 → #483 і #72 → #73 → #74 → #75; #491 + акаўнты #330 → #492; скразная прыёмка #296 → фізічныя праходы #297 → рэліз #299. Гэта кароткі маршрут, не поўная замена Blocked-by кожнай Issue.

## Праверка публікацыі

Усе 35 картак G21 (эпік і 34 падзадачы) створаныя і маюць рэальныя ID. Залежнасці правераныя на цыклы; вынікі паўторнага чытання і бачнасці — у publication-verification.json. Новыя пазнакі запуску не выстаўляліся. Дакументы яшчэ лакальныя: #533 публікуе першапачатковы план, #556 — дадатак і абноўленыя моўныя карткі пасля #533. #533 атрымала agent:blocked праз недаступнасць лакальных дакументаў на камп’ютары выканаўцы; яе крытэрыі не мяняліся. Гэтая публікацыя ў галіне перадае зыходныя дакументы для працягу задачы. Project-дошка недаступная: токен не мае read:project. Доступы і налады аўтаматычнага запуску не мяняюцца.

## Адна крыніца і даследаванні

[Дадатак да спецыфікацыі](../../specifications/technical-completion/2026-10-03-single-source-translations.md) патрабуе аднаго арыгіналу з кантэкстам, аўтаматычна створаных набораў для праграмы і праверкі актуальнасці ўсіх выпушчаных перакладаў. Змена арыгіналу і праверка перакладаў уваходзяць у адзін камміт. Праверка версіі не замяняе праверку сэнсу.

Android, Microsoft, CLDR, Вікіслоўнік і IATE маюць асобныя даследчыя задачы. Вынікі: пяць справаздач → G21.33 з рашэннямі па крыніцах і сапраўднымі наступнымі GitHub-задачамі. Гэтая нарэзка не даследавала слоўнікі і не выбрала інтэграцыі.

## Перадача дакументаў выканаўцу

Зыходныя дакументы для #533 і #556 публікуюцца ў галіне eature/technical-completion-task-plan. #533 мае выканаўцу на іншым камп’ютары; гэта перадача матэрыялаў, а не прысваенне яго задачы ці пацвярджэнне яе крытэрыяў. У main дакументаў яшчэ няма: #533 павінна ўзгадніць ранейшыя моўныя правілы і апублікаваць першапачатковы план праз разгледжаны PR, #556 — дадатак.

Па прамой просьбе ўладара падзадачы атрымліваюць agent:ready. Гэта дазваляе выбар задачы толькі пасля закрыцця яе Blocked-by; асобнае зацвярджэнне моўнай архітэктуры #552 і астатнія правілы бяспекі захоўваюцца. Бацькоўскі эпік #532 не атрымлівае пазнакі запуску. Фактычны стан заўсёды чытаецца з GitHub.

Пры падрыхтоўцы публікацыі ў архіўных тэкставых журналах выдаленыя прабелы на канцах радкоў і лішнія пустыя радкі ў канцы файлаў. Вынікі застаюцца гістарычным запісам праверкі ад 2026-10-03, а не новым прагонам пасля абнаўлення main.
