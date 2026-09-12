# Reference analysis — TourForge Baseline (Flutter GPS tour app)

Repo: `/tmp/kudy-ref/tourforge` — **no LICENSE file present**. Treat as look-but-don't-touch: no code, no type definitions, no config JSON copied. Everything below is described behaviour and design rationale in my own words.

Two Dart packages: `tourforge_baseline` (the reusable library, root `lib/`) and `tourforge_baseline_app` (`app/`, a thin white-label shell that only supplies app name, description, theme, and a config URL). The library also ships a **custom native plugin** (Kotlin + Swift) that embeds MapLibre Native as a platform view.

---

## What it does

**Product shape.** A rebrandable, one-org-per-fork GPS tour guide. The fork owner points the app at a content URL; the app downloads a tour catalogue, lets the user download a whole tour for offline use, then runs a full-screen "navigation" experience where walking/driving into a stop's radius auto-plays its narration.

**Screens (complete list).**
- `Home` — a single scrolling list. An explanatory card ("Tours"), then one large card per tour: cover image, title, and a metadata row (download affordance, walking-vs-driving icon, stop count). No search, no filters, no categories, no map on home. Long-pressing a tour card offers "delete downloaded content" — that is the entire storage-management UI.
- `TourDetails` — collapsing image header with gallery, description, a "Tour Stops" list, and arbitrary external links. The header hosts one primary action button whose identity is state-dependent: **Download** when assets are missing, **Start** when everything is on disk. A warning banner appears while not downloaded, explaining you can browse but not run.
- `WaypointDetails` / `PoiDetails` — read-only detail pages for a stop or a point of interest.
- `DisclaimerScreen` — a mandatory modal between "Start" and the running tour, warning about traffic/surroundings. Pushed as a popup route; "I understand" replaces it with the navigation screen.
- `NavigationScreen` — the running tour. Full-bleed map, a bottom audio panel, a drag-up drawer listing all stops, floating buttons for satellite toggle, recenter ("map controlledness"), help, and (debug builds only) fake GPS.
- `HelpSlidesScreen` — reusable slide deck. Shown once per context, gated by keys `onboarding`, `tour_details`, `navigation`.
- `About` — app description plus OSS license list, reachable from an overflow menu on Home.

**Navigation model.** Plain imperative navigator pushes, no router, no tabs, no deep links. Total depth: Home → TourDetails → Disclaimer → NavigationScreen → (Waypoint/POI details on top).

**Comparison to KUDY's IA.** TourForge has no tab bar at all — its "Explore" is a flat list, it has **no city-level map** (the map exists only inside a running tour), and "My KUDY" is reduced to a long-press delete dialog. Their model is *catalogue → tour → run*. KUDY is richer on both ends: a curated Explore and a real My KUDY. But note what TourForge got right by omission: **the map is a mode, not a tab.** KUDY has since adopted exactly that — two tabs (Explore / My KUDY) plus a city mode that is "Nearby" before a route and `Run` during one (see `11_run_interaction.md`). The earlier three-tab plan is superseded: putting "browse map" and "run tour" behind one tab is precisely where it would have got muddled.

---

## Content model

**Source of truth: a remote static site. There is no API and no CMS in the app.**

The chain is deliberately indirect:
1. The app is configured with a `baseUrl`, plus a boolean saying that URL is *indirect*.
2. If indirect, the app fetches that URL first and reads a `baseUrl` field out of the JSON response — i.e. the shipped binary points at a **redirect document**, so content can be relocated (new CDN, new bucket) without an app update. This fetch retries forever with backoff before the app can start.
3. The real base URL then hosts a single index document, `tourforge.json`, plus a flat pile of content-addressed asset files.

**Index shape (fields, described).** The index has two top-level parts: an `assets` map and a `tours` array.
- `assets` maps a human-readable asset *name* to a record of `alt` text, `attrib` (attribution string), `type`, and `hash`. The **hash is the filename on the CDN and on disk** — everything is content-addressed, so a changed audio file is a new file, and caching is trivially correct with zero cache-invalidation logic.
- A tour carries: `id`, `title`, `desc`, `route` (array), `gallery` (asset names), `pois` (array), `path` (route geometry), `tiles` (optional asset name), `links` (label → href map), `type` (the string `"driving"` or `"walking"`, used purely for an icon and a label).

**Stops.** The `route` array is heterogeneous: entries have a `type`, and the app keeps **only** entries typed `"stop"`, discarding the rest. The discarded entries are almost certainly routing control points used by the authoring tool to shape the drawn line. So one authored array serves two purposes: ordered narration stops *and* geometry hints.
- A stop has `title`, `desc`, `lat`, `lng`, `trigger_radius` (metres, **per stop**, not a global constant), `narration` (optional asset name), `transcript` (optional text), `gallery` (asset names), `links`.
- **Ordering is array order, full stop.** There is no sequence number, no prerequisite, no "must visit stop 3 before 4". Index-in-array is the stop's identity throughout the app — it is what the audio controller, the drawer, and the map markers all pass around.
- **Optional content is expressed by nullability, not by flags**: no narration → the stop is a silent map pin with text; no transcript → no transcript UI.

**POIs** are a second, unordered class of place: name, description, position, gallery, links — but crucially **no trigger radius and no narration**. They never fire. They are scenery: "there's a good café here". This is a genuinely useful distinction — *things that talk to you* vs *things that are just on the map*.

**Route geometry** is a single **encoded polyline string** (Google's polyline encoding, decoded via `maps_toolkit`), not a GeoJSON LineString array. For a long city walk this is several times smaller in the index and decodes in one pass.

**Asset references** are lazily resolved: a tour holds asset *names*, which resolve through the assets map to a hash, which resolves to a local file path under app support storage. Every asset object also carries a `required` flag — non-required assets are allowed to fail their download without failing the tour.

---

## GPS and triggering

**Acquisition.** The `geolocator` position stream, with **default settings** — no accuracy tier chosen, no distance filter, no interval, no Android foreground-service notification configured. The stream is mapped down to bare lat/lng, throwing away accuracy, speed, heading, and timestamp. It is started only when the navigation screen mounts and cancelled on unmount.

**Permission flow** is a hand-rolled sequence: check that location services are on (else an explanatory dialog), request permission, and if denied **immediately request a second time** before showing the "denied" dialog. There is a real bug here worth learning from: the function returns success even in the permanently-denied branch, so the caller proceeds to subscribe to a stream that will never emit.

**Triggering is entirely their own distance math. No OS geofencing anywhere.**
The controller is deliberately tiny:
- On every position update, short-circuit if the coordinate is identical to the previous one (returns the cached answer).
- Otherwise compute the distance from the user to **every** stop in the tour, keep those inside their own `trigger_radius`, and return the **nearest** one. If none qualify, return null.
- Distance is `latlong2`'s default (Haversine on a sphere), which is fine at city scale.

**How a trigger becomes audio.** Three separate observable values chained by listeners: current location → controller tick → *current waypoint index* → narration controller plays that index. The current-waypoint model is a plain notifier holding a nullable integer.

**The important behavioural subtleties:**
- A null result (you walked out of every radius) is stored inside the controller, but the screen **ignores nulls** when updating the current-waypoint model. Net effect: leaving a stop does not stop the audio and does not clear the panel. Narration finishes on its own. This is the right call for a walking tour — you keep walking while it talks — and it is achieved with one null check rather than a state machine.
- Because the controller re-derives the nearest stop from scratch each tick and only the *change* of index triggers playback, re-entering the same radius does not restart the narration, but leaving and re-entering after visiting another stop **will** replay it.
- There is **no visited/completed set, no progress persistence, no resume.** Kill the app mid-tour and you restart at nothing. This is a real product gap, not a simplification.
- Everything is O(stops) per fix. At tens of stops per tour that's free.

**Background / killed behaviour.** This is the weakest area, and it is instructive:
- There is **no app-lifecycle observer anywhere** in the library. Nothing reacts to backgrounding.
- The screen is kept awake for the entire tour via `wakelock_plus`, enabled when the map mounts and disabled when it unmounts. The design assumption is plainly *"the phone stays on and in the user's hand"*.
- Audio is a proper background/lock-screen citizen (see below), but **location is not**: with a plain foreground position stream and no background-location permission or foreground service, a locked/backgrounded phone will stop delivering fixes, so **triggering effectively pauses when the screen is off**. Audio already playing continues; new stops will not fire.
- Leaving the navigation screen cancels the location stream and resets the audio controller, so the tour genuinely ends rather than lingering.

---

## Offline

**Model: all-or-nothing, per tour, up front.** A tour cannot be started until every *required* asset is on disk. The Start button literally does not exist until a completeness check passes.

- **What's downloaded:** the tour's cover gallery, every stop's gallery and narration audio, every POI's gallery, and — optionally — a per-tour **map tile bundle** (`.mbtiles`).
- **When:** on explicit user tap on Download. The index itself is re-fetched on every app launch, with a nice degradation rule: if a previous copy exists, the refresh gets a bounded retry count and failure is swallowed (offline launch works); if no copy exists, failure is fatal.
- **Where:** a flat directory under the platform application-support directory, one file per content hash. No database, no manifest file, no metadata table — the index *is* the manifest, and the filesystem *is* the cache.
- **How:** downloads stream to a `.part` file and are atomically renamed on success, so a killed download can never masquerade as a complete asset. Retries use exponential backoff with a random jitter multiplier (explicitly to avoid thundering-herd when many assets fail at once). In-flight downloads are deduplicated by asset id, so two screens asking for the same image share one request. Progress is aggregated across a batch into a single byte-total/byte-done pair driving one progress bar.
- **Deletion is a garbage collector, not a delete button.** The GC re-parses the index, computes the set of referenced hashes, lists the storage directory, and deletes anything unreferenced. "Delete this tour" is implemented by running the GC with that tour *excluded* from the reachable set. It runs at app start too. Errors during deletion are logged and skipped rather than aborting the sweep. This is genuinely elegant: one mechanism handles orphan cleanup after a content update *and* user-initiated deletion.

**Maps and tiles.** Vector maps end to end:
- Renderer: **MapLibre Native**, embedded through their **own Flutter platform-view plugin** (Android view + Kotlin, iOS view + Swift), talking over one method channel. They did *not* use a published MapLibre Flutter plugin.
- Tile data: **OpenMapTiles schema over OpenStreetMap data**, served from a local `.mbtiles` file — either a per-tour bundle downloaded as a normal asset, or a single app-wide bundle compiled into the app binary. The style's tile-source URL is rewritten at runtime to point at whichever local file exists.
- The style JSON, sprite sheets (1x and 2x, normal and satellite), and Noto glyph ranges are all bundled in the app and **copied out to the temp directory at map-open time**, then referenced by `file://` URLs, because MapLibre Native cannot read Flutter asset bundles. That copy-out happens on every map open.
- Satellite mode is a second style whose raster source points at **TomTom**'s satellite tile API, with the key read from a plaintext file in the app's assets. **This layer is online-only** — the "offline-first" promise silently does not cover satellite. The key is trivially extractable from a shipped app; the README instructs you to paste it into a text file. That is a credential-handling pattern to reject.
- Attribution (TomTom / OpenMapTiles / OpenStreetMap) is a dedicated overlay that auto-hides on first map interaction, with an always-available info button. Required by the data licences, and worth copying as a pattern.
- `flutter_map` is also a dependency, but only to host a **debug-only fake-GPS drag marker overlay** on top of the native map, with a comment admitting this should be removed. Two map engines in one screen for a debug affordance.

**Overlays on the map** are three GeoJSON sources handed to the native side at view creation — the route line, the stops, the POIs — plus a fourth, mutable source for the user's own position, updated by pushing a one-point GeoJSON blob over the method channel on every fix. Tap targets are enlarged by adding invisible large circles behind the markers. There is a candid comment in the Kotlin about having to reconstruct the location source when switching styles to avoid a native crash.

---

## Audio

- **Packages:** `just_audio` (player), `audio_service` (background/lock-screen/notification integration), `audio_session` (OS audio focus).
- **Session:** configured once at app startup with the **speech** preset — this is the single most important audio decision in the app. Speech configuration means the OS treats narration as spoken content: it ducks/pauses music appropriately, routes sensibly, and behaves correctly with car Bluetooth. Interruption handling is thereby delegated to the platform rather than hand-written.
- **Architecture:** one process-wide singleton audio handler, initialised at startup, which the navigation screen *assigns the current tour to* before use. The handler exposes a small state enum — `playing`, `paused`, `completed`, `stopped`, `loading` — derived on demand from the player's processing state plus its playing flag, rather than stored separately. Derived-not-stored is the right instinct: it cannot desynchronise.
- **Lock screen / notification:** the handler publishes both a media item (title = stop title, album = tour title, artwork, duration) and a control set. Previous/next map to **previous/next stop in the tour**, not previous/next track — so the lock screen becomes a tour remote control. Seek, seek-forward and seek-backward are advertised as system actions.
- **Artwork trick worth stealing:** lock-screen art is generated by taking the stop's first gallery image, centre-cropping to a 512px square on a background isolate, and caching the result in temp keyed by asset hash. Doing the crop off the UI thread and caching by content hash means it happens once per stop, ever.
- **Duration is a stream, not a property.** The player reports duration asynchronously after the file loads, and the handler re-publishes an updated media item when it arrives, because the lock screen needs the duration to draw its scrubber.
- **Position is exposed as a fraction (0..1), not a duration.** The panel's slider therefore works in normalised units and formats a label by multiplying back out. Convenient, but it makes the position meaningless before the duration is known, and produces NaN that has to be defended against in several places.
- **Race handling:** after awaiting the media-item build, the handler re-checks that the requested index is still current before publishing — a cheap guard against a fast walker triggering two stops in quick succession. It also explicitly swallows the "interrupted by a newer play request" exception, which is exactly the error a GPS-driven player will hit routinely.
- **Silent stops are first-class:** if a stop has no narration, the handler still publishes a media item and a state change, so the UI shows the stop title with no audio rather than showing nothing.
- **Synchronisation with position is one-way and coarse:** position selects *which file*, and that's the whole contract. There is no timed sub-cueing, no "play this paragraph as you round the corner", no pause-when-user-stops-walking. Given a `completed` state exists and drives a replay button, the model is "arrive → hear the whole thing → optionally replay".
- **Manual override:** tapping a stop in the drag-up drawer sets the current waypoint index directly, which flows through the identical path as a GPS trigger. **One code path for automatic and manual playback** — this is the single cleanest structural idea in the app.
- Teardown disposes and *recreates* the player on reset, because the underlying player object is not reliably reusable after disposal.

---

## Purchases / entitlements

**Confirmed absent.** A repo-wide search for purchase, billing, entitlement, subscription, paywall, RevenueCat, Stripe, price, premium, and unlock returns nothing but stream-subscription matches. There is no in-app-purchase dependency in either pubspec, no receipt validation, no server-side entitlement check, no locked content, and no notion of a user or an account anywhere in the codebase. Content is free, static, and public: **anyone who knows the base URL can fetch every audio file directly, unauthenticated.**

For KUDY this is the single biggest architectural gap versus requirements. TourForge's content pipeline is "public static files behind a CDN". A paid-route product cannot use that shape unchanged — an unauthenticated public asset URL *is* the piracy vector. KUDY needs signed, short-lived, per-purchase download URLs (or per-purchase content keys) issued by a server only after the store receipt is verified server-side, and asset paths must not be guessable from the free catalogue. **The free preview index and the paid asset store must live behind different doors.** Everything else in TourForge's download/GC design survives that change intact — content-addressed filenames and atomic `.part` renames work identically with signed URLs.

---

## Design decisions worth copying

1. **Content-addressed assets with the hash as the filename.** Cache invalidation, deduplication across tours, and the garbage collector all fall out for free. One idea, four problems solved.
2. **The index is the manifest.** No local database tracking what's downloaded. "Is this downloaded?" is a filesystem existence check; "what should exist?" is derived from the index. For a solo dev this deletes an entire class of sync bugs.
3. **Reachability-based garbage collection instead of delete buttons.** One sweep handles orphans from content updates *and* user deletion (by excluding a tour from the reachable set).
4. **Atomic download via temp file + rename.** Non-negotiable for offline-first. A partial file must never be mistaken for a complete one.
5. **Exponential backoff with random jitter, and per-asset download deduplication.** Both are five-line ideas that prevent real production failures.
6. **Offline-tolerant startup.** Refresh the index every launch, but treat failure as fatal only when there is no cached copy. Bounded retries when cached, unbounded when not.
7. **Indirection layer on the content base URL.** A shipped app pointing at a document that names the real content host means you can move your CDN without an app-store release. Cheap insurance.
8. **Per-stop trigger radius as authored data, not a global constant.** A cathedral square needs 60m; a narrow alley plaque needs 15m. Making this content rather than code is correct.
9. **"Things that talk" vs "things that are just there"** — the stop/POI split. Two entity types with different obligations, rather than one type with a nullable everything.
10. **One code path for GPS-triggered and manually-tapped playback.** Both set the same index; everything downstream is identical. This is why their audio logic stays small.
11. **Derive playback state from the player rather than storing it.** No possibility of drift between "what we think is playing" and what is playing.
12. **Speech audio-session configuration.** Delegates ducking, focus, and interruption to the OS. Do not hand-write this.
13. **Lock-screen prev/next mapped to tour stops.** Turns the lock screen into a tour remote. Small, high-perceived-quality.
14. **Off-thread, content-hash-cached artwork generation.**
15. **Encoded polyline for route geometry** rather than a coordinate array. Meaningfully smaller payloads.
16. **Gate Start on completeness, and say so.** The tour-details screen explains you can browse before downloading but must download to run. The primary button *becomes* Start. Ambiguity eliminated.
17. **Auto-hiding map attribution with a persistent info button.** Legally required, visually unobtrusive.
18. **Contextual one-time help, keyed per screen**, with the "seen" flag as a marker file. Trivially cheap; no settings store needed.
19. **Screen wakelock scoped to the running-tour screen only.**
20. **Guard against a stale async result before committing it** (re-check the requested index after an await). GPS-driven UIs generate these races constantly.

## Design decisions to reject (and why)

1. **Writing your own native map plugin.** Two languages, two platform views, one method channel, plus native crash workarounds documented in comments. For a solo non-technical founder this is months of work and a permanent maintenance tax. Use a maintained RN map library.
2. **Two map engines on one screen** so a debug fake-GPS marker can be dragged. Their own comment flags it. Build debug location simulation with the OS simulator or a dev-only settings toggle instead.
3. **API key pasted into a plaintext asset file.** Extractable from any shipped binary. Any keyed tile provider must be either restricted by bundle ID/referrer with quotas, or proxied.
4. **Satellite imagery from an online-only commercial provider inside an "offline-first" app.** A feature that silently fails offline is worse than no feature. If KUDY wants satellite, it must be marked as requiring a connection.
5. **No lifecycle handling and no background location.** The app cannot trigger stops with the screen locked. For a walking tour, phone-in-pocket with headphones is the *primary* posture. This must be designed for, not discovered.
6. **No progress persistence.** No visited set, no resume point. Kill the app in the middle of a paid tour and the user is nowhere. Unacceptable for paid content.
7. **Ignoring null from the trigger check.** It works by accident for the "keep walking" case, but it means the app can never know you've *left* a stop — no exit events, no "you're off route" nudge, no accurate current-location display in the panel.
8. **Discarding accuracy from every GPS fix.** With no accuracy filter, a 200-metre-error urban-canyon fix triggers a stop just as confidently as a 5-metre one. In Gdańsk's Main Town — dense masonry, narrow streets — this will misfire. Filter by reported accuracy, and consider requiring two consecutive in-radius fixes before firing.
9. **Position as a 0..1 fraction.** Produces NaN before duration is known, defended against ad hoc in three places. Keep milliseconds; format at the edge.
10. **A permission helper that reports success on permanent denial.** The caller then subscribes to a stream that never emits and the user sees a frozen map. Permission results must be a closed set the caller must handle.
11. **A base-URL fetch that retries forever before the app can start.** Offline cold start hangs on a loop with unbounded backoff. Bound it and fall back to cached content.
12. **A blocking modal disclaimer on every single tour start.** It exists for the driving case. For walking tours, show it once.
13. **Array index as the stop's public identity.** Fine internally; dangerous the moment content is edited, because inserting a stop silently renumbers everything. Any persisted progress or analytics must key on a stable stop id.
14. **Home as an unfiltered list with no search and no map.** Fine for three tours; not for a city catalogue.
15. **Hard-coded English UI strings throughout.** Retrofitting localisation later is painful. KUDY is Polish/English from day one — set up localisation before the first screen.
16. **Long-press as the only route to storage management.** Undiscoverable. KUDY's "My KUDY" tab should own this explicitly.
17. **Global mutable singletons for the audio handler and download manager**, with a tour assigned onto the audio handler as a mutable field. It works because only one tour can run, but that invariant is nowhere enforced.

## Gotchas / platform realities discovered

- **Native map renderers cannot read framework asset bundles.** Styles, sprites, and glyph ranges must be materialised as real files on disk and referenced by `file://`. Any RN/Expo offline vector-map plan hits the same wall.
- **Font glyphs are a real offline dependency.** Map labels need glyph range files locally, or an offline map renders geometry with no place names.
- **Switching map styles at runtime can invalidate native data sources.** Their Kotlin comments record having to rebuild the location source on style switch to avoid a crash. Style switching is not free.
- **Tap targets on map markers must be inflated with invisible geometry** or thumbs miss them.
- **Media duration arrives asynchronously**, after playback metadata loads. Lock-screen metadata must be published twice: once on start, once when duration is known.
- **Audio players are not reliably reusable after disposal** — recreate rather than reset.
- **Rapid consecutive play requests are normal** in a GPS-driven player, and the underlying player signals this as an exception that must be caught rather than logged as an error.
- **`.mbtiles` is a practical unit of offline map distribution** — one file per tour or one per app, both supported by the same style rewrite.
- **High-refresh-rate display mode must be requested explicitly on Android**; they do it at startup.
- **Tile/imagery attribution is a licence obligation**, not decoration, and it must be visible and linkable.

## Open questions

1. Does the authoring tool (the "TourForge" CMS, not in this repo) emit the index, or is it hand-written? The non-stop entries in the route array strongly imply a graphical route editor upstream. KUDY needs an equivalent authoring path — for one city and one founder, a spreadsheet or Git-committed JSON plus a build script is probably enough, and a real CMS is over-engineering.
2. How is `trigger_radius` chosen in practice — per-stop by the author's eye, or computed from the geometry? This is the single most important tuning knob for perceived quality and there is no guidance in the code.
3. Nothing here addresses **indoor / dense-urban GPS degradation**. Gdańsk's Main Town is exactly the environment where naive radius checks misbehave. Unanswered by this reference; needs its own decision (accuracy gating, hysteresis, consecutive-fix confirmation, manual "play this stop" fallback always visible).
4. What happens when content changes under a downloaded tour? The GC will delete assets that fell out of the index, but nothing tells a user their downloaded tour is now incomplete, and the completeness check runs only on entering the details screen.
5. No analytics, no crash reporting, no error surfacing to the user anywhere — failures are debug-mode print statements. Deliberate minimalism or an unfinished edge? Either way KUDY needs at least crash reporting.

---

## Verdict: what translates to Expo / React Native

**Translates directly (these are ideas, not code):**
- Content-addressed assets, hash-as-filename, index-as-manifest, reachability GC, atomic download-then-rename, jittered backoff, in-flight dedup, offline-tolerant index refresh, base-URL indirection.
- The screen-state rule: *primary action button is Download until complete, then Start.*
- The stop/POI distinction, per-stop trigger radius, encoded polyline geometry, nullable-means-optional content.
- One playback path for both automatic and manual stop selection; playback state derived from the player.
- Lock-screen prev/next as tour navigation; speech-mode audio session; cached square artwork.
- Auto-hiding attribution; one-time contextual help; wakelock scoped to the running screen.

**Concrete RN/Expo substitutions for their packages:**

| TourForge (Flutter) | Purpose | Expo / RN equivalent |
|---|---|---|
| `geolocator` | GPS stream + permissions | `expo-location` (foreground **and** background/task-manager APIs — use both, unlike TourForge) |
| custom MapLibre native plugin | vector map + offline tiles | `@rnmapbox/maps` or `@maplibre/maplibre-react-native` — **do not write a native plugin** |
| `.mbtiles` per tour + TomTom satellite | offline tiles | the map library's own offline-region/pack download API; skip satellite entirely for v1 |
| `just_audio` + `audio_service` + `audio_session` | playback, lock screen, focus | `expo-audio` for playback; lock-screen controls and background mode need a media-session layer — verify this early, it is the highest-risk substitution |
| `wakelock_plus` | keep screen on | `expo-keep-awake` |
| `path_provider` + raw file IO | offline storage | `expo-file-system` (resumable download gives the atomic-write and progress behaviour) |
| `maps_toolkit` polyline decode | geometry | a small polyline decoder; distance math is ~15 lines of Haversine |
| `latlong2` distance | nearby detection | hand-rolled Haversine, or `expo-location` helpers |
| `url_launcher` | external links | `expo-linking` |
| `provider` | state | Zustand or React context; the whole app needs ~5 pieces of shared state |
| *(absent)* | purchases | `expo-in-app-purchases` / RevenueCat **plus server-side receipt verification and signed asset URLs** — TourForge offers nothing here |

**Their choices that are outright liabilities for KUDY:** the custom native map plugin (unmaintainable solo), the plaintext API key, the online-only satellite layer inside an offline app, the absence of background location, the absence of progress persistence, the absence of any entitlement model, the discarded GPS accuracy, and hard-coded English strings.

**The one thing to take most seriously:** their whole content architecture assumes **public, free, static files**. Every other idea in this document survives the move to paid content — but the delivery layer does not. Design KUDY's entitlement and signed-delivery path *first*, then bolt TourForge's excellent download/GC/offline mechanics on top of it.