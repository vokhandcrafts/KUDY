# G19.02: бяспечныя афлайн-пакеты — unpack, ідэнтычнасць, confinement, рэверт-гарды

*Showboat demo задачи [#459](https://github.com/vokhandcrafts/KUDY/issues/459)
(эпік #456): `tools/corpus/extract.mjs` (профіль `wiki-html/v1` праз
Playwright-фабрыку — JavaScript адключаны, усе запыты абрываюцца) і
`tools/corpus/import.mjs` (нязменныя пакеты `articles/<article_id>/revisions/<revision_id>/`
са staged-запісам і атамным пераносам). Створана 2026-10-02. Уваход
сінтэтычны: фікстуры `fixtures/html/` + згенераваны PNG; бібліятэка — у
git-ігнараваным `.scratch/`.*

<!-- showboat-id: g1902-corpus-packages -->

Проф задачы — названыя паводзінавыя тэсты абедзвюх мяжоў: `body_with_single_p`,
`exclude_neighbor_navigation`, `caption_asset_binding`,
`static_original_refs_are_inert`, `zero_network` (extract);
`identity_not_title`, `retained_extractions`, `traversal_and_junction`,
`partial_write_retry`, `missing_local_media`, `cli_unpack_contract` (import)
+ дадатковыя `body_links_preserved`, `anchor_without_href_keeps_text_without_link`,
`named_diagnostics_for_limits_and_formats`:

```sh
node --test tools/corpus/extract.test.mjs tools/corpus/import.test.mjs 2>&1 | grep -E "^ℹ (tests|pass|fail)"
```

```output
ℹ tests 14
ℹ pass 14
ℹ fail 0
```

Жывы `unpack` на сінтэтычным дрэве: фікстура-мост з прывязаным па імені
файла PNG (асет хэшуецца, `images/<asset_id>.png`) і фікстура-пасткі з
аддаленай выяўай (запіс `missing`, без сеткавай загрузкі — 25 §3). Вывад
нясе толькі індэксы запісаў і прэфіксы ідэнтыфікатараў (25 §9):

```sh
rm -rf .scratch/g1902-demo
mkdir -p .scratch/g1902-demo/input/pages .scratch/g1902-demo/input/images .scratch/g1902-demo/library
cp tools/corpus/fixtures/html/example-0002-single-paragraph.html .scratch/g1902-demo/input/pages/bridge.html
cp tools/corpus/fixtures/html/example-0004-traps.html .scratch/g1902-demo/input/pages/traps.html
node -e "require('node:fs').writeFileSync('.scratch/g1902-demo/input/images/bridge-view.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64'))"
node -e "const fs=require('node:fs');fs.writeFileSync('.scratch/g1902-demo/input/manifest.json',JSON.stringify({source_namespace:'fixture-wiki',records:[{source_record_key:'bridge-0001',html_path:'pages/bridge.html',language:'be',rights:'public-domain',city_id:'gdansk',media:[{media_key:'bridge-photo-001',local_path:'images/bridge-view.png',rights:'cc0'}]},{source_record_key:'traps-0002',html_path:'pages/traps.html',language:'be',rights:'research_only'}]},null,2))"
node tools/corpus/cli.mjs unpack --manifest .scratch/g1902-demo/input/manifest.json --input-root .scratch/g1902-demo/input --library-root .scratch/g1902-demo/library
```

```output
corpus: record[0] imported — article 6ea9027a5348 revision adce24c9df62, 1 media file(s), 0 missing original(s)
corpus: record[1] imported — article a24c330e480c revision 7aa727db0bb5, 0 media file(s), 1 missing original(s)
corpus: unpack finished — 2 ok, 0 failed
```

Пакет на дыску: `raw.html` байт-у-байт, `images/<asset_id>.png` па хэшы
байтаў, `article.json` + адноўлены `text.md` на рэвізію ачысткі. Паўторны
unpack тых жа даных не стварае дублікатаў (`already-present`; падлікі
медыя не паўтараюцца — нічога не пераразлічваецца):

```sh
find .scratch/g1902-demo/library/articles -type f | LC_ALL=C sort | sed 's|^\.scratch/g1902-demo/library/||'
node tools/corpus/cli.mjs unpack --manifest .scratch/g1902-demo/input/manifest.json --input-root .scratch/g1902-demo/input --library-root .scratch/g1902-demo/library
```

```output
articles/6ea9027a5348fc933c31b52c7fba3b021623cdda54931e958cd232f52e407f89/revisions/adce24c9df62617061e98e8d63d50564aa896985e36dc4c5b3600635cb3aa839/extractions/wiki-html/v1/article.json
articles/6ea9027a5348fc933c31b52c7fba3b021623cdda54931e958cd232f52e407f89/revisions/adce24c9df62617061e98e8d63d50564aa896985e36dc4c5b3600635cb3aa839/extractions/wiki-html/v1/text.md
articles/6ea9027a5348fc933c31b52c7fba3b021623cdda54931e958cd232f52e407f89/revisions/adce24c9df62617061e98e8d63d50564aa896985e36dc4c5b3600635cb3aa839/images/c414cd0e204de974f73753c7e28d7638e7b3691bb8b1a2bab6b25bb7fed7ce77.png
articles/6ea9027a5348fc933c31b52c7fba3b021623cdda54931e958cd232f52e407f89/revisions/adce24c9df62617061e98e8d63d50564aa896985e36dc4c5b3600635cb3aa839/raw.html
articles/a24c330e480c2be2465e83cf551af7894a2b8b52c507b702ca2162ede89790f2/revisions/7aa727db0bb566078ea2d2cfbdc86d7d3ef78865a02e83332ece2c00e6a0ae9d/extractions/wiki-html/v1/article.json
articles/a24c330e480c2be2465e83cf551af7894a2b8b52c507b702ca2162ede89790f2/revisions/7aa727db0bb566078ea2d2cfbdc86d7d3ef78865a02e83332ece2c00e6a0ae9d/extractions/wiki-html/v1/text.md
articles/a24c330e480c2be2465e83cf551af7894a2b8b52c507b702ca2162ede89790f2/revisions/7aa727db0bb566078ea2d2cfbdc86d7d3ef78865a02e83332ece2c00e6a0ae9d/raw.html
corpus: record[0] already-present — article 6ea9027a5348 revision adce24c9df62
corpus: record[1] already-present — article a24c330e480c revision 7aa727db0bb5
corpus: unpack finished — 2 ok, 0 failed
```

Рэвэрт-эксперымент (implementation-rules 1): выдаленне праверкі confinement
(`path-escapes-root`) робіць названы тэст `traversal_and_junction` чырвоным;
аднаўленне з git — зелёнае.

```sh
perl -0pi -e "s/if \(real !== rootReal && !real\.startsWith\(rootReal \+ path\.sep\)\) \{/if (false) {/" tools/corpus/import.mjs
node --test tools/corpus/import.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)"
git checkout -- tools/corpus/import.mjs
node --test tools/corpus/import.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)"
```

```output
ℹ pass 6
ℹ fail 1
ℹ pass 7
ℹ fail 0
```
