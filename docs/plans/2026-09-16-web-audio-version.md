# Web audio version implementation plan (G10)

> **For agentic workers:** implement one ready task at a time from the [web task briefs](../agent-tasks/web/README.md). Work in the current checkout; do not launch successor tasks or create worktrees from this document. Human-facing documentation is Belarusian; agent briefs and results are English.

**Goal:** Ship the accepted web audio channel: the same guide content as the app, free tier only, where every path to paid content leads to the app instead. It serves the three accepted roles — a promo link that works without install, free access without install, and indexable text for SEO.

**Architecture:** A static-first web client on Vercel reads only the public layer of the same versioned content bundles the app reads (`route × version × locale × tier`). There is no second content pipeline, no private byte in the web build, no accounts, no sessions and no entitlement logic: the web is a second reader of the same published artifacts, with one app-transition contract for locked content.

**Tech stack (proposed; the founder confirms it when G10.01.a starts):** Next.js (App Router, static generation) + TypeScript on Vercel; the standard HTML audio element for the manual player; MapLibre GL JS for the static city map; no database, no server-side state, no analytics in the first release. Alternative considered: Astro. The repo's React/TypeScript base and the accepted Vercel hosting favor Next.js. Nothing in the content contract depends on this choice.

**Spec:** [04, «Паралельны трэк — вэб-аўдыёверсія (прынята)»](../04_scope_and_roadmap.md) · [09 §2 «Вэб і платнае», §8 «Мовы і голас», §13 M3](../architecture/09_technical_architecture.md) · [16, эпік G10](../16_delivery_backlog.md) · [01, «Дзе відаць цана»](../01_product_structure.md) · [build-bundle README](../../tools/build-bundle/README.md) · [21 §3.2 `DiscoveryIndexV1`](../architecture/21_discovery_feedback_architecture.md). These travel with every task.

## Global constraints

- **Only the public layer.** 09 §2: «вэб-плэер аддае **толькі бясплатны base-пласт**» — the reason recorded there: «у вэбе ўсё відно ў devtools, а web-checkout па-за MVP (`04`), значыць ніякай патрэбы трымаць там платны кантэнт няма». No extended text, audio, transcript, path, price metadata or source map may reach the web build input or its deployable output.
- **Same content source, no copies.** 04: «Тая самая крыніца кантэнту. Вэб чытае тыя ж версіяваныя бандлы (`route × version × locale × tier`), што і дадатак — кантэнт пішацца адзін раз». The web never re-authors or re-serializes content; generated mirrors of content trees are gitignored in the same change (implementation-rules §5).
- **Deliberately flat.** 04: «вэб не робіць GPS-трыгеры і offline на прыстойным узроўні — гэта наўмысна «плоская» версія, не другі прадукт». No Run sessions, no geofences, no background anything, no offline mode, no accounts, no push, no checkout (web-checkout is on the 09 §17 forbidden list).
- **Locked stops exist only as public previews.** `previews.json` carries «толькі `stop_id`, `place_id`, `name`, `announce`» ([build-bundle README](../../tools/build-bundle/README.md)); 01: «Публічнае прэв'ю змяшчае месца, назву і кароткі анонс; поўныя тэксты і медыя прыватныя». The web shows the padlock, the name and the announce — never a truncated paid text.
- **Calm offers only.** 01 «Дзе відаць цана»: the price/app offer lives at the bottom of the route and stop descriptions; «няма усплыванняў», no audio insertions, no push. On the web the equivalent is one calm CTA block per page, not banners.
- **No dead ends.** 16 G10.02: «неўсталяваны дадатак не дае тупік». Every app CTA resolves to a working page even when no store URL exists yet.
- **Languages.** 09 §8: «Вэб-плэер аддае беларускае аўдыё бясплатнага пласта і **англійскі тэкст** гісторый»; UI strings exist in `be` and `en` from the first page («ніводнага зашытага радка нідзе»); per-locale publication is by fact — the catalog shows actually available locales; close device languages (e.g. `ru`, `uk`) are not silently substituted by `be` (09 §8).
- **Store links are not invented.** The app is not published; store URLs do not exist. The app-links config carries explicit placeholders until the founder supplies real URLs.
- **Deep links are M7** (09 §13). The web URL scheme must stay stable from the first release so the future app can mirror it as universal links.
- **The 09 §17 forbidden list applies to the web** as to the app: no LLM at runtime, no DRM, no web-checkout, no extra entitlement tiers, no own catalog server.
- **Unknown content renders safely.** 16 G10.01: «невядомая версія не рэндэрыцца небяспечна»; G02.05: «невядомая schema_version бяспечна адхіляецца».

## 1. Verified starting point, 2026-09-16

| Existing result | Recorded status | Consequence |
|---|---|---|
| `tools/build-bundle/` (G02.03, issue #55) | WIP on branch `zcode/55`, commit `530d35b` | The public output contract below is what G10.01.a consumes; web tasks stay blocked until #55 closes |
| `fixtures/content/demo-route/` | present on main | The fixture bundle the web develops against until G03.05 publishes real content |
| `fixtures/discovery-contract/` | present on main | `DiscoveryIndexV1` examples for the catalog page |
| Web code | none | `web/` does not exist in the repository yet |
| Store links / universal links | none | App-links config starts with placeholders; G10.02.a owns the no-dead-end fallback |
| 09 §13 order | M3 = web player of the free tier before the mobile UI | The web is a product priority (channel + early access), not an architectural prerequisite |

The public output the web consumes (verbatim from the [build-bundle README](../../tools/build-bundle/README.md)):

```
public/bundle/<route_id>/<version>/…   # base-пласт: stops, audio, previews.json, lock.json
public/places/<place_id>/public.json   # detail_ref-мэты
public/discovery/<city_id>/<revision>/index.json
private/bundle/<route_id>/<version>/<locale>/extended/…   # lock.json у тым жа фармаце
release/feedback-target-registry.json  # толькі для сервера, кліенту не выдаецца
release/release-manifest.json          # поўны спіс артэфактаў з bytes+sha256
```

The `private/` layer and the feedback registry are **never** inputs to the web build. Content publication and the catalog pointer update belong to G02.04, not to the web.

## 2. Page map — the same pages, free tier only

Every app screen (09 §6.5: `Explore · RouteDetail · Run · Map · MyKUDY · demo/reviewer`) maps to a web page or to an explicit exclusion. This is the direct answer to «старонкі такія ж, толькі без платнага кантэнту»:

| App screen | Web page | Reads | Paid content handling |
|---|---|---|---|
| `Explore` | `/` — city catalog | discovery index + catalog | Free guides only; «EXPLORE не імітуе каталог» (01, R08) — with one published guide the home shows that guide's card plus the map entry, not an empty directory |
| `RouteDetail` | `/guides/[route_id]` | `route.json`, per-locale base `stops.json`, previews | Locked stops visible with padlock + `name` + `announce` from `previews.json`; one calm offer at the bottom → app; languages, duration, distance and stop count shown from the bundle |
| `Run` (GPS session) | Stop pages `/guides/[route_id]/stops/[stop_id]`, browsable in the recommended order | base `stops.json`, audio, transcripts | Free stories play by explicit user tap only; the full story text (transcript) renders for SEO; locked stops render the public preview + app CTA. No GPS, no autoplay, no session — the web walk is manual by contract |
| `Map` («Побач») | `/map` — static city map | public place projections | Manual overview only: no position, no «nearby» personalization, ODbL attribution visible and clickable (09 §6.3.1) |
| `MyKUDY` | — excluded | — | No accounts, downloads or progress exist on the web (04 role list is deliberately narrower); a footer link to the app replaces it |
| `demo/reviewer` | — excluded | — | App-only store-review tooling |

Exclusions are part of the plan, not omissions: each excluded screen exists on the web only as a link into the app.

## 3. Free content boundary and the paid → app transition

1. **One config, one place.** All app destinations live in a single module (`web/config/app-links.*`): store URLs, the future deep-link base, and per-route product references taken from the catalog. No page hardcodes an external app/store URL; a committed scan test fails if one appears (implementation-rules §1 reverted-line check).
2. **Placeholders until launch.** Until the stores go live, every CTA points to the internal `/app` page («поўная версія — у дадатку: GPS-аўтазапуск, офлайн, поўныя маршруты») with the store buttons rendered from the config; missing URLs render as «хутка» state, not as broken links. Fabricating a store URL is a defect.
3. **Deep-link-ready URLs.** Web paths are stable and locale-consistent from the first release; when M7 universal links arrive, the same paths resolve in the app and the web page becomes the fallback target — the no-dead-end rule then holds automatically.
4. **QR channel.** 06 §3: the web exists so a link/QR «працуе без устаноўкі». G10.02.a generates QR images for route URLs as static assets for print and promotion.
5. **Metadata does not leak.** 16 G10.02: «метададзеныя не раскрываюць private». OG/Twitter card text is built from public fields only; the leak scan covers rendered HTML and card metadata, not just data files.

## 4. Languages

- URL structure: locale-prefixed pages (`/be/…`, `/en/…`) with `be` as the default locale at the root; UI string files `be` + `en` from the first page.
- Story text: rendered from per-locale base `stops.json`; per-locale publication is by fact — «каталог паказвае наяўныя локалі па факце» (09 §8). An `en` text-only route must not claim or fake `en` audio; the player simply offers the locales that actually exist.
- Audio: whatever the public bundle carries (at launch only `be`); when English audio is recorded it appears here with no contract change («Англійскае аўдыё з'яўляецца тут жа, як толькі будзе запісана» — 09 §8).
- No automatic substitution of close browser languages; the visitor picks explicitly, `en` is the fallback choice offered (09 §8 language chain, applied to web navigation).

## 5. Content pipeline, deployment and rollback

- **Read the same artifacts.** The web build fetches the same public artifacts the CDN serves (catalog, discovery index, public bundles). Before the CDN exists (G02.04 pending), the web build consumes the build-bundle output built from `fixtures/content/demo-route` — as a fixture, not as a second content source.
- **Leak guard on every build.** The web build scans its content input and its rendered output: any `extended` path segment, any 8-gram of a private text, any `*.map` file fails the build (same defect classes the build-bundle scan already stops on: `private-text-leak`, `private-path-in-public`, `source-map-in-public`).
- **Immutable versions, pointer-driven pages.** Bundle paths are versioned and immutable (09 §4); the web renders the catalog's current pointer. A content update is a new version + pointer update by G02.04 — the web never mutates bundles.
- **Rollback is inherited.** 16 G10.02: «пры збоі публікацыі працуе папярэдні рэліз». The Vercel project keeps the last good deployment serving; the G10.02.b drill proves a failed publish leaves the previous release reachable.
- **Hosting and secrets.** Vercel project + domain are the only new infrastructure; no secrets are needed by the first release (no API keys in the client — 09 §15). Analytics stays absent; if it is ever added, the consent rules of 09 §10 apply to the web too.

## 6. New tasks and execution graph

Canonical IDs stay G10.01/G10.02 (16; IDs are never renumbered). The work is split into five independently reviewable parts with briefs in [agent-tasks/web/](../agent-tasks/web/README.md). All start as `not-started`.

| ID | Independently reviewable result | Depends on | Backlog model |
|---|---|---|---|
| [G10.01.a](../agent-tasks/web/G10.01.a.md) | `web/` scaffold, typed public-layer readers, leak guard, test wiring | G02.03 (#55) | сярэдняя |
| [G10.01.b](../agent-tasks/web/G10.01.b.md) | Catalog page + guide page (be/en), locked previews, calm offer, static city map | G10.01.a, G01.04 | сярэдняя |
| [G10.01.c](../agent-tasks/web/G10.01.c.md) | Stop pages, manual audio player, transcripts, safe unknown-version handling | G10.01.b | сярэдняя |
| [G10.02.a](../agent-tasks/web/G10.02.a.md) | App-transition contract: links config, `/app` fallback, QR, OG metadata | G10.01.c | сярэдняя |
| [G10.02.b](../agent-tasks/web/G10.02.b.md) | SEO, Vercel publication, rollback drill | G10.02.a, G03.05 | сярэдняя |

The parent backlog rows keep their meaning: G10.01 completes only when a–c are complete; G10.02 only when a–b are complete. G03.05 (first published guide and the verified free web layer) gates the public launch, not the development. Nothing here re-opens G00/G01 prerequisites or weakens existing blockers.

## 7. Documentation changes in this plan (not runtime work)

- `16_delivery_backlog.md` — a dated update note and pointers from the G10 section to this plan and the briefs. No IDs renumbered, no criteria edited.
- `agent-tasks/README.md` and `docs/readme.md` — one wave line each.
- `agent-tasks/web/` — README index and the five briefs; `agent-tasks/web/issues-draft.md` preserves the GitHub issue bodies to publish after this plan reaches the default branch (documents referenced by issues must exist there first).
- Runtime code is **not** authorized by this plan; the first executable task is G10.01.a after #55 closes.

## 8. Coverage

| Requirement source | Tasks |
|---|---|
| 04 web track (roles 1–3, same source, flat by design) | G10.01.a–c, G10.02.a–b |
| 09 §2 web/free-tier boundary + leak classes | G10.01.a (guard), G10.01.b–c (pages), G10.02.b (deployed-output scan) |
| 01 price rule + locked previews (01, build-bundle README) | G10.01.b, G10.01.c, G10.02.a |
| 16 G10.01 criteria (same public package, BE/EN text, transcript, manual Play, no locked content, safe unknown version) | G10.01.a–c |
| 16 G10.02 criteria (clear app/store transition, no dead end, publication rollback, no private metadata) | G10.02.a–b |
| 09 §8 web languages (be audio + en text, explicit locale choice) | G10.01.b, G10.01.c |
| 09 §6.3.1 map licensing (ODbL attribution visible, no bulk tile scraping) | G10.01.b |
| 09 §13 M3 acceptance («лінк адкрываецца, аўдыё грае, тэкст індэксуюцца») | G10.01.c, G10.02.b |
| 06 §3 QR/link channel | G10.02.a |

Planning completeness is checked through this coverage and the dependency graph; implementation completeness requires evidence in each task result per `agent-rules/showboat.md` and `agent-rules/code-review.md`.
