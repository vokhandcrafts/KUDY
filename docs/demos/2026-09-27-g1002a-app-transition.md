# G10.02.a — the app-transition contract: one config, /app, QR, public-only metadata

*Showboat demo for issue #319 (`web/` app transition), created 2026-09-27.*

<!-- showboat-id: g1002a-app-transition -->

Every paid-content CTA resolves through `web/lib/app-links.ts`; a store URL
outside that config fails the committed scan. The static export builds with
the two new `/app` fallback pages and the rendered-output leak scan stays
clean:

```sh
cd web && npm run build 2>&1 | tail -1
```

```output
rendered-output scan: clean
```

The guide card metadata carries the public fields only, and the locked stop's
card description is the preview announce verbatim — the transcript never
reaches a card. Both `/app` fallback pages exist in the export:

```sh
cd web && grep -o '<meta property="og:title" content="[^"]*"' out/guides/demo-route-a1.html && grep -o '<meta name="twitter:description" content="[^"]*"' out/guides/demo-route-a1/stops/stop-2.html && ls out/app.html out/en/app.html
```

```output
<meta property="og:title" content="Дэма-гід: сукнаны двор"
<meta name="twitter:description" content="За паваротам — апошняя калона старога млына і гісторыя пра яе вяртуна."
out/app.html
out/en/app.html
```

QR print assets are generated only against a live site origin; with the
origin unpublished the build states that explicitly instead of encoding a
fabricated domain:

```sh
cd web && node --experimental-strip-types scripts/build-qr.ts
```

```output
QR assets: none written — the site origin is unpublished (1 route(s) known); no fabricated origin is encoded
```

The guard suites over the new contract: the store-URL scan, the no-dead-end
route check, the public-only card checks, the QR round-trip decode and the
config's own contract — all green:

```sh
cd web && node --test --experimental-strip-types lib/content/app-links-scan.test.ts lib/content/internal-links.test.ts lib/content/cards.test.ts lib/qr.test.ts lib/app-links.test.ts 2>&1 | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const m=[...s.matchAll(/^. (tests|pass|fail) (\d+)/gm)];console.log(m.map(x=>x[1]+": "+x[2]).join("\n"))})'
```

```output
tests: 17
pass: 17
fail: 0
```
