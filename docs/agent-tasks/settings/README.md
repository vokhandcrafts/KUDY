# Налады і асабістыя прапановы — хваля G27

Крыніца: [канцэпцыя налад 17.10.2026](../../design/settings/2026-10-17-settings-concept.md), [светлы/цёмны макет](../../design/settings/settings-sheet.html). Статус: прапанова, не дазвол на runtime. Бацькоўскі эпік: [#346](https://github.com/vokhandcrafts/KUDY/issues/346). Усе задачы застаюцца ў backlog без `agent:ready` да пацверджання ўладальнікам і закрыцця залежнасцяў.

| ID | Вынік | GitHub | Залежнасці |
|---|---|---|---|
| [G27.00](G27.00.md) | Апублікаваць канцэпцыю, макеты і план | [#780](https://github.com/vokhandcrafts/KUDY/issues/780) | няма |
| [G27.01](G27.01.md) | Рашэнне ўладальніка па UX і таксаноміі | [#781](https://github.com/vokhandcrafts/KUDY/issues/781) | G27.00 |
| [G27.02](G27.02.md) | Экран налад і перанос выбару UI-мовы | [#782](https://github.com/vokhandcrafts/KUDY/issues/782) | G27.01, #774, #775 |
| [#436](https://github.com/vokhandcrafts/KUDY/issues/436) | Рашэнне і канон цёмнай тэмы | існая задача | паводле самой #436; G27.01 дае дызайн-уваход, але не ставіць dispatcher-залежнасць |
| [G27.02.a](G27.02.a.md) | Ручны выбар тэмы, калі #436 ухваліць цёмную | [#798](https://github.com/vokhandcrafts/KUDY/issues/798) | G27.02, #436 |
| [G27.03.a](G27.03.a.md) | Два аўтарскія брыфы для праверкі тэгаў | [#788](https://github.com/vokhandcrafts/KUDY/issues/788) | G27.01 |
| [G27.03](G27.03.md) | Рэдакцыйныя тэгі гайдаў і версійны кантракт | [#783](https://github.com/vokhandcrafts/KUDY/issues/783) | G27.01, G27.03.a |
| [G27.04](G27.04.md) | Захаванне пераваг і фільтр прапаноў | [#784](https://github.com/vokhandcrafts/KUDY/issues/784) | G27.02, G27.03 |
| [G27.05.a](G27.05.a.md) | Захаванне паходжання сувеніра/дасягнення | [#789](https://github.com/vokhandcrafts/KUDY/issues/789) | G27.01, #769 |
| [G27.05](G27.05.md) | Уваход у калекцыю з дакладнымі станамі | [#785](https://github.com/vokhandcrafts/KUDY/issues/785) | G27.02, #769, G27.05.a |
| [G27.06](G27.06.md) | Адзін аксесуар дракона як пілот | [#786](https://github.com/vokhandcrafts/KUDY/issues/786) | G27.05, #776 |
| [G27.07](G27.07.md) | Скразная праверка налад | [#787](https://github.com/vokhandcrafts/KUDY/issues/787) | G27.02, G27.04, #436, G27.02.a |

G27.05 і G27.06 не блакуюць выпуск G27.07: калекцыя і аксесуар — пасля-MVP этапы, а першы рэліз паводле 09 §17 мае толькі лог пад будучыя дасягненні. #436 выкарыстоўваецца паўторна, без другога dark-theme issue. Да merge PR G27.00 шляхі крыніц недаступныя ў `main`; новыя issues павінны мець `Blocked-by` на issue публікацыі. Публікацыя 17.10.2026: #780–#789 і #798 прачытаныя назад праз GitHub API, усе OPEN і без `agent:ready`; залежнасці супадаюць з карткамі. Бачнасць у GitHub Project/backlog не пацверджана: токен не мае `read:project`. PR з крыніцамі яшчэ чакае merge; #780 закрые яго, а астатнія задачы не запускаюцца да закрыцця сваіх `Blocked-by`.
