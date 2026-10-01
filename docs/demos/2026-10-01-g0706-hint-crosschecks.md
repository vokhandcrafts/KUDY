# G07.06 — скразныя праверкі падказак (межа фічы)

*Showboat demo for issue #287 (G07.06 — скразныя праверкі R07-падказак над зрошчанай праводкай G07.05, PR #437), created 2026-10-01.*

Сцэнар на рэальным прадакшн-кодзе (`controllers/useNearbyController.ts` + сапраўдныя `services/location`, `services/audio`, `services/db` над фейкавымі OS-портамі, кананічны `contracts/hints/guide-hints.values.v1.json`, сапраўдная транзакцыя Start `startSession`):

1. **Два гіды ў адной зоне — адна агульная картка:** dwell завяршаецца з адным гідам; чалавек праходзіць кветар бліжэй — другі далучаецца да тае самай карткі: та ж `suggestion_id`, **адна** падзея `guide_nearby_shown`, два durable-радкі, абодва ў carry.
2. **Адышоў падчас аўдыё:** картка гатовая → аўдыё гучыць (цішыня) → чалавек сышоў з зоны → аўдыё скончылася: свежы фікс пераправярае блізкасць — карткі няма і больш не з'яўляецца.
3. **dismiss → restart:** адхіленне трымаецца ў sqlite; новы кантролер над той самай базай (эмулы_restart працэсу) праходзіць поўны dwell — картка не вяртаецца.
4. **Start carry перажывае cooldown:** паказ+адхіленне ў foreground-вокне → сапраўдны Start з carry → праз 2 гадзіны (cooldown 3600 с сышоў) адноўленая сесія ўсё яшчэ трыма перанесеныя гіды цішымі, а ніколі не паказаны гід паказваецца.
5. **Камерцыйны дыялог:** пакуль дыялог адкрыты, картка ціхая; закрыццё дыялогу + свежы фікс — картка гатовая.

(`export LD_LIBRARY_PATH` — хоставае патрабаванне node, не частка змены.)

```sh
export LD_LIBRARY_PATH=$HOME/.local/lib
node --experimental-strip-types --input-type=module -e '
import { pathToFileURL } from "node:url";
const { FakeAudioPlayerPort } = await import(pathToFileURL("services/audio/fake-port.ts"));
const { AudioService } = await import(pathToFileURL("services/audio/service.ts"));
const { FakeLocationOsPort } = await import(pathToFileURL("services/location/fake-port.ts"));
const { LocationService } = await import(pathToFileURL("services/location/service.ts"));
const { listGuidesInHintCooldown, openDatabase, recordGuideHintDismissed, recordGuideHintShown, startSession } = await import(pathToFileURL("services/db/db.ts"));
const { nodeSqliteDriver } = await import(pathToFileURL("services/db/test-fixture.ts"));
const { loadGuideHintValues } = await import(pathToFileURL("services/config.ts"));
const { createNearbyHintController } = await import(pathToFileURL("controllers/useNearbyController.ts"));

const VALUES = loadGuideHintValues();
const offer = (routeId) => ({
  offer_id: `offer-${routeId}`, kind: "guide", route_id: routeId, place_id: null,
  editorial_order: 0, title: `Гід ${routeId}`, summary: null, distance_m: null,
  text_locales: ["be"], audio_locales: ["be"], access: "free", estimated_duration: null,
});
const HERE = { lat: 54.4, lng: 18.6 };
const FAR = { lat: 54.4 + 0.006, lng: 18.6 };

// One db per scenario — `driver` is passed in when a restart must see the
// same sqlite the previous controller wrote.
function world({ driver, points, dialog } = {}) {
  const db = driver ?? nodeSqliteDriver();
  openDatabase(db);
  const clock = { nowMs: 0 };
  const locationPort = new FakeLocationOsPort();
  const location = new LocationService({ port: locationPort, clock: { now: () => clock.nowMs, schedule: () => () => {} }, permissions: { foreground: "fg", background: "bg" } });
  location.setMode("city-surface");
  const audioPort = new FakeAudioPlayerPort();
  const audio = new AudioService({ createPort: () => audioPort });
  const runRef = { current: { phase: "Idle" } };
  const runSource = { get run() { return runRef.current; }, subscribe: () => () => {} };
  const foregroundRef = { current: true };
  const events = [];
  const binding = createNearbyHintController({
    location, audio,
    catalog: { loadNearby: async () => ({ kind: "ready", offers: [...new Set(points.map((p) => p.guideId))].map(offer), degraded: null }) },
    store: {
      recordShown: (input) => recordGuideHintShown(db, { guideIds: input.guideIds, scope: input.context === "active" ? "session" : "foreground", sessionId: input.sessionId ?? undefined, at: input.at }),
      recordDismissed: (input) => recordGuideHintDismissed(db, { guideIds: input.guideIds, scope: input.context === "active" ? "session" : "foreground", sessionId: input.sessionId ?? undefined, at: input.at }),
      sessionShown: (sessionId) => db.prepare("SELECT guide_id FROM guide_hint_state WHERE scope = '"'"'session'"'"' AND session_id = ?").all(sessionId).map((row) => row.guide_id),
      cooldownBlocked: (nowMs, cooldownMs) => listGuidesInHintCooldown(db, nowMs, cooldownMs),
    },
    points: () => points,
    values: VALUES,
    liveRun: () => runSource,
    foreground: () => foregroundRef.current,
    commercialDialogUp: dialog ? () => dialog.current : undefined,
    telemetry: { record: (event) => events.push(event) },
    now: () => clock.nowMs,
  });
  const sub = Number(locationPort.commands.find((c) => c.startsWith("start ")).slice("start ".length));
  const emitFix = (lat = HERE.lat, lng = HERE.lng, accuracy = 10) => locationPort.emitFix(sub, { lat, lng, accuracy, at: clock.nowMs });
  const state = () => {
    const st = binding.store.getState();
    return st.kind === "ready"
      ? `ready [${st.guides.map((g) => g.title).join("; ")}]`
      : st.kind === "hidden" ? `hidden (${st.reason})` : "absent";
  };
  return { clock, binding, emitFix, state, db, events, runRef, audio, audioPort };
}

const dwell = async (w) => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  w.emitFix();
  w.clock.nowMs += 21_000;
  w.emitFix();
};

// 1 — two guides, one card, one shown episode
const w1 = world({ points: [{ guideId: "route-a", lat: HERE.lat, lng: HERE.lng }, { guideId: "route-b", lat: HERE.lat + 0.003, lng: HERE.lng }] });
await dwell(w1);
console.log(`dwell done:            ${w1.state()}`);
w1.clock.nowMs += 9_000;
w1.emitFix(HERE.lat + 0.001);
console.log(`one block closer:      ${w1.state()}`);
console.log(`                       rows=${w1.db.prepare("SELECT COUNT(*) AS n FROM guide_hint_state").all()[0].n}, shown events=${w1.events.length}, carry=[${w1.binding.foregroundCarry().join(", ")}]`);

// 2 — walked away during audio
const w2 = world({ points: [{ guideId: "route-a", lat: HERE.lat, lng: HERE.lng }] });
await dwell(w2);
console.log(`\ndwell done:            ${w2.state()}`);
await w2.audio.play({ token: { kind: "moment", ref: "m1", seq: 1 }, path: "bundles/x/audio/story.m4a" });
w2.audioPort.snapshotValue = { state: "playing", positionMs: 0, durationMs: 30_000 };
w2.clock.nowMs += 4_000;
w2.emitFix(FAR.lat, FAR.lng);
console.log(`away, audio playing:   ${w2.state()}`);
w2.audio.stop();
w2.audioPort.snapshotValue = { state: "idle", positionMs: 0, durationMs: 0 };
w2.clock.nowMs += 1_000;
w2.emitFix(FAR.lat, FAR.lng);
console.log(`audio over, still away: ${w2.state()}`);
w2.clock.nowMs += 30_000;
w2.emitFix(FAR.lat, FAR.lng);
console.log(`fresh fix, still away:  ${w2.state()}`);

// 3 — dismiss, then a restart over the same database
const db3 = nodeSqliteDriver();
const w3a = world({ driver: db3, points: [{ guideId: "route-a", lat: HERE.lat, lng: HERE.lng }] });
await dwell(w3a);
w3a.binding.dismiss();
console.log(`\ndismissed:             ${w3a.state()}`);
const w3b = world({ driver: db3, points: [{ guideId: "route-a", lat: HERE.lat, lng: HERE.lng }] });
await dwell(w3b);
console.log(`restarted, full dwell: ${w3b.state()} — the durable dismissal holds`);

// 4 — the Start carry outlives the cooldown
const db4 = nodeSqliteDriver();
const w4a = world({ driver: db4, points: [{ guideId: "route-a", lat: HERE.lat, lng: HERE.lng }] });
await dwell(w4a);
w4a.binding.dismiss();
startSession(db4, { sessionId: "walk-1", routeId: "route-selected", version: "1", locale: "be", tier: ["base"], startedAt: w4a.clock.nowMs, carryGuideHints: w4a.binding.foregroundCarry() });
const w4b = world({ driver: db4, points: [{ guideId: "route-a", lat: HERE.lat, lng: HERE.lng }, { guideId: "route-other", lat: HERE.lat + 0.001, lng: HERE.lng }] });
await new Promise((resolve) => setTimeout(resolve, 0));
w4b.runRef.current = { phase: "Active", sessionId: "walk-1", routeId: "route-selected", autoplaySuspended: false, focusLostAt: null, playing: null };
w4b.clock.nowMs += 2 * VALUES.foreground_cooldown_s * 1000;
w4b.emitFix();
w4b.clock.nowMs += 21_000;
w4b.emitFix();
console.log(`\n2h later, in session:  ${w4b.state()} — carried guide quiet, the new one shows`);

// 5 — the commercial dialog keeps the card quiet
const dialog = { current: true };
const w5 = world({ points: [{ guideId: "route-a", lat: HERE.lat, lng: HERE.lng }], dialog });
await dwell(w5);
console.log(`\ndwell done, dialog up: ${w5.state()}`);
dialog.current = false;
w5.clock.nowMs += 5_000;
w5.emitFix();
console.log(`dialog closed, fresh:  ${w5.state()}`);
' 2>/dev/null
```

```output
dwell done:            ready [Гід route-a]
one block closer:      ready [Гід route-a; Гід route-b]
                       rows=2, shown events=1, carry=[route-a, route-b]

dwell done:            ready [Гід route-a]
away, audio playing:   hidden (quiet)
audio over, still away: hidden (no-candidates)
fresh fix, still away:  hidden (no-candidates)

dismissed:             hidden (limited)
restarted, full dwell: hidden (limited) — the durable dismissal holds

2h later, in session:  ready [Гід route-other] — carried guide quiet, the new one shows

dwell done, dialog up: hidden (quiet)
dialog closed, fresh:  ready [Гід route-a]
```

Крытэры 1–6 з issue #287 — сюіта скразных праверак у `controllers/useNearbyController.test.ts` (секцыя G07.06); гард камерцыйнага дыялогу — змена кантролера гэтай задачы, revert робіць адпаведны тэст чырвоным (эксперымент праведзены ў сесіі адпраўкі).

```sh
export LD_LIBRARY_PATH=$HOME/.local/lib
node --experimental-strip-types --test controllers/useNearbyController.test.ts services/db/db.test.ts services/location/service.test.ts services/config.test.ts controllers/run/runSurfaceController.test.ts 2>&1 | grep -E "^ℹ (tests|pass|fail)"
command npx jest app/hint-card.test.tsx 2>&1 | grep -E "^Tests:"
```

```output
ℹ tests 95
ℹ pass 95
ℹ fail 0
Tests:       3 passed, 3 total
```
