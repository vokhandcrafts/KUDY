# Terrastories content model — reference notes for KUDY

Source: `github.com/Terrastories/terrastories`, branch `master`, MIT-licensed. Rails app lives under `rails/`; authoritative schema is `rails/db/schema.rb` (schema version 2024_04_10_210545). Models under `rails/app/models`, authorization under `rails/app/policies`, map config under `rails/app/services/map.rb`, offline stack in `compose.yaml`.

## What it does

Terrastories is a "geostorytelling" CMS: a map plus a sidebar. Each map point is a **Place**; clicking it reveals the **Stories** told about that place; each story carries **Media** (audio, video, images) and is attributed to one or more **Speakers**. It is built for Indigenous communities recording oral history, and its headline non-functional requirement is that it must run **entirely offline** on a local "Field Kit" box (Rails + Postgres + tileserver-gl behind an nginx proxy, all in Docker, no internet).

### Core entities and the fields that carry meaning

**communities** — the tenant root. `name`, `slug` (unique, auto-derived from the downcased/underscored name with a numeric suffix on collision), `locale`, `country`, `description`, `public` (indexed boolean; controls whether the community opts into the separate public "Explore Terrastories" app), `beta`. Owns places, stories, speakers, users, and exactly one theme; all of those are `dependent: :destroy`.

**places** — `name` (required), `type_of_place` (free-text category, e.g. village / river / grave), `description`, `region` (free-text string, **not** a geometry), `lat` / `long` as `decimal(10,6)` each, `community_id`. Attachments: one `photo`, one `name_audio` (a recording of the placename pronounced correctly — a genuinely thoughtful field). Validations bound lat to ±90 and long to ±180; a `with_valid_coordinates` scope filters out rows where either is null.

**stories** — `title` (required), `desc`, `topic` (free-text), `language` (free-text string), `date_interviewed`, `permission_level` (integer enum), `community_id`, plus two extra foreign keys: `interview_location_id` → places, and `interviewer_id` → speakers. Validation requires at least one speaker and at least one place.

**places_stories** — plain many-to-many join, only `story_id` + `place_id`, composite index. **No ordering column, no per-link metadata.** A story can be about several places; a place accumulates many stories.

**speakers** — `name` (required), `birthdate`, `birthplace_id` → places, `speaker_community` (free-text string, distinct from the tenant `community_id`), `community_id`, one attached `photo`.

**speaker_stories** — join table, `speaker_id` + `story_id`, nothing else.

**media** — one row per attached file, `story_id` + timestamps only; the actual bytes hang off Rails' ActiveStorage attachment (`active_storage_attachments` / `active_storage_blobs` with `content_type`, `byte_size`, `checksum`, `filename`, `service_name`). One story has many media rows.

**media_links** — `url` + `story_id`. External media (YouTube etc.) modelled as a separate table from uploaded media.

**themes** — one per community; the map's presentation config: `center_lat`/`center_long`, `zoom`, `pitch`, `bearing`, `sw_boundary_lat/long` + `ne_boundary_lat/long` (a bounding box), `map_projection` (enum, defaults to mercator), `mapbox_style_url` + `mapbox_access_token`, `protomaps_api_key` + `protomaps_basemap_style`, `mapbox_3d`, an attached `static_map` image, `active`.

**users** — `username` (unique), `email`, `encrypted_password`, `role` integer enum with explicitly non-contiguous values (`member: 0`, `editor: 1`, `admin: 2`, `viewer: 3`, `super_admin: 100`), `community_id`, `super_admin` boolean (belt-and-braces alongside the role).

**curriculums** / **curriculum_stories** — a user-owned ordered collection of stories: `title`, `description`, `user_id`; the join carries `display_order`. This is the only ordered sequence of stories in the whole schema, and notably it is a *user* artifact, not a community-published one. **This is the closest thing Terrastories has to a KUDY "Route".**

**flipper_features / flipper_gates** — feature flags, evaluated per community via a `feature_groups` method.

### Relationship shape in one sentence

`Community 1—n {Place, Story, Speaker, User}`, `Story n—n Place` (unordered), `Story n—n Speaker` (unordered), `Story 1—n Media`, `Story 1—n MediaLink`, `Story n—1 Place` again as `interview_location`, `Story n—1 Speaker` again as `interviewer`, `Community 1—1 Theme`, `User 1—n Curriculum n—n Story` (ordered by `display_order`).

## Design decisions worth copying

**Place and Story are separate first-class entities joined many-to-many, not `Tour → Stop`.** This is the single most important idea here and exactly the anti-`Tour→Stop` move KUDY needs. A place exists independently of any narrative; stories attach to it; a story can span multiple places. The consequence: the same physical location can carry a cheap teaser story and a premium story and a 2-minute kids' version, without duplicating the geometry, the placename audio, or the photo. In `Tour → Stop` modelling, "the Neptune Fountain" would be re-entered once per tour, and the second tour's coordinates would silently drift from the first's.

**`name_audio` on Place.** A dedicated audio attachment holding only the pronunciation of the placename, separate from story audio. For Gdańsk this is directly reusable and cheap: foreign visitors cannot pronounce "Długi Targ" or "Żuraw", and a one-second pronunciation clip is a differentiator that costs almost nothing to produce.

**Media is its own table, not columns on Story.** One story, N media rows, each row's MIME type living on the storage blob. `Story#media_types` derives the set of kinds present by splitting the content type at the slash and de-duplicating; the UI then decides what to render. The payoff: adding a new media kind never touches the schema. KUDY should keep this shape.

**Uploaded media and linked media are different tables.** `media` (owned bytes, size- and type-validated) vs `media_links` (a `url` string). Conflating "a file we host and can guarantee offline" with "a URL on someone else's server" would be a real bug for an offline-first app — the second can never be part of an offline bundle.

**Content-type and size validation at the model layer.** Media capped at 200 MB, place photos at 5 MB, placename audio at 10 MB, with explicit allowlists of MIME types (including the awkward `audio/x-m4a` / `audio/x-aac` variants that iOS and Android actually emit). Allowlist, not blocklist. Worth copying verbatim as a *policy*: an upload path that accepts arbitrary content types is a real security boundary, not a nicety.

**Visibility is a scalar on the content, enforced by a query scope, not by the view.** `Story#permission_level` is a three-valued enum: `anonymous` (public), `user_only` (any logged-in community member), `editor_only` (staff). The `StoryPolicy::Scope` resolves the *queryset* per role — anonymous viewers get `permission_level: :anonymous`, members get anonymous plus user_only, editors/admins get everything. Crucially `PlacePolicy::Scope` mirrors this **through the join**: a place is only visible if it has at least one story the viewer may see. That second half is the part people forget — otherwise the map leaks the existence and coordinates of restricted content even when the story body is hidden. KUDY's paid-route gating must do exactly the same thing: the entitlement filter belongs in the query that builds the map layer, not in the player screen.

**A separate, explicitly public serialization.** `Place#public_point_feature` emits a GeoJSON Feature containing only fields deemed safe to publish, with keys camelCased for the public React frontend, and it is a *different method* from the internal `geojson` (which additionally embeds the associated stories). Two serializers, deliberately divergent, rather than one serializer plus a filter. For KUDY: the "free/preview" payload and the "purchased" payload should be two explicitly written shapes, so that adding a field to the internal one cannot accidentally publish it.

**Map presentation config is data, not code.** Theme stores center, zoom, pitch, bearing, projection and an explicit SW/NE bounding box, validated (zoom 0–22, pitch 0–85, bearing ±180, and the bounds must be either all-null or all-present-and-in-range). KUDY has one city, so the values are constants — but keeping them as a single named config object rather than scattered literals across screens is right, and the "all four bounds or none" validation is a nice guard against a half-configured box silently producing a broken camera.

**Layered map-source fallback with an explicit offline switch.** `Map.offline?` is a single global predicate (set by Rails env or an `OFFLINE_MODE` env var). When it is true, Mapbox tokens and hosted Protomaps keys are *ignored entirely* and the app falls back to a locally served style URL. Note the direction of the override: offline forces the safe local path, rather than online being an opt-in. This prevents an offline deployment from ever attempting — and hanging on — a network call. KUDY should have the same one-way switch for its offline bundle.

**Bulk import/export via CSV with an explicit exclusion list.** Each importable model declares `EXCLUDE_ATTRIBUTES_FROM_IMPORT` (associations and join records) and exposes an `export_sample_csv` that emits the header row a content editor should fill in. For a solo founder producing 40+ stories, a spreadsheet-shaped ingest path is worth more than a beautiful admin UI.

## Design decisions to reject (and why)

**`Community` as a tenant root.** KUDY is one city, one publisher. Every `community_id` column here is dead weight for us. Do not add a `city_id` "for later"; a single-row tenant table buys nothing and costs a join on every query. If KUDY ever adds a second city, that is a migration, and migrations are cheap compared to carrying a multi-tenant model for two years.

**`Speaker` as a full entity with `birthdate`, `birthplace_id`, `speaker_community`, and a required at-least-one-speaker validation on Story.** This exists because provenance and attribution *is the product* for oral history — who told this, where were they born, which community are they from. For a commercial audio tour, the narrator is a production credit, not a data model. Reject the entity; keep a nullable `narrator_credit` string on the audio asset if you want a credit line. The `interviewer_id` and `date_interviewed` fields are pure ethnographic apparatus — drop them.

**`language` as a free-text string on Story.** This is Terrastories' weakest field and precisely where KUDY must *not* follow. It means "the language this oral history was told in" and is used only as a filter facet — the app never picks content by the user's UI locale. There is no translation mechanism anywhere in the schema: no per-locale title, no per-locale audio, no fallback. `communities.locale` only selects the UI translation files (`rails/config/locales/{en,es,pt,nl,ja,zh,hi,pa,sw,am,mat,way}` — chrome strings only, via Rails i18n). **For KUDY, where a story must exist as Polish audio, English audio and German audio, copying this design would be a catastrophe.** See the recommendation below.

**`region` as a free-text string on Place.** It is a label ("upper river", "north quarter") used to populate a filter dropdown, not a geometry — despite the task brief's assumption, there is *no* polygon/region entity anywhere in this schema. Fine for faceting, useless for anything spatial. If KUDY wants districts (Główne Miasto, Oliwa, Westerplatte) they should be an enumerated set with stable ids, not typed strings, or the facet list fills with typos.

**Two separate paths to the same place (`places_stories` join *and* `interview_location_id`) and to the same speaker (`speaker_stories` *and* `interviewer_id`).** Two ways to express "this story relates to that place" means every query must decide which one it means, and no constraint keeps them consistent. Do not replicate.

**`Curriculum` as the ordered-collection mechanism.** The ordering lives on the join (`display_order`), which is right, but the collection is owned by a `user_id` — it is a teacher's private playlist, not a published product. KUDY's Route is a published, purchasable artifact with a price, a cover, a duration and a lifecycle; owning it by user is wrong for us. Copy the `display_order`-on-the-join idea, reject the ownership.

**`super_admin` as both a boolean column and a role enum value (100).** Two sources of truth for the most privileged state in the system. Classic drift bug waiting to happen. Pick one.

**Storing `mapbox_access_token` and `protomaps_api_key` as plaintext per-tenant columns.** Understandable for a self-hosted per-community deployment; unacceptable for a commercial app where a key is company-wide and should live in build config / a secret store, never in a row a CMS user can read back.

**Ordering by nothing.** `places_stories` has no sequence column at all, so "which story first at this place" is undefined. Terrastories doesn't care (the user browses freely). KUDY absolutely does care, because a route is a sequence. This is the gap to fill deliberately, not to inherit.

## Gotchas / platform realities discovered

- **No PostGIS.** Only `plpgsql` is enabled. Coordinates are `decimal(10,6)` scalars — roughly 11 cm precision at the equator, ample. GeoJSON is *generated on read* via RGeo's cartesian factory, never stored. Takeaway for KUDY: you do not need a spatial database for a few hundred points in one city. Radius checks are a distance formula over a preloaded array in memory, and that is genuinely the right answer — a spatial index earns its keep at millions of rows, not hundreds.
- **Bare lat/long with no projection field on the data.** Projection (`map_projection`) is a *rendering* choice on the theme, not a property of the coordinates. Coordinates are implicitly WGS84 lon/lat, i.e. what GPS gives you. Correct separation.
- **GeoJSON coordinate order is (long, lat), the reverse of the human "lat, long" habit** — and every construction site in this codebase passes long first. This is the classic silent bug: swapped arguments put your Gdańsk point in the Indian Ocean. Name the fields, never pass a bare pair.
- **Offline maps mean shipping a tile server.** The offline profile runs `maptiler/tileserver-gl` as its own container serving a style JSON from a local volume (`tileserver/data`), behind an nginx reverse proxy on a `.local` hostname, with a pre-built open-license tile pack downloaded during setup. The tiles are a build-time artifact, not something generated at runtime. Mobile equivalent for KUDY: a bundled MBTiles/PMTiles file for the Gdańsk bounding box, or the map SDK's own offline-region download API — either way, a fixed-size asset scoped to a bounding box, decided up front.
- **The offline story is "run the whole server on a box in the field", not "sync to a device".** There is no sync protocol, no conflict resolution, no delta format anywhere in the repo. That's a different offline shape from KUDY's (download a purchased route to a phone). Do not look here for sync design.
- **Media is capped at 200 MB per file** — a reminder that oral-history video is large. For KUDY, audio-only per-stop segments should be an order of magnitude smaller; if a segment approaches tens of MB, the encoding is wrong.
- **Mobile audio MIME types are messy.** The allowlists spell out `audio/m4a`, `audio/x-m4a`, `audio/x-aac`, `audio/x-flac` alongside the canonical names, because real devices and real browsers disagree about what an .m4a is. Anyone validating uploads by MIME string will hit this.
- **Postgres 11 in the compose file** — the project is conservative about the field-deployment environment, not chasing versions. Sensible for hardware that gets updated once a year, if that.
- **Preview/thumbnail generation can fail and is explicitly rescued.** `Story#media_preview_thumbnail` picks the first representable media, asks for a 200×200 variant, and swallows storage errors into `nil`. Real-world lesson: thumbnailing arbitrary user media fails often enough that it must be a nullable, non-fatal path.

## Recommendation for KUDY

### Genuinely reusable

1. **Place ⟷ Story as an n:n join, with Place owning geometry and Story owning narrative.** Keep this. It is the whole reason to have read Terrastories.
2. **The place-level assets pattern**: photo + placename pronunciation audio attached to the Place, not to any story.
3. **Media as rows, not columns**, with an explicit kind, and a hard separation between hosted files (offline-bundlable) and external URLs (never bundlable).
4. **Visibility enforced as a query scope that also filters the *places* through the join.** Re-read as: an unpurchased route's stop coordinates must not appear in the map payload at all.
5. **Two explicit serializations — preview vs. full** — rather than one shape with a filter flag.
6. **A single named map-config object** (center, zoom, pitch, bearing, SW/NE bounds) validated as all-or-nothing.
7. **A one-way offline switch** that makes network map sources unreachable rather than merely deprioritised.
8. **CSV-shaped bulk import with an explicit excluded-associations list.** For a solo non-technical founder authoring dozens of stops, this is the highest-leverage thing in the repo.

### Over-modelled for us — cut

Community/tenancy, Speaker as an entity, interviewer/date_interviewed/interview_location, the duplicate place and speaker foreign keys, free-text `region`, per-row map API keys, the whole feature-flags subsystem, and Curriculum-as-user-playlist.

### Proposed KUDY entity set

- **Place** — `id`, `slug`, `lat`, `lng`, `trigger_radius_m`, `district` (enumerated, not free text), `kind` (enumerated: monument / building / viewpoint / square), `photo_asset_id`, `name_audio_asset_id`. Locale-neutral: **no name, no description here.**
- **PlaceText** — `place_id`, `locale`, `name`, `description`. One row per (place, locale).
- **Story** — `id`, `place_id` (or an n:n `story_places` join if a story may span stops), `kind` (`teaser` | `full` | `kids`), `sort_hint`, `duration_s`. Again locale-neutral.
- **StoryText** — `story_id`, `locale`, `title`, `body`, `transcript`.
- **StoryAudio** — `story_id`, `locale`, `asset_id`, `duration_s`, `voice_credit`. **This is the row that must exist per language**, and it is deliberately separate from StoryText because audio and text for the same locale are produced by different people at different times, and one can ship before the other.
- **Asset** — `id`, `kind` (`audio` | `image`), `filename`, `mime`, `bytes`, `sha256`, `local_path`, `remote_url`. The checksum matters: offline bundles need integrity verification, and Terrastories already stores one on every blob.
- **Route** — `id`, `slug`, `product_id` (the IAP identifier), `price_tier`, `distance_m`, `duration_min`, `difficulty`, `cover_asset_id`, `published_at`. Locale-neutral.
- **RouteText** — `route_id`, `locale`, `title`, `summary`, `marketing_blurb`.
- **RouteStop** — `route_id`, `place_id`, `position` (integer, unique per route), `story_id` (which story to play *at this stop on this route*), `walk_hint_text_id`. **This join is where sequence lives** — the thing Terrastories deliberately omits and KUDY needs. It also lets the same Place appear in two routes with different stories and different narrative order, without duplicating anything.
- **Recommendation** — `id`, `place_id` (nullable), `route_id` (nullable), `kind` (`cafe` | `restaurant` | `shop` | `viewpoint`), `lat`, `lng`, `external_url`, `partner_id`, `sort`. Plus **RecommendationText** for `name`/`blurb` per locale. Keep it structurally separate from Story: a recommendation is commercial, possibly paid placement, has an expiry, and must never be confused with editorial narrative in analytics or in the UI.
- **Entitlement** — `route_id`, `platform_product_id`, `acquired_at`, `receipt_ref`. Server-verified. The client must treat entitlement as *derived from a verified receipt*, never as a local boolean a jailbroken device can flip.

### How locale should be attached — the explicit recommendation

**Locale must be a row dimension, never a column suffix and never a field on the parent.** Concretely:

- Every entity splits into a **locale-neutral core** (identity, geometry, sequence, price, asset checksums) and a **per-locale side table** keyed `(parent_id, locale)`.
- `locale` is a **BCP-47 tag** stored as a short string — `pl`, `en`, `de` — with a fixed allowlist, not free text. Terrastories' free-text `language` field is exactly the trap: it makes "English", "english", "en", "en-GB" four different languages in your filter dropdown.
- **Audio gets its own per-locale table, separate from text**, because an audio recording has its own duration, its own asset, its own voice credit, and its own production schedule. A single "translations" table with an audio column would force text and audio to ship together.
- **Define an explicit fallback chain in one place** (e.g. requested → `pl` → any available) and apply it in the query layer, not in the UI. Terrastories has no fallback at all, so content simply has one language and that's that; KUDY will ship English before German and needs a defined behaviour for the gap.
- **Completeness is a query, not a flag.** "Which routes are fully available in German?" should be answerable by counting RouteStop rows whose story has a StoryAudio in `de` — do not maintain a denormalised `has_german` boolean that will go stale. Gate a route's availability in a given language on that count, computed at publish time.
- **The offline bundle is scoped by (route, locale).** A user who bought the Old Town route in English should download English audio only. Because audio rows are already keyed by locale, the bundle manifest is a straightforward selection — this falls out of the model for free, and would be painful with locale-suffixed columns.

Net: take Terrastories' Place/Story separation, its media table, and its visibility-through-the-join scoping. Add the ordered `RouteStop` join it lacks. Replace its single free-text `language` field with per-locale side tables and a per-locale audio table — that inversion is the main thing KUDY must get right that Terrastories never needed to.

## Open questions

1. **Can one KUDY Story span multiple Places?** Terrastories says yes and pays for it with an unordered join. If KUDY's answer is "no, one story plays at one stop", `Story.place_id` is simpler and RouteStop still supplies the ordering. Decide before writing the schema — this is the one shape that is expensive to change later.
2. **Are teaser and full versions of a stop separate Story rows or one Story with two audio variants?** Separate rows (distinguished by `kind`) makes the free-preview query trivial and keeps the paid audio unreachable; one row with variants keeps editorial text shared. Leaning separate rows, for the entitlement-boundary reason.
3. **Does a Recommendation belong to a Place or to a Route?** Both nullable is a smell. If it's "a café near this stop" it's place-scoped; if it's "lunch stop on this route" it's route-scoped. Possibly two different concepts wearing one name.
4. **Where does the trigger radius live — Place, RouteStop, or both?** Terrastories has no GPS triggering at all, so no guidance. A wide square needs a bigger radius than a doorway (place-level), but a route may want a tighter trigger to control sequencing (stop-level). Suggest place-level default with an optional stop-level override; confirm against how the audio engine actually consumes it (see the Tramio engine findings).
5. **How is text/audio drift detected?** If the Polish text is edited after the Polish audio is recorded, nothing in a Terrastories-shaped model notices. A `source_text_version` on StoryAudio would surface staleness — worth it, or premature for a solo founder?
6. **Offline map tiles: bundled asset or runtime download?** Terrastories bundles a pre-built tile pack. On mobile, a Gdańsk-bounding-box pack inflates the initial app download; the SDK's offline-region API defers it but adds a failure mode before the first walk. Needs a size measurement before deciding.
7. **Is `district` a stable enumeration or does it need to be editable content?** If districts appear in the UI they need names per locale, which makes them a small entity with its own text table rather than an enum.