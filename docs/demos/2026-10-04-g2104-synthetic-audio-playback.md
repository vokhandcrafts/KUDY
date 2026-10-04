# G21.04 (issue #537): сінтэтычны дэм-аўдыё і рэальнае прайграванне ў Chromium

*Заўвага да асяроддзя: голы `node` на гэтым хасце патрабуе
`LD_LIBRARY_PATH=$HOME/.local/lib` (зрух libsimdjson 2026-09-30), блокі
запускаюцца з гэтым экспартам.*

*Showboat дэма задачи #537: чатыры 6-секундныя AAC-тоны згенераваны афлайн
каміціраваным генератарам (`tools/demo-audio/generate-demo-audio.mjs`,
ffmpeg lavfi sine + loudnorm −16 LUFS), `media.json` — байт-лочак пакета;
browser-пруф — `tools/web/audio-playback-regression.mjs` (рэальны Chromium
па свежым экспарце `web/out`, усе знешнія запыты абарваны, клік — сапраўдны
user gesture па native controls). Блоку browser-пруфу патрэбен адностроены
экспарт: `npm run build` у `web/` (вывад білда недэтэрмінаваны, таму не
блок дэмы). Створана 2026-10-04.*

<!-- showboat-id: g2104-synthetic-audio -->

Лочак супадае з байтамі фікстураў; два прагоны запар даюць той самы вывад:

```sh
LD_LIBRARY_PATH=$HOME/.local/lib node tools/demo-audio/generate-demo-audio.mjs --verify
LD_LIBRARY_PATH=$HOME/.local/lib node tools/demo-audio/generate-demo-audio.mjs --verify
```

```output
{
  "ok": true,
  "files": 4,
  "duration_s": 6,
  "loudness_target_lufs": -16
}
{
  "ok": true,
  "files": 4,
  "duration_s": 6,
  "loudness_target_lufs": -16
}
```

Праверка адкату (implementation-rules 1): вяртанне be/base-файла да
85-байтавага плэйсхолдара `KUDY-DEMO-AUDIO` — іменаваны правал
`media-sha-unmatched` і exit 1; `git checkout --` вяртае exit 0:

```sh
printf 'KUDY-DEMO-AUDIO\n' > fixtures/content/demo-route/be/base/audio/story-1-base.m4a
LD_LIBRARY_PATH=$HOME/.local/lib node tools/validate/validate-package.mjs --in fixtures/content/demo-route 2>&1 | grep -m1 'media-sha-unmatched'
LD_LIBRARY_PATH=$HOME/.local/lib node tools/validate/validate-package.mjs --in fixtures/content/demo-route >/dev/null 2>&1; echo "exit=$?"
git checkout -- fixtures/content/demo-route/be/base/audio/story-1-base.m4a
LD_LIBRARY_PATH=$HOME/.local/lib node tools/validate/validate-package.mjs --in fixtures/content/demo-route >/dev/null 2>&1; echo "exit=$?"
```

```output
      "rule": "media-sha-unmatched",
exit=1
exit=0
```

Прайграванне ў рэальным Chromium: усе чатыры праверкі зелёныя — платныя
уцечкі адсутнічаюць, абодва трэкі дэкодуюцца (duration 6 с), currentTime
рухаецца да паўзы, псеўда-файл дае MediaError 4; два прагоны запар
ідэнтычныя:

```sh
LD_LIBRARY_PATH=$HOME/.local/lib node tools/web/audio-playback-regression.mjs | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['ok'], {k: v['ok'] for k, v in d['checks'].items()})"
LD_LIBRARY_PATH=$HOME/.local/lib node tools/web/audio-playback-regression.mjs | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['ok'], {k: v['ok'] for k, v in d['checks'].items()})"
```

```output
True {'export_paid_media_absent': True, 'synthetic_audio_decodes': True, 'playback_advances': True, 'corrupt_asset_fails': True}
True {'export_paid_media_absent': True, 'synthetic_audio_decodes': True, 'playback_advances': True, 'corrupt_asset_fails': True}
```

Сюты рэгрэсіі (`export_paid_media_absent`, `synthetic_audio_decodes`,
`playback_advances`, `corrupt_asset_fails`) муюць крытэрыі 2–3 issue #537;
гейт цэласнасці (`media-sha-unmatched`) уваходзіць у `npm test` праз
`tools/validate` (рэальны дэм-пакет валідуецца ў
`validate-package.test.mjs`), таму адкат любога байта фікстуры ловіцца
стандартным ранерам.
