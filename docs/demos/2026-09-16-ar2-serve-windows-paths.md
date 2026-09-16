# AR-2: the loopback server serves the package on Windows (platform-separator containment)

*2026-09-15T23:30:55Z by Showboat 0.6.1*
<!-- showboat-id: c3c8f2ee-ab58-49a2-bec1-967cf8f0e952 -->

Fix for AR-2 (#79): the containment check in scripts/serve.mjs compared against a hardcoded '/', while Windows path.join/normalize produce backslashes — the server 404'd every request. The check now uses root + sep (the repo idiom from G00.03 grant-server.mjs). The session host is the affected machine itself: Windows with core.autocrlf=true. A regression test (test/serve.test.mjs) boots the server and fails on any platform when the check is reverted.

```bash
git config core.autocrlf && cd spikes/G00.02-offline-map && rm -rf runtime && node scripts/prepare-data.mjs >/dev/null && echo package ready
```

```output
true
package ready
```

```bash
cd spikes/G00.02-offline-map && { (exec node scripts/serve.mjs) >/dev/null 2>&1 & sleep 2; for p in / /style.json /glyphs/0-255.json; do curl -s -o /dev/null -w "GET $p -> %{http_code}\n" "http://127.0.0.1:4173$p"; done; curl -s -o /dev/null -w "GET /../source/app.js -> %{http_code}\n" "http://127.0.0.1:4173/../source/app.js"; curl -s -o /dev/null -w "GET /%2e%2e/lib/package.mjs -> %{http_code}\n" "http://127.0.0.1:4173/%2e%2e/lib/package.mjs"; PID=$(netstat -ano | grep ":4173.*LISTENING" | awk "{print \$NF}" | head -1); [ -n "$PID" ] && taskkill //F //PID "$PID" >/dev/null 2>&1; sleep 1; echo "server stopped"; } | tr -d "\r"
```

```output
GET / -> 200
GET /style.json -> 200
GET /glyphs/0-255.json -> 200
GET /../source/app.js -> 404
GET /%2e%2e/lib/package.mjs -> 404
server stopped
```

```bash
cd spikes/G00.02-offline-map && node --test test/serve.test.mjs 2>&1 | grep -v "duration_ms" | tail -n 5
```

```output
ℹ pass 1
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```
