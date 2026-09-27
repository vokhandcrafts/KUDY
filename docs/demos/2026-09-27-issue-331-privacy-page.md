# Issue #331 — the public privacy page on the web channel (be/en)

*Showboat demo for issue #331, created 2026-09-27.*

<!-- showboat-id: issue-331-privacy-page -->

The static export builds with the two privacy pages and the rendered-output
leak scan stays clean:

```sh
cd web && npm run build 2>&1 | tail -1
```

```output
rendered-output scan: clean
```

Served from the export with the repository's zero-dependency static server,
both locale pages return 200 and carry the required policy statements:

```sh
node --input-type=module -e "import {createStaticServer} from './tools/serve-static.mjs'; createStaticServer('web/out').listen(4319)" >/dev/null 2>&1 &
SRV=$!
sleep 1
curl -s -o /dev/null -w 'be privacy: %{http_code}\n' http://127.0.0.1:4319/privacy.html
curl -s -o /dev/null -w 'en privacy: %{http_code}\n' http://127.0.0.1:4319/en/privacy.html
curl -s http://127.0.0.1:4319/privacy.html | grep -o 'не пакідаюць прыладу\|толькі па яўнай згодзе\|14 месяцаў\|My KUDY\|не збірае акаўнтаў' | sort -u
curl -s http://127.0.0.1:4319/en/privacy.html | grep -o 'never leave the device\|only with explicit consent\|14 months\|My KUDY\|collects no accounts' | sort -u
kill $SRV 2>/dev/null
wait $SRV 2>/dev/null
```

```output
be privacy: 200
en privacy: 200
14 месяцаў
My KUDY
не збірае акаўнтаў
не пакідаюць прыладу
толькі па яўнай згодзе
14 months
collects no accounts
My KUDY
never leave the device
only with explicit consent
```

The guard suite fails if a route file is removed or a required statement
drifts — the revert experiment (a marker removed from `be.ts`) failed this
suite with the exact diagnostic in the shipping session:

```sh
node --test --experimental-strip-types --test-reporter=tap web/privacy-page.test.ts 2>/dev/null | grep -E '^ok'
```

```output
ok 1 - privacy page routes exist for both UI locales
ok 2 - privacy page renders through SiteShell and binds the support link through lib/app-links.ts
ok 3 - privacy strings exist in both locales, none empty (key-set parity: lib/content/pages.test.ts)
ok 4 - required privacy statements are present in both locales
```
