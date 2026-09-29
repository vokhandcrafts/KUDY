# G08.04 — purchase chain: аплата → загрузка → AccessReady, honest states end to end

*2026-09-29 by Showboat 0.6.1*

The client purchase chain (`services/entitlement/purchase-chain.ts`, issue
#291) running the full path over the production modules: the scripted store
session (`fake-port.ts`), the signed-URL grant fake, and the real activation
core with a node bundles store — the same wiring the composition root will
use. No network, no SDK, no clock: the device UUID and the product id are
synthetic constants, and every scenario gets its own temporary bundles root
that is removed before the process exits.

The chain's honest states through a cancelled purchase, a failed download,
the retry, the expired-URL renewal, and a broken digest:

```sh
node --experimental-strip-types services/entitlement/demo-g0804.ts 2>/dev/null
```

```output
cancelled      → {"kind":"purchase-not-finished","state":"not-owned"} | state = not-owned
failed dl      → {"kind":"download-incomplete","state":"paid","status":"partial"} | state = paid
retry          → {"kind":"ready","state":"ready"} | state = ready
store calls    → ["link 3f2b8c4e-1a2b-4c3d-8e9f-0a1b2c3d4e5f","purchase com.kudy.route.gdansk_extended","purchase com.kudy.route.gdansk_extended"]
expired url    → {"kind":"ready","state":"ready"} | grant POSTs = 2
hash-mismatch  → {"kind":"download-incomplete","state":"paid","status":"hash-mismatch"} | state = paid
verified retry → {"kind":"ready","state":"ready"} | state = ready
events         → ["AccessReady route-1@v1 be/base stops=[a,b]"]
```

Read back: a backed-out payment sheet passes the store's own honest answer
through and never starts a download; the finished transaction followed by a
dying transfer keeps the product at `paid` — «Куплена · трэба загрузіць» —
and the retry completes **without the store being asked again** (two store
calls: the first cancelled purchase, the second finished one); the expired
grant URL renews through a second POST /v1/grant mid-download with no
repeated payment; a file whose bytes fail the digest check is never ready
and emits nothing — only the verified retry commits, and the single
`AccessReady route-1@v1 be/base stops=[a,b]` event is the activation
commit's own emission through the typed port (09 §5.1, ADR G01.03 §3.5,
`11` §8).
