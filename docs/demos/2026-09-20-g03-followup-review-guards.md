# Follow-up PR #133 — нормы Belarusian, гварды рэндэрара агляду і README-спіс правіл

Дэма па issue #139 (няблакавальныя знаходкі рэвю PR #133, раунд 2). Чатыры
фіксы: руская стэма «вдоўж» у be-драфце заменена на норму «ўздоўж» (справаздача
аўтара рэгенераваная інструментам, стан адзнак аўтара не крануты); рэндэрар
агляду адмаўляе прасторы, што не праходзіць праверку, з іменаваным правілам
(тэст гварда падае пры прыбраным кідку); README дапоўніў спіс машынных правіл
трыма прапушчанымі (`mark-without-reviewer`, `draft-id-mismatch`,
`claims-on-non-fact-block`); локатар у тэсце крытэрыя 1 правяраецца
па-фрагментна, пад сваёй цытатай. Вывад дэтэрмінаваны.

Норма мовы: у дрэве няма рускай стэмы «вдоўж» — ні ў драфце, ні ў справаздачы:

```sh
git grep -n "вдоўж" -- authoring/ || echo "чыста: рускай стэмы няма, норма «ўздоўж»"
```

```output
чыста: рускай стэмы няма, норма «ўздоўж»
```

Гвард рэндэрара: агляд не рэндэрыцца з прасторы, што завалідавалася з
памылкай — дыягностыка называе правіла фікстуры:

```sh
node tools/validate/authoring-review-report.mjs --in fixtures/authoring-pipeline/invalid-unbacked-connection --draft be 2>&1 | grep -oF 'прастора не праходзіць праверку (unbacked-connection)'
```

```output
прастора не праходзіць праверку (unbacked-connection)
```

Спіс машынных правіл у `authoring/README.md` больш не прапускае правілы
вальдатара — усе тры ранейшыя пропускі прысутнічаюць:

```sh
grep -c 'mark-without-reviewer\|draft-id-mismatch\|claims-on-non-fact-block' authoring/README.md
```

```output
3
```

Локатар стыкуецца са сваёй цытатай па-фрагментна: fr-004 нясе «ст. 825,
абзац 4», хоць fr-002 і fr-003 маюць тую ж старонку 825 — глабальны
`includes` гэтага не адрозніваў:

```sh
node tools/validate/authoring-review-report.mjs --in authoring/gdansk --draft gdansk-stmary-be | grep -A1 "Hanseatic League"
```

```output
  - Цытата: „It was one of the four chief towns of the Hanseatic League.“
  - Локатар: том VII, ст. 825, абзац 4 — src-eb1911-danzig — Danzig. — In: Encyclopædia Britannica. 11th ed. Vol. 7 (Converse, George Thomas — Day, Ernest) (public_domain, 1911)
```
