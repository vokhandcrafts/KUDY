# build-bundle — зборшчык пакета G02.03

Інструмент аўтарскай зборкі з `09`, разд. 11: хэшуе кантэнт, генеруе `lock.json`,
раскладае пласты ў `public/` і `private/` і збірае `DiscoveryIndexV1` з давераным
пералікам feedback-мэт. Асобны працэс без агульнага коду ці БД з дадаткам
(`19`, разд. 2.4). Толькі Node stdlib, без новых залежнасцей.

## Запуск

```
node tools/build-bundle/build-bundle.mjs --in <аўтарская-тэчка> --out <чыстая-тэчка>
```

Выхадная тэчка павінна не існаваць або быць пустой; скрыпт нічога не сцірае.
Пры парушэнні правіла ў stderr трапляе адзін JSON `{"error":{"code":…}}`, код
выходу — 1. Памылкі нясуць толькі коды і ідэнтыфікатары, ніякага зместу гісторый.

## Што на ўваходзе

Строгі JSON-кантэнт паводле `09`, разд. 3 (не CSV-фармат аўтара — гэта P03/G02.01):

```
route.json places.json voices.json discovery.json
places/<place_id>/public.json           # публічныя праекцыі месцаў
collections/<collection_id>/public.json # публічныя праекцыі падборак
<locale>/base/{stops.json, audio/*.m4a}
<locale>/extended/{stops.json, audio/*.m4a}
```

Лакалі — allowlist `be/en/uk` з `21`, разд. 3.2 (`pl`/`de` зарэзерваваныя).

## Што на выхадзе

```
public/bundle/<route_id>/<version>/…   # base-пласт: stops, audio, previews.json, lock.json
public/places/<place_id>/public.json   # detail_ref-мэты месцаў
public/collections/<collection_id>/public.json # detail_ref-мэты падборак
public/discovery/<city_id>/<revision>/index.json
private/bundle/<route_id>/<version>/<locale>/extended/…   # lock.json у тым жа фармаце
release/feedback-target-registry.json  # толькі для сервера, кліенту не выдаецца
release/release-manifest.json          # поўны спіс артэфактаў з bytes+sha256
```

- `lock.json` — `[{path, bytes, sha256}]` з `09`, разд. 4; шляхі адносныя тэчцы
  пласта; сам lock сябе не пералічвае.
- `previews.json` — «асобна серыялізаваны публічны анонс locked-кропак» з `09`,
  разд. 5: толькі `stop_id`, `place_id`, `name`, `announce`.
- `index.json` — `DiscoveryIndexV1` з `21`, разд. 3.2; `availability`
  вылічаецца з апублікаванага зместу, `access` — з кантракту пласта
  (collection — `mixed` пры любым платным члене, `audio_locales` заўжды `[]`);
  `detail_ref`-шляхі правяраюцца супраць public-маніфесту.
- registry — `prepared`-мэты з `21`, разд. 5.2: guide па кожнай апублікаванай
  тэкставай локалі (у тым ліку text-only), place па апублікаванай праекцыі;
  collection і асобныя Story мэтаў гэтага выпуску не маюць.

## Гарантіі

1. **Паўтаральнасць.** Хэшы лічацца па байтах уваходных файлаў; тэчка
   `fixtures/content/**` замацаваная `-text` у `.gitattributes` (AR-1: CRLF
   checkout не павінен мяняць sha256). Згенераваныя файлы — кананічны JSON з
   адсартаванымі ключамі, без часовых адзнак. Дзве зборкі аднаго дрэва
   байт-у-байт супадаюць.
2. **Мяжа public.** Публічным трапляе толькі base-пласт і дазволеныя прэв'ю.
3. **Без уцечак.** Перад запісам увесь public-дрэва скануецца: 8-грамы прыватных
   тэкстаў, сегменты `private/extended/../` у шляхападобных радках, забарона
   `*.map`. Памылка `private-text-leak`/`private-path-in-public`/`source-map-in-public`
   спыняе зборку да запісу дрэва.
4. **Адхіленне неваліднага індэкса** (`21`, разд. 9, радок 1): дублі refs,
   укладзеныя collections, чужы горад, небяспечныя шляхі, невядомыя локалі/сезоны,
   парушаны дыяпазон хвілін, адсутны `overlap_note`.

## Мяжа адказнасці

Поўную праверку пакета (каардынаты, транскрыпты, незацверджаны кантэнт,
перакрыццё радыусаў, лічбавыя ліміты `21` разд. 3.2) робіць валідатар G02.02
(`tools/validate/`); публікацыю каталога і pointer update — G02.04. Гэты
скрыпт не валідуе кантэнт глыбей, чым трэба для бяспечнай зборкі.

## Тэсты

`npm test` запускае `tools/build-bundle/*.test.mjs`: паўтаральнасць, форма
`lock.json`, прэв'ю, уцечкі (станоўчы і негатыўны выпадкі), індэкс і registry,
конформацыя з фікстурамі `fixtures/discovery-contract/`, гварды wiring
і `.gitignore`. Выхад зборкі ў `tools/build-bundle/build/` — gitignored.
