# G05.02.b — location service: one subscription, the ≤ 20 region window, the watchdog

*Showboat demo for issue #211 (`services/location`), created 2026-09-24.*

<!-- showboat-id: g0502b-location-service -->

`services/location` is a plain class over an injected OS port (the pattern of `services/db` and `services/contentRepo`): it owns the one OS subscription, the ≤ 20-region geofence window and the watchdog; it does not own the position and makes no trigger decision. The demo drives the service through the fake OS port with a manual clock — every printed fact is a service decision, not a port default. Synthetic fixture coordinates only; nothing real is printed here.

Repeated `setMode` calls and a mode change never leave two subscriptions, `idle`/`paused` hold none, and the window of a 25-stop selection is the 20 nearest stops by the latest fix — the route-first but geo-farthest stop never makes it (criteria 1, 2):

```sh
node --experimental-strip-types -e '
const { LocationService } = await import("./services/location/service.ts");
const { FakeLocationOsPort } = await import("./services/location/fake-port.ts");
const makeStops = (count) => Array.from({ length: count }, (_, i) => ({
  stopId: "stop-" + String(count - i).padStart(2, "0"),
  lat: 54.4 + (i + 1) * 0.001, lng: 18.65, radius: 30,
}));
const fix = { lat: 54.4, lng: 18.65, accuracy: 5, at: 1000 };
const clock = { now: () => 0, schedule: () => () => {} };
const port = new FakeLocationOsPort();
// G05.02.c made the app-config explanation strings a required dep; this
// demo passes stand-ins its assertions never print.
const permissions = { foreground: "fg", background: "bg" };
const service = new LocationService({ port, clock, permissions });
service.setMode("active-guide");
service.setMode("active-guide");
service.setMode("active-guide");
console.log("subs after three setMode calls : " + port.activeSubscriptions());
service.setMode("city-surface");
console.log("subs after a mode change       : " + port.activeSubscriptions());
service.setMode("active-guide");
service.setGeofenceWindow(makeStops(25));
port.emitFix(1, fix);
const ids = port.regions.map((r) => r.stopId);
console.log("window size of 25 selected     : " + ids.length);
console.log("route-first stop-01 in window  : " + ids.includes("stop-01"));
console.log("geo-nearest stop-25 in window  : " + ids.includes("stop-25"));
service.setMode("paused");
console.log("subs while paused              : " + port.activeSubscriptions());
console.log("regions while paused           : " + port.regions.length);
' 2>/dev/null
```

```output
subs after three setMode calls : 1
subs after a mode change       : 1
window size of 25 selected     : 20
route-first stop-01 in window  : false
geo-nearest stop-25 in window  : true
subs while paused              : 0
regions while paused           : 0
```

The watchdog: 15 s without a fix resubscribes with a fresh generation, the stale-generation fix is dropped whole, the bounded backoff ends in `stalled`, and a mid-session revocation is a `status()` value — never an exception — with the subscription and the window released (criteria 3, 4):

```sh
node --experimental-strip-types -e '
const { LocationService } = await import("./services/location/service.ts");
const { FakeLocationOsPort } = await import("./services/location/fake-port.ts");
const { WATCHDOG_GAP_MS } = await import("./services/location/types.ts");
let now = 0;
const timers = [];
const clock = {
  now: () => now,
  schedule: (delayMs, fn) => {
    const entry = { due: now + delayMs, fn };
    timers.push(entry);
    return () => {
      const at = timers.indexOf(entry);
      if (at >= 0) timers.splice(at, 1);
    };
  },
};
const advance = (ms) => {
  const limit = now + ms;
  for (;;) {
    const due = timers.filter((t) => t.due <= limit)[0];
    if (!due) break;
    timers.splice(timers.indexOf(due), 1);
    now = Math.max(now, due.due);
    due.fn();
  }
  now = limit;
};
const port = new FakeLocationOsPort();
const permissions = { foreground: "fg", background: "bg" }; // G05.02.c: required dep
const service = new LocationService({ port, clock, permissions });
const fixes = [];
service.onFix((fix) => fixes.push(fix));
service.setMode("active-guide");
port.emitFix(1, { lat: 54.4, lng: 18.65, accuracy: 5, at: 1000 });
console.log("status after a fix             : " + JSON.stringify(service.status()));
advance(WATCHDOG_GAP_MS);
console.log("status after a 15 s gap        : " + JSON.stringify(service.status()));
port.emitFix(1, { lat: 54.41, lng: 18.65, accuracy: 5, at: 2000 });
console.log("fixes after a stale fix        : " + fixes.length);
port.emitFix(2, { lat: 54.41, lng: 18.65, accuracy: 5, at: 2000 });
console.log("fixes after a live fix         : " + fixes.length);
advance(WATCHDOG_GAP_MS + 1000 + 2000 + 4000 + 8000);
console.log("status after the backoff       : " + JSON.stringify(service.status()));
console.log("subs at stalled                : " + port.activeSubscriptions());
port.reportPermission("denied");
console.log("status after a revocation      : " + JSON.stringify(service.status()));
console.log("subs after a revocation        : " + port.activeSubscriptions());
console.log("regions after a revocation     : " + port.regions.length);
' 2>/dev/null
```

```output
status after a fix             : {"state":"live"}
status after a 15 s gap        : {"state":"recovering"}
fixes after a stale fix        : 1
fixes after a live fix         : 2
status after the backoff       : {"state":"stalled"}
subs at stalled                : 1
status after a revocation      : {"state":"permission-denied","reason":"revoked-mid-session"}
subs after a revocation        : 0
regions after a revocation     : 0
```

The full acceptance suite — one failing test per reverted rule, including the proof that removing the generation check turns the stale-callback test red:

```sh
node --test --experimental-strip-types --test-reporter=spec "services/location/*.test.ts" 2>/dev/null | grep -E "^ℹ (tests|pass|fail)"
```

```output
ℹ tests 29
ℹ pass 29
ℹ fail 0
```

*(Re-captured 2026-09-25, G05.02.c: the same glob now also runs the six AC2 permission-split tests appended to `service.test.ts` — the count moved from 23 to 29 with zero failures; rule 11.)*
