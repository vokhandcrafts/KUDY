# Tramio — tour runtime (engine / pipeline / simulator / capability)

Scope: `packages/engine`, `packages/simulator`, `packages/capability`, plus `.kiro/specs/urban-narrative-mvp/{design,requirements,tasks}.md` and `HANDOFF.md`.
Legal: no code quoted. Identifier names and behaviour described in own prose.

## What it does

A GPS-triggered audio-tour runtime split into three layers with a hard purity boundary:

1. **Pure core** (`packages/engine`) — two pure functions and nothing else.
   - A *geofence pipeline* step function: raw OS fix in → either a rejection reason or an accepted (smoothed, route-projected) fix, plus optionally the id of one POI whose dwell condition just completed. Its state is a plain immutable value (route, geofences, last raw fix, smoothing window, per-POI dwell accumulators, consumed set).
   - A *reducer*: `(state, event, now, startConfig?) -> { state, commands[] }`. No I/O, no timers, no clock reads — `now` is a parameter with a `Date.now()` default, so tests and the simulator inject time.
2. **Effect/wiring layer** (outside my scope, `packages/ui/wiring`) — executes commands against expo-location / expo-speech / expo-audio and feeds native events back in as engine events.
3. **Simulator** (`packages/simulator`) — replays synthetic GPS traces through *the same* pipeline + reducer functions the app uses, with a deterministic model of timers and audio completion, and emits a machine-readable report + a content-readiness report.

### 1. The state machine

**States** (`TourState`, discriminated on `phase`): `Idle`, `Active`, `Standby`, `DeadReckoning`, `Deviation`, `Ended`.

Everything except `Idle`/`Ended` carries a `TourSession`: `bundle` (`bundleId` + `bundleVersion`), `geofences`, `consumed` (set of POI ids), optional `playing` (`segmentId`, `poiId`, `startedAtMs`), `lastAccepted` fix, `entitlements`, `deviationPending` flag, `currentLanguage`, `drDisabled` flag, optional `mediaCatalog`, and `focusLostAtMs` / `pausedOffsetMs`. `DeadReckoning` adds `enteredAtMs`; `Deviation` adds `detectedAtMs` and `promptVisible`; `Standby` adds an optional `standbyTrackId`; `Ended` carries only `endedAtMs`.

**Events** (`EngineEvent`): `LocationAccepted`, `LocationRejected` (reason: accuracy | spike | duplicate), `Timer` (id + firedAt), `EntitlementsChanged`, `UserCommand` (start | end | resume-route | switch-route | dismiss), `AudioFinished` (segmentId), `FocusLoss`, `FocusRegain`, `GeofenceEnter`, `GeofenceDwell`, `GeofenceExit`.
Note: `GeofenceEnter` and `GeofenceExit` are declared but the reducer ignores them — only `GeofenceDwell` fires content. `LocationRejected` is also accepted but not acted upon.

**Commands** (`EngineCommand`): `PlaySegment` (segmentId, source `audio`|`tts`, language, assetPath, optional sponsorship `preroll`), `RequestDecryptedSegment`, `StopAudio`, `PauseAudio`, `ResumeAudio(offsetMs)`, `RequestLocationMode` (mode: idle | standby | tour-bg | tour-approach | reconcile), `ScheduleTimer(id, afterMs)`, `CancelTimer(id)`, `ShowDeviationPrompt`, `HideDeviationPrompt`, `ReleaseAll`.

**Timer ids in use**: `dr-entry` (dead-reckoning entry, 15 s of no accepted fix — designed but never actually scheduled), `deviation-timeout` (5-minute auto-end from the deviation prompt), `release-timeout` (2 s, fixed).

**Transitions actually implemented:**
- `Idle` + `UserCommand('start')` *with a start config* → `Active`, emitting `RequestLocationMode('tour-bg')`. Without the config the start is silently ignored — a latent footgun.
- `Active`/`Standby`/`DeadReckoning` + `UserCommand('end')` → `Ended`. `Deviation` also ends on `switch-route`.
- `Ended` + `Timer('release-timeout')` → `Idle`. Nothing else is handled in `Ended`.
- `Active` + `Timer('dr-entry')` → `DeadReckoning` (+ `RequestLocationMode('reconcile')`), unless `drDisabled`.
- `DeadReckoning` + `LocationAccepted` → `Active` (+ `RequestLocationMode('tour-bg')`). That *is* the whole "reconcile".
- `Deviation` + `UserCommand('resume-route')` → `Active`, clearing `deviationPending`, emitting `HideDeviationPrompt` + `RequestLocationMode('tour-bg')`. The spec's 75 m re-entry corridor check is **not** implemented.
- `Standby` + `GeofenceDwell` → `Active` (stopping any standby track first).

**Tour end is a deliberate command burst**, in order: cancel `dr-entry`, cancel `deviation-timeout`, `StopAudio`, `ReleaseAll`, `RequestLocationMode('idle')`, `ScheduleTimer('release-timeout', 2000)`. Cancelling timers that today are never scheduled is intentional insurance: a stale timer from tour A firing into tour B would corrupt the next session.

**Firing a POI** (`GeofenceDwell` handler) is a guard ladder, in this order:
1. POI already in `consumed` → no-op (never replays).
2. `deviationPending` → no-op (content suppressed while off-route).
3. Something already `playing` → no-op (single-segment invariant; the trigger is *dropped*, not queued).
4. Overlap resolution by priority (below), adding losers to `consumed`.
5. Source selection, then `PlaySegment`, then `playing` is set.

**Audio completion feeds back** as `AudioFinished(segmentId)`. The reducer ignores it unless the id matches the currently playing segment (stale finishes from a previous segment are discarded). On a match it clears `playing` and adds the POI to `consumed`. So *consumption happens at end of playback, not at trigger* — the pipeline separately marks the POI consumed at fire time (see gotchas).

**Audio source selection** (`selectAudioSource`) is a 7-step fallback ladder: pre-rendered audio in selected language → TTS narrative in selected language → audio in bundle default language → TTS in default language → audio in *any* language → TTS in *any* language → explicit `unavailable`. The `unavailable` variant exists because an earlier version returned an empty path and produced silent failures. When no `mediaCatalog` is attached (demo/embedded route) the reducer skips the ladder entirely and emits TTS with a conventional segment id of the form poiId + ':' + language.

**Focus loss/regain**: `FocusLoss` records `focusLostAtMs` and emits `PauseAudio` only if something is playing. `FocusRegain` compares elapsed against a 10-minute constant: under 10 minutes → `ResumeAudio` (only if a segment is playing; offset is always sent as 0, the real offset lives on the native side); at or over 10 minutes → `StopAudio` + mark the POI consumed, on the reasoning that the vehicle has physically moved past the landmark and replaying it would be wrong.

### 2. Geofence / proximity pipeline

Five ordered stages, with a documented native/JS split: stages 1–2 are cheap predicates that can be lifted into native code, stages 3–5 stay in JS specifically so they remain property-testable.

1. **Accuracy gate** — reject any fix whose reported accuracy exceeds 50 m.
2. **Spike rejection** — with a strictly increasing timestamp, reject if implied speed over the great-circle distance exceeds 120 km/h. With a non-increasing timestamp (Android batches and reorders fixes), speed is undefined, so it instead rejects any displacement over 5 m — chosen because civilian GPS 95th-percentile error is ~3–5 m, so a bigger jump at zero elapsed time is a bogus almanac fix rather than jitter. Rejection leaves pipeline state untouched, so a bad fix cannot poison the smoothing window or the dwell clocks.
3. **Smoothing** — an equal-weight mean over the last 3 accepted raw coordinates. They deliberately chose an arithmetic mean over a recency-weighted EMA because a mean never overshoots the input range.
4. **Dwell accumulator** — candidates are geofences (circle or polygon) containing the *smoothed* point. Each candidate's accumulator grows by the gap since the last fix that saw it as a candidate; a POI that drops out of the candidate set simply is not carried forward, i.e. **the dwell clock resets to zero on any gap** — hysteresis is zero.
5. **Direction filter** — optional per-geofence `alongRoute` filter with a `toleranceDeg`; the reported heading must be within tolerance of the route tangent at the projection point. Absent filter → always passes. Filter present but no heading in the fix → never passes (fail-closed).

At most one POI fires per fix (the first candidate meeting dwell+direction wins the iteration).

**Already-played suppression is doubled up**: the pipeline short-circuits consumed POIs *before* stage 4, and the reducer re-checks consumed before firing. The pipeline's consumed set is not automatically synced from the reducer — the wiring layer (and, mirroring it, the simulator) must add the fired POI to the pipeline's consumed set and drop its dwell entry immediately after a fire, otherwise the same POI re-fires on every subsequent qualifying fix. This was a real bug, fixed identically in two places.

**Priority between competing triggers** (`resolveOverlappingTriggers`): at fire time, collect every non-consumed geofence containing the current smoothed point, sort by descending authored `priority`, tie-broken by ascending `authorIndex` (position in the authored POI array). The winner plays; every loser is added to `consumed` so it can never fire later. If the triggering POI is somehow not in the overlap set (position moved between dwell detection and reducer processing), it wins alone.

Notably the content rules forbid overlapping geofences entirely, because overlap makes the outcome depend on GPS noise — so this comparator is a safety net for authoring mistakes rather than a routine path.

**Focus loss** does not touch the pipeline at all; only playback is paused. **Focus regain** resumes playback but never rewinds position.

### 3. Route-state handling — real vs stub

| Concern | Status |
| --- | --- |
| On-route projection (`alongRouteM`, tangent) | **Real.** Used for direction filtering and reporting. |
| Consumed / single-fire / single-segment | **Real** and property-tested. |
| Focus loss/regain with 10-minute cutoff | **Real.** |
| `Deviation` state, prompt, 5-minute auto-end, POI suppression | **Half-real.** The state, the suppression flag, the resume transition and the timeout branch all exist — but *nothing ever enters `Deviation`*. The 150 m / 60 s classifier is not implemented, and the 75 m resume corridor check is not implemented. |
| `Standby` state | **Half-real.** Handlers exist for every event; the "speed under 3 km/h for 30 s" entry condition is not implemented, and no standby track is ever scheduled. `standbyTrackId` is threaded through purely as a placeholder. |
| `DeadReckoning` | **Skeleton.** Entry via a `dr-entry` timer that the reducer never schedules; no schedule-based position advance, no missed-POI reconciliation. `drDisabled` (GTFS feed older than 90 days) is wired but guards a path that never runs. |
| Missed points after a signal gap | **Not implemented.** Spec property 6 (play exactly the highest-priority deferrable missed POI on reconcile) has no code. |

The HANDOFF explicitly lists dead reckoning, standby scheduling, deviation classification and entitlement-aware filtering as deferred. So the shipped machine is really `Idle → Active → Ended` with focus handling — three of six states carry no reachable entry edge. Entitlements are stored but never consulted; `RequestDecryptedSegment` is defined and never emitted.

### 4. The simulator — the part that matters most for us

**Same code path, by construction.** The runner imports the production `step` and `reduce` and duplicates zero engine logic; it only supplies the things the app's wiring layer normally supplies (a clock, a timer queue, an audio player, a narrative text resolver).

**A trace** is a chronologically ordered array of plain JSON events, each with a wall-clock `atMs`: `GpsFix` (carrying a raw fix: timestamp, coordinate, accuracy, optional speed/heading), `AppBackground` / `AppForeground` (mapped to `FocusLoss` / `FocusRegain`), `UserCommand`, and fault injections `TtsUnavailable`, `TtsAvailable`, `AudioInterrupted`.

Traces are **generated, not hand-written**: interpolate along waypoints (normally the POI centres) at a configured speed and fix interval, then apply mutators. The generator set covers clean ride, dwell-at-each-stop, mid-route boarding, fast pass (high speed, no dwell), traffic stop, plus injectors for accuracy degradation over a window, an out-of-order timestamp spike, a location dropout (delete fixes in a window), and a focus interruption pair.

**Determinism mechanics.** A single pending-action queue holds scheduled timers and pending audio completions; each entry has a fire time plus a monotonically increasing insertion counter, and ties break on insertion order — so there is no `Date.now()`, no real timers, and no `Math.random()` anywhere in a run. Before each trace event, everything due earlier is drained in time order. `ScheduleTimer` / `CancelTimer` push and pop timers; `PlaySegment` schedules an audio completion whose duration comes from the narrative's word count at a configurable words-per-minute (150 by default, multiplied by 0.9 for memorial-register content); pre-rendered audio is approximated as a fixed 15 s; `StopAudio` drops pending audio; `PauseAudio`/`ResumeAudio` convert a completion into a remaining-duration and back.

Fault semantics are chosen carefully: a missing narrative or an unavailable TTS engine still schedules a near-immediate completion, because otherwise the engine would sit forever believing a segment is playing. An `AudioInterrupted` fault is mapped to `FocusLoss`, deliberately **not** to `AudioFinished` — treating an interruption as a completion would permanently consume a POI the rider never heard.

**Reports.** `SimulationReport` carries: total duration, accepted/rejected fix counts with a per-reason histogram, ordered `firedPois` and `consumedPois`, the full ordered command stream, a `stuckPlaying` boolean (a segment still playing at the end is an error), timers that never fired, warnings, errors, final phase, a per-POI `triggerDetails` list (fire time, finish time, modelled narration duration, trigger latency from geofence entry), and a human-readable timeline of tagged entries (`fix_accepted`, `fix_rejected`, `poi_fired`, `command`, `timer_fired`, `audio_finished`, `state_change`, `focus_loss`, `focus_regain`, `tour_start`, `tour_end`, `fault`).

A second, **content-oriented** report (`generateReadinessReport`) is independent of the state machine: per POI and per language it reports word count, estimated spoken duration, distance to the next POI, the time budget available before the next POI fires at an assumed bus speed, whether narration overruns that budget (overlap risk), missing translations, geofence radius vs distance to the nearest neighbour (physical overlap), memorial flags, and ordering anomalies.

The CLI stitches both together: run one dwell trace over all 24 authored POIs, print the timing table, then assert — all POIs fired, no duplicate fires, nothing stuck playing, no errors, final phase `Ended` or `Idle`, no missing narratives, no ordering anomalies — and exit non-zero on failure. That makes route content a CI-checkable artifact.

**Declared simulator boundary** (honest and important): it does not model the OS silently stopping location callbacks, does not model restart/recovery sequences, and does not model expo-location's internal retry behaviour. Those are covered separately with fake timers at the wiring layer.

### 5. The capability package

The rule it enforces: **the engine and the translators branch on boolean feature flags, never on `Platform.OS` or OS version**. Concretely a static `OS_MATRIX` maps (platform, OS version floor) to defaults for each flag, `probeCapabilities(platform, osVersion, nativeProbe?)` merges those defaults with optional real device answers (a native answer wins in *either* direction, so a weird Android image can report a feature missing despite a high API level), `defaultCapabilities()` returns an all-false conservative baseline for unknown platforms and early boot, and a single `dispatchByCapability` chokepoint picks the modern or fallback implementation. Every flag must carry a documented fallback path, introspectable at runtime.

The modelled flags: `regionMonitoringV2` (newer geofencing APIs), `liveActivities` (iOS lock-screen live activity), `foregroundServicePartialWakelock` (Android 14 foreground-service types), `isolatedAudioFocus`, `dynamicTypeXL` (accessibility text scaling), `secureEnclaveAvailable`, `strongBoxAvailable`, `aesNiAccel`. Roughly: background location reliability, lock-screen presence, audio focus behaviour, accessibility, and hardware-backed key storage for DRM.

The stated payoff is that a capability-based fallback path must preserve the same engine invariants as the modern path, so both can be tested with the same property suite.

## Design decisions worth copying

1. **Pure reducer + command list, time injected as a parameter.** This is the single highest-value idea in the repo. Because the core never reads a clock, never touches native modules and only emits data, an entire ride is reproducible on a laptop. For a solo dev who cannot walk Gdańsk after every change, this is the difference between testable and untestable.
2. **The simulator calls the production functions.** A simulator that reimplements the engine tests nothing. Enforce this by construction: the sim package imports the engine, and the engine has no dependency on it.
3. **The five-stage pipeline in this exact order** — accuracy gate, spike rejection, smoothing over ~3 fixes, dwell timer, optional direction filter — and rejecting *before* mutating state, so a bad fix cannot poison the smoothing window or dwell clocks. Copy verbatim in behaviour; 50 m accuracy and a plausible-speed cap are the right shape (KUDY should lower the speed cap: walking, not a bus — a few m/s, not 33).
4. **Dwell requirement on the smoothed point, not the raw one.** Prevents one noisy fix from firing a landmark you are 40 m away from.
5. **Monotonic consumed set with the "already played" check duplicated in both pipeline and reducer.** Belt and braces on the single behaviour users notice most: content replaying.
6. **Single-segment invariant.** Never overlap two narrations. Their choice to *drop* a competing trigger rather than queue it is defensible for a bus; for a walking tour it is more debatable (see open questions).
7. **Consumption on `AudioFinished`, and ignoring stale finish ids.** Prevents a late completion callback for a previous segment from wiping the current one.
8. **The 10-minute focus-loss rule.** Resume if you come back quickly; discard and consume if you do not, because the listener has physically walked past the subject. Cheap, and it removes a whole class of "narration about a building three blocks back" complaints.
9. **Interpreting an audio interruption (call, other app) as focus loss and never as completion.** Otherwise a phone call silently destroys a POI.
10. **Cancelling latent timers on tour end.** Cross-session timer leakage is a nasty, hard-to-reproduce class of bug; the fix costs two lines.
11. **The route-readiness report as a content CI gate**: per-POI spoken duration versus the travel time to the next POI, plus geofence-overlap detection. For a walking tour with POIs 150–300 m apart in Gdańsk's old town, "this narration is still talking when the next one fires" is *the* predictable content bug, and it is catchable without leaving the desk.
12. **The authoring rules learned the hard way** (from HANDOFF, content side but engine-adjacent): one idea per point; orientation by left/right rather than compass bearings; no two geofences may overlap; a distinct reduced-rate register for memorial content; and a human review gate with per-claim verdicts because AI-drafted narration produced confident, plausible, false statements. Gdańsk has heavy memorial content (Westerplatte, the Post Office, the shipyard) — the register rule is not optional there.
13. **Failing closed on the direction filter but shipping it disabled** until validated on a real walk. An untested filter silently suppresses *every* trigger; that is a total product failure that looks like "the app does nothing".
14. **Capability flags rather than OS-version checks** — worth copying as a mindset even at a much smaller scale, because you cannot test every device.

## Design decisions to reject (and why)

1. **Six states, three of them unreachable.** `Standby`, `DeadReckoning` and `Deviation` are fully typed, threaded through every handler, and never entered. They inflate every reducer branch and every test. KUDY should ship `Idle → Active → Ended` and add states only when a real behaviour demands one.
2. **Dead reckoning against a GTFS transit schedule.** It exists because a bus follows a timetable through a tunnel. A walker has no timetable. Drop the whole concept, along with `drDisabled` and the 90-day feed-age policy.
3. **Standby tracks** (ambient filler while the vehicle is stopped). A walker who stops is looking at something, not waiting for filler audio. Cut.
4. **The full deviation apparatus** (150 m / 60 s classification, prompt, 5-minute auto-end, resume corridor). Walking tours are inherently non-linear — a wanderer is not "deviating". At most, KUDY needs a passive "you are far from the route" hint. Note Tramio never implemented it either, which is itself evidence.
5. **The `RequestDecryptedSegment` / License_Token / per-pack AEAD content-protection design.** Ed25519-signed license tokens, hardware-backed key wrapping, cross-device unwrap failure, "no plaintext on disk" — this is a multi-month project defending audio files that a determined person can record from the speaker anyway. For paid IAP routes, ordinary platform receipt validation plus obscurity is the right risk trade. (This is a deliberate, scoped security trade-off: threat model is casual copying, not a motivated attacker; the asset is replayable audio with low per-unit value. If KUDY ever licenses third-party content with contractual DRM requirements, this decision must be revisited — that is the removal condition.)
6. **Custom native turbo modules for location/audio/TTS built and then not wired in.** Tramio wrote iOS and Android modules, then shipped on Expo modules anyway and left the native code as dead weight that crashes on import. Start on Expo modules and only go native against a specific, measured failure.
7. **`GeofenceEnter` / `GeofenceExit` events and `LocationRejected` in the reducer's alphabet, unhandled.** Dead alphabet entries invite a future contributor to assume they work.
8. **A self-hosted signed catalog backend, entitlement service, moderation snapshots, B2B sponsorship disclosure and tier ladders** for one city. For KUDY, static hosted files plus the store's own IAP is enough until there is a second city.
9. **25 formal correctness properties with fast-check over an unbuilt system.** The properties covering the reducer core (single-fire, at most one playing, dwell requirement, priority, focus timeout) earn their keep. The ones covering unimplemented DR/standby/deviation/crypto are speculation formalised.
10. **Priority plus `authorIndex` tie-breaking for overlapping geofences**, when the authoring rule already forbids overlap. Simply validate non-overlap at authoring time and, if two ever do overlap, take the nearer centre. One rule instead of two mechanisms.
11. **Spec-provenance comments (`@inferred`, requirement numbers, task numbers) on nearly every field.** Useful in a spec-driven multi-agent workflow, dead weight otherwise.

## Gotchas / platform realities discovered

- **Delivery is not the same as acceptance.** Their hardest field problem was the OS *silently stopping* location callbacks — not bad fixes, but no fixes. They added a watchdog distinguishing "any raw callback reached JS" from "a fix passed the gates", with states `acquiring → live → recovering → stalled` and bounded backoff (stall threshold 15 s, retries capped so no interval exceeds ~60 s). Recovery means tearing down and re-arming the watch (foreground) or stopping and restarting background updates, demoting to foreground if the background restart throws, and never tearing down a working foreground watch first. A generation counter invalidates callbacks from a previous tour. KUDY will hit this; a walking pace makes it worse, not better, because power-saving heuristics assume a stationary phone.
- **Background location is a permission cliff.** With background permission the fixes keep flowing (via an Android foreground-service notification) while pocketed; without it, everything pauses when the screen locks. Pocket-and-listen is the *primary* posture for an audio walking tour, so this is a product-defining constraint, not a detail.
- **Android batches and reorders fixes**, delivering equal or out-of-order timestamps. Any speed-based spike filter divides by zero or a negative number on those. Handle non-increasing timestamps with a displacement check instead.
- **iOS caps active monitored regions at 20.** Any route with more points needs a sliding window arming only the nearest few. Gdańsk old town will exceed 20 points easily. Their mitigation is to treat OS region events as *candidates* only and to do the real dwell/accuracy decision in JS.
- **Urban canyons wreck accuracy** — exactly Gdańsk's Długi Targ, narrow streets with tall facades. This is the argument for smoothing plus dwell rather than trusting a single fix.
- **Keep-awake was applied foreground-only**, deliberately: holding a wakelock through a whole tour destroys the battery.
- **Loudness mismatch between pre-rendered audio and TTS** is a real, jarring artefact; the mitigation is normalising pre-rendered assets to a target loudness (they cite −16 LUFS) and gain-matching TTS.
- **A one-directional route is one product.** The southbound version of the same bus line inverts every "on your left" cue and must be a separate content bundle. The walking analogue: a loop walked backwards is a different tour.
- **Straight-line interpolation between points is acceptable for along-route projection** and for a preview sketch, but it is not real geometry. For walking in an old town, corner-cutting straight lines will project badly; real path geometry matters more for KUDY than it did for them.
- **AI-drafted narration produced confident, plausible, false claims** that passed a model confidence check and failed trivial local knowledge (a misattributed wall, an invented construction project, an inverted material history). A human review gate with per-claim verdicts and source URLs, and a build that refuses unreviewed or refuted content, is the correct response. Gdańsk's history is contested and memorial-heavy; this risk is higher, not lower.
- **An untested filter can silently suppress everything.** Their direction filter is written, tested, and left switched off in content until a real ride validates the tolerance. Adopt the same discipline for any new gate.
- **A single missed sync causes infinite replay.** The pipeline's consumed set and the reducer's consumed set are separate; forgetting to update the pipeline's after a fire makes the same POI fire on every subsequent fix. If KUDY keeps two layers, keep one owner of "consumed" or write the test that catches this.

## Open questions (for KUDY's own spec)

1. **Drop or queue a trigger that arrives while audio is playing?** Tramio drops it permanently (marks nothing, simply ignores the dwell; the POI can fire later since it is not consumed — but only if the walker dwells again). On a bus, dropping is right: you have passed the thing. Walking, a short queue with a staleness cutoff (play if still within N metres) is probably better. This needs an explicit decision, because it changes the consumed-set semantics.
2. **Dwell time and geofence radius for walking.** Their 3 s dwell and bus-scale radii do not transfer. Walking at ~1.4 m/s through a 30 m radius gives ~20 s inside — a longer dwell is affordable and reduces false fires, but too long and the walker has already left. Calibrate on one real Gdańsk walk, then freeze.
3. **Zero hysteresis on the dwell clock.** One dropped fix at the edge of a circle resets the accumulator to zero. Should a short grace period be kept before resetting?
4. **Does KUDY need a route projection at all?** `alongRouteM` exists mainly to serve the direction filter and dead reckoning. If both are cut, ordering by "nearest unplayed point" may be enough — but progress display and "you skipped a point" hints probably want it.
5. **What happens when the walker plays a point out of order, or walks the route backwards?** Tramio never faces this. KUDY must decide whether points are strictly ordered, loosely ordered, or a free set.
6. **How does an interrupted tour resume the next day?** The consumed set lives only in in-memory session state; nothing here persists it. A walking tour is far more likely to be paused and resumed than a bus ride.
7. **Pre-rendered audio versus TTS.** Their fallback ladder assumes both may exist. For a paid product, pre-rendered voice is close to mandatory; the ladder then collapses to "play the file, or report the content as unavailable". Decide before building a media catalog.
8. **What replaces the review gate?** The gate is load-bearing for factual safety and its authoring package is out of my scope, but KUDY needs *some* enforced step between an LLM draft and a shipped memorial narration.
9. **Simulator inputs.** Do we generate traces from the authored point list (their approach, sufficient for CI), or record one real GPS walk per route and replay it (higher fidelity, catches urban-canyon behaviour)? Recommendation: both — generated traces for every commit, one recorded walk per route as a regression fixture.

## Verdict

**Reimplement (small, high leverage — roughly a week's work for one person with LLM help):**
- The pure reducer with an explicit state value, an event union, a command list, and time passed in as an argument. States: `Idle`, `Active`, `Ended`. Nothing more until proven necessary.
- The five-stage pipeline, retuned for walking: accuracy gate, plausible-speed spike rejection (walking scale, with the zero-elapsed-time displacement variant for Android), smoothing over ~3 fixes, dwell on the smoothed point, and direction filtering only if a real walk proves it necessary.
- The consumed set, the single-segment invariant, and consumption on audio completion with stale-id rejection.
- Focus loss/regain with a time-bounded resume, and treating external interruption as focus loss rather than completion.
- The simulator: trace type, generators, deterministic timer/audio-completion queue, and a report with fired points, command stream, stuck-playing check and per-point timing. This is non-negotiable for a solo dev in a city they cannot re-walk on demand.
- The route-readiness report: spoken duration versus travel time to the next point, and geofence-overlap detection. Cheap, and it catches the most likely content bug.
- The delivery watchdog concept (fixes stopping arriving is a distinct failure from bad fixes) — as a small wiring-layer piece, not an engine state.
- The privacy discipline of the field diagnostics recorder: bucketed accuracy, elapsed-relative times, no coordinates, no identifiers, no free-form strings. This is a genuine security/privacy property, keeps the diagnostics feature outside GDPR-sensitive territory by construction, and costs nothing to adopt up front — retro-fitting it later is much harder.

**Over-engineered for a one-city walking MVP — skip:**
- Dead reckoning and GTFS anything. Walkers have no timetable.
- Standby tracks and standby-state machinery.
- Route-deviation classification, prompts, corridors and auto-end.
- Cryptographic content protection: license tokens, key wrapping, encrypted packs, `RequestDecryptedSegment`, tamper detection. (Explicit accepted trade-off; revisit only if third-party licensed content imposes DRM obligations.)
- Entitlement tiers, B2B sponsorship, disclosure pre-rolls, moderation snapshots.
- A self-hosted signed catalog/entitlement backend. Static signed-URL content plus store IAP.
- Custom native location/audio/TTS modules. Expo modules until a measured failure forces otherwise.
- A capability matrix package. Two or three inline runtime checks (background permission granted, TTS voice present) beat an eight-flag matrix with a probe layer and a dispatch chokepoint. Keep only the *principle*: check for the feature, not the OS version.
- Formal property suites over unbuilt subsystems. Keep property tests for the four invariants that actually hold — never replay a point, never two at once, never fire before dwell, resume only inside the time bound.

**Structural verdict:** Tramio's core insight — a pure, clock-injected reducer that a deterministic simulator can drive through the exact production code path — is worth copying wholesale. Nearly everything wrapped around it is a solo developer building the enterprise version of a product that does not exist yet: three unreachable states, an unwired native layer, a DRM scheme, a backend, and a capability matrix, all in service of one demo bus route. KUDY should take the spine and leave the scaffolding.
