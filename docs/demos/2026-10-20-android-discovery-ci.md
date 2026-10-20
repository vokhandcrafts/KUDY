# Праверка запуску Android discovery у PR

*2026-10-20 by Showboat 0.6.1*

Гэты тэст чытае сапраўдны `.github/workflows/android-e2e.yml`. Ён патрабуе запуску пры кожным PR у `main` і паслядоўнага выканання `smoke`, `walk`, `discovery` на эмулятары CI. Да праўкі тэст падаў на вузкім `pull_request.paths`.

```bash
node --test tools/ci/e2e-workflows.test.mjs >/dev/null && echo 'Android PR workflow wiring: PASS'
```

```output
Android PR workflow wiring: PASS
```
