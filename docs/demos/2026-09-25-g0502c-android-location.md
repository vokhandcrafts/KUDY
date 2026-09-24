# G05.02.c — Android location adapter: the permission split, the pure OS mapping, the app-config contract

*Showboat demo for issue #212 (`services/location`), created 2026-09-25.*

<!-- showboat-id: g0502c-android-location -->

The expo-location adapter itself is device-bound (its file is the only runtime expo importer and node never imports it); the host proof drives the pure layers it delegates to. Synthetic fixture values only — the explanation strings below are the real app config texts, the coordinates are synthetic.

AC2 — every transition into an armed mode asks exactly one question: the city surface asks foreground, the Start path (including the carry-over from the city surface, with the one subscription never restarted) asks background, carrying the app-config explanation; disarmed transitions ask nothing:

```sh
node --experimental-strip-types -e '
const { LocationService } = await import("./services/location/service.ts");
const { FakeLocationOsPort } = await import("./services/location/fake-port.ts");
const { readFileSync } = await import("node:fs");
const appConfig = JSON.parse(readFileSync("./app.json", "utf8"));
const explanations = appConfig.expo.extra.locationExplanations;
const port = new FakeLocationOsPort();
const clock = { now: () => 0, schedule: () => () => {} };
const service = new LocationService({ port, clock, permissions: explanations });
const asks = () => port.permissionRequests.map((r) => r.scope + " «" + r.explanation.slice(0, 24) + "…»");
service.setMode("city-surface");
console.log("city-surface asks     : " + JSON.stringify(asks()));
service.setMode("active-guide");
console.log("+ Start path asks     : " + JSON.stringify(asks()));
console.log("startFixes so far     : " + JSON.stringify(port.commands));
service.setMode("paused");
service.setMode("idle");
console.log("asks after paused/idle: " + JSON.stringify(asks()));
' 2>/dev/null
```

```output
city-surface asks     : ["foreground «KUDY uses your location …»"]
+ Start path asks     : ["foreground «KUDY uses your location …»","background «During an active walk KU…»"]
startFixes so far     : ["start 1"]
asks after paused/idle: ["foreground «KUDY uses your location …»","background «During an active walk KU…»"]
```

AC1 — the pure OS-fix mapping reuses the pipeline's own shape checks (one spelling): every malformed OS location is rejected with a named reason and never passed on; a missing accuracy (Android reports it as null) is rejected `missing-accuracy`, never mapped to 0 — that is the task card's proof scenario, and the revert experiment (mapping it to 0) turned the proof test red in this session:

```sh
node --experimental-strip-types -e '
const { mapOsLocationToFix } = await import("./services/location/expo/fix-mapping.ts");
const show = (label, location) => {
  const r = mapOsLocationToFix(location);
  console.log(label.padEnd(22) + ": " + (r.ok ? "accepted accuracy=" + r.fix.accuracy : "rejected " + r.reason));
};
show("a well-formed fix", { coords: { latitude: 54.4, longitude: 18.65, accuracy: 12 }, timestamp: 1000 });
show("accuracy missing (null)", { coords: { latitude: 54.4, longitude: 18.65, accuracy: null }, timestamp: 1000 });
show("accuracy NaN", { coords: { latitude: 54.4, longitude: 18.65, accuracy: Number.NaN }, timestamp: 1000 });
show("accuracy -1", { coords: { latitude: 54.4, longitude: 18.65, accuracy: -1 }, timestamp: 1000 });
show("lat 90.0001", { coords: { latitude: 90.0001, longitude: 18.65, accuracy: 5 }, timestamp: 1000 });
show("lng Infinity", { coords: { latitude: 54.4, longitude: Number.POSITIVE_INFINITY, accuracy: 5 }, timestamp: 1000 });
show("timestamp NaN", { coords: { latitude: 54.4, longitude: 18.65, accuracy: 5 }, timestamp: Number.NaN });
' 2>/dev/null
```

```output
a well-formed fix     : accepted accuracy=12
accuracy missing (null): rejected missing-accuracy
accuracy NaN          : rejected missing-accuracy
accuracy -1           : rejected negative-accuracy
lat 90.0001           : rejected latitude-out-of-range
lng Infinity          : rejected non-finite-coordinate
timestamp NaN         : rejected non-finite-timestamp
```

The app-config contract (AC2/AC3): the explanation strings and the foreground-service notification text are read from the real app.json `expo.extra` — a missing or empty entry fails fast with a named error, never a default string:

```sh
node --experimental-strip-types -e '
const { readFileSync } = await import("node:fs");
const { locationExtrasFromConfig } = await import("./services/location/expo/location-config.ts");
const appConfig = JSON.parse(readFileSync("./app.json", "utf8"));
const extras = locationExtrasFromConfig(appConfig.expo);
console.log("foreground explanation : " + extras.locationExplanations.foreground.length + " chars");
console.log("background explanation : " + extras.locationExplanations.background.length + " chars");
console.log("notification title     : " + extras.locationForegroundService.notificationTitle);
try { locationExtrasFromConfig({}); } catch (error) { console.log("empty config           : " + error.message); }
' 2>/dev/null
```

```output
foreground explanation : 111 chars
background explanation : 154 chars
notification title     : KUDY walk in progress
empty config           : location adapter: app.json expo.extra.locationExplanations.foreground is missing or empty
```

The full services/location suite — service acceptance (G05.02.b) plus the permission split and the pure mappings (G05.02.c):

```sh
node --test --experimental-strip-types "services/location/**/*.test.ts" 2>/dev/null | grep -E "^ℹ (tests|pass|fail)"
```

```output
ℹ tests 43
ℹ pass 43
ℹ fail 0
```

Not host-provable here and deliberately not claimed: the device behaviour of the adapter (background updates, the foreground-service notification on screen, the permission dialogs) — every such cell is listed `not-run` with its steps in `docs/agent-tasks/results/G05.02.c.md`, per the founder decision of 2026-09-23 recorded in the issue.
