# G20.11 — /v1/grant URL TTL policy: the 600 s cap at the core boundary

*2026-10-02 by Showboat 0.6.1*

The grant core (`supabase/functions/_shared/grant-core.ts`, issue #482)
refuses any URL TTL outside the canonical short-lived policy (N5; `09` §2,
private-zone TTL 10 min) before any port runs. The round drives real
Postgres (PGlite) with the committed migrations applied and the production
SQL ports (`grant_products` mapping, positive-only `entitlement_cache`); the
provider, the manifest source and the signer are fakes on a fixed clock, so
every line is deterministic; device and product identifiers are seeded at
runtime and never printed.

The TTL gate, live:

```sh
node --experimental-strip-types supabase/functions/_shared/demo-g2011.ts 2>/dev/null
```

```output
600 s → {"status":200,"body":{"lock_url":"https://files.test/demo-route/lock.json","urls":[{"path":"audio/story-01.mp3","url":"https://files.test/granted/audio/story-01.mp3","expires_at":1700000600000}]}}
601 s → {"status":503,"code":"entitlement_unavailable","retryAfterSeconds":30} / mints 1 / provider calls 1
ttl 0 → {"status":503,"code":"entitlement_unavailable"} / mints 1
ttl 0.5 → {"status":503,"code":"entitlement_unavailable"} / mints 1
ttl NaN → {"status":503,"code":"entitlement_unavailable"} / mints 1
absent config → status 200 / mints 2 / canonical ttl 600
```

Read back: the canonical 600 s mints exactly `now + 600 s`; one second over
the cap fails closed with the closed-list 503 — the mint counter stays at 1
and the provider counter at 1, so the gate fired before the positive cache
or the provider could answer; zero, fractional and non-finite TTLs are
refused the same way; the absent configuration is the 600 s default and it
still mints. The test proves our server never hands out an out-of-policy
TTL, not a live Storage maximum.
