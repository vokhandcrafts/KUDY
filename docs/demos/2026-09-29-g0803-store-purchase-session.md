# G08.03 — store purchase session: honest states, device linking, same-store restore

*2026-09-29 by Showboat 0.6.1*

The store purchase session (`services/entitlement/service.ts`, issue #290)
driving the closed outcome vocabulary against the scripted store session
(`fake-port.ts`) — the same module and wiring the composition root will use.
No network, no SDK, no clock: the device UUID and the product id are
synthetic constants, and every answer comes from the closed mapping of the
pinned `react-native-purchases` 10.9.1 error codes.

The honest states of one purchase session, live:

```sh
node --experimental-strip-types services/entitlement/demo-g0803.ts 2>/dev/null
```

```output
cancelled      → {"kind":"cancelled"}
pending        → {"kind":"payment-pending"}
not-allowed    → {"kind":"not-allowed"}
finished       → {"kind":"transaction-finished","productId":"com.kudy.route.gdansk_extended"}
store calls    → ["link 3f2b8c4e-1a2b-4c3d-8e9f-0a1b2c3d4e5f","purchase com.kudy.route.gdansk_extended","purchase com.kudy.route.gdansk_extended","purchase com.kudy.route.gdansk_extended","purchase com.kudy.route.gdansk_extended"]
restore        → {"kind":"restore-finished"}
executor-error → {"kind":"executor-error","code":"invalid-credentials"}
diagnostics    → ["entitlement:link created=1","entitlement:purchase-failed category=cancelled code=1","entitlement:purchase-failed category=payment-pending code=20","entitlement:purchase-failed category=not-allowed code=3","entitlement:purchase kind=transaction-finished","entitlement:restore kind=restore-finished"]
```

Read back: a backed-out payment sheet, a delayed payment and a store refusal
each answer with their own honest kind — none of them is a purchase; the
finished transaction is a store-session fact echoed with the requested
product id only; every transaction happens after exactly one `link` with the
registered device UUID (09 §5.1, `app_user_id = device_id`) — one link for
the whole session, purchases and restore alike; the RevenueCat
misconfiguration is an executor error, never a user answer; the diagnostics
are named closed-vocabulary lines that carry no store message.
