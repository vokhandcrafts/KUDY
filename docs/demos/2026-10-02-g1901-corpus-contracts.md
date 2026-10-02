# G19.01: кантракты корпуса — валідатары, CLI і рэверт-гарды

*Showboat demo задачи [#458](https://github.com/vokhandcrafts/KUDY/issues/458)
(эпік #456): пінаваныя схемы v1 даследчага корпуса (маніфест імпарту, пакет
артыкула, абодва ўзроўні мадэлі, Case, рашэнне, канфіг прагону, экспарты),
чатыры валідатары ў `tools/corpus/contracts.mjs` з стабільнымі дыягностыкамі,
CLI `validate-input`/`validate-run`, слоўнік `gdansk-v1` і фікстуры без
рэальных крыніц. Створана 2026-10-02.*

<!-- showboat-id: g1901-corpus-contracts -->

Проф задачы — названыя паводзінавыя тэсты кантрактаў і CLI (у тым ліку
`invalid_null_manifest`, `duplicate_source_key`, `invalid_rights`,
`hook_limit`, `quote_unicode_offsets`, `unknown_fragment_id`,
`validation_exit_codes`, `corpus_suite_is_wired`):

```sh
node --test tools/corpus/contracts.test.mjs tools/corpus/cli.test.mjs 2>&1 | grep -E "^ℹ (tests|pass|fail)"
```

```output
ℹ tests 20
ℹ pass 20
ℹ fail 0
```

Жывы CLI прымае закамічаны сінтэтычны маніфест (адносныя шляхі, правы
`research_only` для невядомых, ніякага дакранання файлаў — існаванне
праверае распакоўка G19.02):

```sh
node tools/corpus/cli.mjs validate-input --manifest tools/corpus/fixtures/manifests/valid-input-v1.json
```

```output
corpus: manifest ok — 4 record(s), 2 media file(s)
```

Той жа CLI адхіляе маніфест з паўтораным ключом крыніцы — дыягностыка
носіць імя правілы і шлях дакумента, без змесціва палёў (25 §6: ключы
крыніцы ў журнал не пішуцца). Зламаны маніфест пішацца ў git-ігнараваны
`.scratch/`, таму дрэва застаецца чыстым:

```sh
node -e "const fs=require('node:fs');const m=JSON.parse(fs.readFileSync('tools/corpus/fixtures/manifests/valid-input-v1.json','utf8'));m.records[1].source_record_key='example-0001';fs.mkdirSync('.scratch',{recursive:true});fs.writeFileSync('.scratch/g1901-demo-duplicate.json',JSON.stringify(m));"
node tools/corpus/cli.mjs validate-input --manifest .scratch/g1901-demo-duplicate.json; echo "exit: $?"
```

```output
corpus: manifest invalid (1 diagnostic(s))
  duplicate-source-key at $.records[1].source_record_key
exit: 1
```

Рэверт-эксперымент (implementation-rules 1): выдаленне радка правілы
`duplicate-source-key` з валідатара робіць названы тэст чырвоным;
аднаўленне з git — зелёнае.

```sh
perl -ni -e "print unless /duplicate-source-key', path/" tools/corpus/contracts.mjs
node --test tools/corpus/contracts.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)"
git checkout -- tools/corpus/contracts.mjs
node --test tools/corpus/contracts.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)"
```

```output
ℹ pass 13
ℹ fail 1
ℹ pass 14
ℹ fail 0
```
