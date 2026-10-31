# Сістэма праверкі дызайну — серыя DQ

Спецыфікацыя: [2026-10-30-design-qa-system.md](2026-10-30-design-qa-system.md), узгоднена ўладальнікам 2026-10-30. Эпік: [#908](https://github.com/vokhandcrafts/KUDY/issues/908). Карта задач: даныя ў [map.json](map.json); HTML-выгляд `index.html` генеруецца лакальна камандай `node spec-map/v04-render.mjs --map <тэчка>/map.json --source <тэчка>/source.json --out <тэчка>/index.html` з toolsLib і ў git не трапляе.

Карткі задач напісаныя па-англійску для агентаў; індэкс — для чалавека. ⚠️ — задача патрабуе ўладальніка ў жывой сесіі (`needs:owner`).

| ID | Вынік | GitHub | Залежнасці | Хто |
|---|---|---|---|---|
| [DQ-00](tasks/DQ-00.md) | Апублікаваць спецыфікацыю, задачы і карту | [#909](https://github.com/vokhandcrafts/KUDY/issues/909) | — | агент |
| [DQ-01](tasks/DQ-01.md) | Вымераць шум скрыншотаў і выбраць эталонны эмулятар | [#910](https://github.com/vokhandcrafts/KUDY/issues/910) | [DQ-00](tasks/DQ-00.md) | агент |
| [DQ-02](tasks/DQ-02.md) | Гісторыі карткі гіда і dev-экран для здымкаў | [#911](https://github.com/vokhandcrafts/KUDY/issues/911) | [DQ-00](tasks/DQ-00.md) | агент |
| [DQ-03](tasks/DQ-03.md) | Інструмент `visual:check`: здымак, параўнанне, справаздача | [#913](https://github.com/vokhandcrafts/KUDY/issues/913) | [DQ-01](tasks/DQ-01.md), [DQ-02](tasks/DQ-02.md) | агент |
| [DQ-04](tasks/DQ-04.md) | Першыя ўзоры карткі гіда і Explore | [#915](https://github.com/vokhandcrafts/KUDY/issues/915) | [DQ-03](tasks/DQ-03.md) | ⚠️ уладальнік |
| [DQ-05](tasks/DQ-05.md) | Правілы дызайн-QA агента | [#912](https://github.com/vokhandcrafts/KUDY/issues/912) | [DQ-00](tasks/DQ-00.md) | агент |
| [DQ-06](tasks/DQ-06.md) | Праверкі даступнасці з дампа | [#916](https://github.com/vokhandcrafts/KUDY/issues/916) | [DQ-03](tasks/DQ-03.md) | агент |
| [DQ-07](tasks/DQ-07.md) | Бенчмарк агента і журнал вердыктаў | [#917](https://github.com/vokhandcrafts/KUDY/issues/917) | [DQ-04](tasks/DQ-04.md), [DQ-05](tasks/DQ-05.md), [DQ-06](tasks/DQ-06.md) | ⚠️ уладальнік |
| [DQ-08](tasks/DQ-08.md) | Цёмная тэма ў матрыцы здымкаў | [#918](https://github.com/vokhandcrafts/KUDY/issues/918) | [DQ-04](tasks/DQ-04.md), [#436](https://github.com/vokhandcrafts/KUDY/issues/436) | ⚠️ уладальнік |
| [DQ-09](tasks/DQ-09.md) | Нямецкая мова і малы экран у матрыцы | [#919](https://github.com/vokhandcrafts/KUDY/issues/919) | [DQ-04](tasks/DQ-04.md) | ⚠️ уладальнік |
| [DQ-10](tasks/DQ-10.md) | `visual:check` у Android CI | [#920](https://github.com/vokhandcrafts/KUDY/issues/920) | [DQ-01](tasks/DQ-01.md), [DQ-03](tasks/DQ-03.md) | агент |
| [DQ-11](tasks/DQ-11.md) | Праверка згенераваных выяў па брыфе | [#921](https://github.com/vokhandcrafts/KUDY/issues/921) | [DQ-05](tasks/DQ-05.md) | агент |
| [DQ-12](tasks/DQ-12.md) | Перадправерка HTML-макетаў па каноне | [#922](https://github.com/vokhandcrafts/KUDY/issues/922) | [DQ-05](tasks/DQ-05.md) | агент |
| [DQ-13](tasks/DQ-13.md) | Storybook React Native на тэлефоне | [#914](https://github.com/vokhandcrafts/KUDY/issues/914) | [DQ-02](tasks/DQ-02.md) | агент |

## Парадак

DQ-00 → DQ-01, DQ-02, DQ-05 паралельна → DQ-03 і DQ-13 → DQ-04, DQ-06 → DQ-07: гэта першая версія. Далей DQ-09, DQ-10, DQ-11, DQ-12 у любым парадку; DQ-08 — пасля [#436](https://github.com/vokhandcrafts/KUDY/issues/436).

## Статус публікацыі

2026-10-30 створаныя [#908](https://github.com/vokhandcrafts/KUDY/issues/908) (эпік) і [#909](https://github.com/vokhandcrafts/KUDY/issues/909)–[#922](https://github.com/vokhandcrafts/KUDY/issues/922): усе ў backlog без `agent:ready`, задачы з ⚠️ маюць `needs:owner`. Да мержу PR задачы DQ-00 шляхі карткаў і спецыфікацыі ў `main` недаступныя; астатнія задачы чакаюць яе праз `Blocked-by`. G26.11 ([#775](https://github.com/vokhandcrafts/KUDY/issues/775)) пашырае гісторыі і экран з DQ-02, а не стварае другі. Публікацыя не дазваляе запуск выканаўцаў.
