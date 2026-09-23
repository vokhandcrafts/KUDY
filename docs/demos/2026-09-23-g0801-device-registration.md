# G08.01 — device registration: one-time secret, RLS deny-by-default, wired suites

*2026-09-23T00:20:00Z by Showboat 0.6.1*
<!-- showboat-id: 8c4e2f1a-6b3d-4e9f-a5c8-2d7b1e9f4a60 -->

The device-registration core (`supabase/functions/_shared/device-core.ts`,
issue #64): a registration mints a UUID plus a 32-byte secret whose SHA-256
hash is the only stored form, and the new `supabase/functions/_shared` module
surface is visible to the G18.03 reader. Deterministic outputs; the suite
summaries are filtered to the count lines (implementation-rules 11).

The core's shape, live:

```sh
node --experimental-strip-types --input-type=module -e "
const m = await import('./supabase/functions/_shared/device-core.ts');
const r = m.registerDevice();
console.log('device_id is UUID:', /^[0-9a-f-]{36}$/.test(r.deviceId));
console.log('secret bytes:', Buffer.from(r.deviceSecret, 'base64url').length);
console.log('secret hash is sha256 hex:', /^[0-9a-f]{64}$/.test(r.secretHash));
console.log('secret never in stored hash:', !r.secretHash.includes(r.deviceSecret));
const again = m.registerDevice();
console.log('second registration differs:', again.deviceSecret !== r.deviceSecret && again.deviceId !== r.deviceId);
" 2>/dev/null
```

```output
device_id is UUID: true
secret bytes: 32
secret hash is sha256 hex: true
secret never in stored hash: true
second registration differs: true
```

The same surface the module map (19 §2.4) assigns to G08.01, as read by the
G18.03 tool:

```sh
node tools/arch-surface/arch-surface.mjs supabase/functions/_shared
```

```output
# arch-surface: supabase/functions/_shared

## device-core.test.ts
exports: (none)
imports: node:assert/strict, node:crypto, node:test

## device-core.ts
exports: BearerVerification, DEVICE_INSERT_SQL, DEVICE_LOOKUP_SQL, DEVICE_RATE_LIMIT, DEVICE_RATE_WINDOW_MS, DeviceRegistration, RATE_INCREMENT_SQL, RateDecision, RateStorage, checkRateLimit, createMemoryLookup, hashIp, hashSecret, rateWindowStart, registerDevice, verifyBearer
imports: node:crypto

## fixtures-hygiene.test.ts
exports: (none)
imports: node:assert/strict, node:child_process, node:fs, node:path, node:test, node:url

## rls.test.ts
exports: (none)
imports: @electric-sql/pglite, node:assert/strict, node:fs, node:path, node:test, node:url
```

The RLS migration applied to a real Postgres (PGlite, in-process): the anon
role cannot see or write device rows even when a grant is re-added, the
service role writes through, and device delete cascades. Suite summary only —
the per-test lines carry timings:

```sh
node --test --experimental-strip-types supabase/functions/_shared/rls.test.ts 2>/dev/null | grep -E "^ℹ (tests|pass|fail)"
```

```output
ℹ tests 9
ℹ pass 9
ℹ fail 0
```
