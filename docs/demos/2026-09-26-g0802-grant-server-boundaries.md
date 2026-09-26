# G08.02 — /v1/grant server boundaries: product mapping, 403/503, sandbox→production, bounded cache

*2026-09-26 by Showboat 0.6.1*

The grant server core (`supabase/functions/_shared/grant-core.ts`, issue
#289) driving the `POST /v1/grant` gate matrix against real Postgres (PGlite)
with the committed migrations applied and the production SQL ports
(`grant_products` mapping, positive-only `entitlement_cache`). The provider,
the manifest source and the signer are fakes on a fixed clock, so every line
is deterministic; device and product identifiers are seeded at runtime and
never printed.

The gate matrix, live:

```sh
node --experimental-strip-types supabase/functions/_shared/demo-g0802.ts 2>/dev/null
```

```output
foreign path → {"status":403,"code":"path_not_allowed"}
not entitled → {"status":403,"code":"no_entitlement"}
provider down → {"status":503,"code":"entitlement_unavailable","retryAfterSeconds":30}
sandbox → production: {"status":403,"code":"environment_mismatch"}
entitled → status 200 members ["audio/story-02.mp3"]
url ttl seconds 600 / retry-after seconds 30
cache hit skips provider: true
```

Read back: a path outside the manifest is refused before the entitlement
check; a refusal and an outage land on opposite sides of the 403/503 line
(`no_entitlement` vs `entitlement_unavailable` with `Retry-After`); a sandbox
entitlement never opens a production-configured server; a grant mirrors
exactly the requested manifest members; the repeated request is answered by
the positive cache without touching the provider again.
