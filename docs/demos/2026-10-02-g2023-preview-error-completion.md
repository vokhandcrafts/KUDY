# Прэв'ю: завяршэнне аперацыі пры памылцы чытання фактаў (issue #496, R6)

*Showboat demo для фіксу G20.23: пасля ўдалай актывацыі адмова
`layerState`/`evaluate` кідала выключэнне з `download()` — `busy` заставаўся
`true` назаўсёды, а пачатковы `refresh()` з такой адмовай пакідаў экран у
вечным `loading`. Створана 2026-10-02.*

<!-- showboat-id: g2023-preview-error-completion -->

Дэма ганяе контролерны тэст з чатырма новым кейсамі R6
(`activation_refresh_failure_releases_busy`, `failed_evaluate_retry`,
`initial_refresh_terminal`, `stale_refresh_failure`): сінтэтычныя адмовы
партоў фактаў праз сапраўдны `createPreviewController`. Рэверц-эксперыменты
(implementation-rules 1) выкананы ў гэтай сесіі: без фіксу кантролера чырвоныя
ўсе чатыры кейсы (адмова заглушанага boot-прагону дасягае runner'а як
unhandled rejection), без run-guard'а ў catch — кейс `stale_refresh_failure`;
з фіксам — ніжэйшы вывод, два прагону запар байт-у-байт ідэнтычныя.

```sh
node --test controllers/catalog/previewController.test.ts 2>&1 | grep -E "^ℹ (tests|pass|fail)"
```

```output
ℹ tests 25
ℹ pass 25
ℹ fail 0
```
