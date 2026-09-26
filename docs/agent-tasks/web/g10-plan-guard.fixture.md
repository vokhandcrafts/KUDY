# Guard fixture — pinned excerpt of the removed web plan

Source: `docs/plans/2026-09-16-web-audio-version.md`, blob `61125a21f44c09a93cf4ef4e0499f61a1acc29d4`
(§2 «Page map — the same pages, free tier only»). The plan itself moved out of
the working tree in G18.05.d; this excerpt is the guarded surface of
`g10-dependency-guards.test.mjs` — the assertions read it so the checks stay
green in a shallow CI checkout, where deep git objects are absent. The wording
below is verbatim from the blob; do not edit it except through a review that
re-pins the source.

---

## 2. Page map — the same pages, free tier only

Every app screen (09 §6.5: `Explore · RouteDetail · Run · Map · MyKUDY · demo/reviewer`) maps to a web page or to an explicit exclusion. This is the direct answer to «старонкі такія ж, толькі без платнага кантэнту»:

| App screen | Web page | Reads | Paid content handling |
|---|---|---|---|
| `Explore` | `/` — city catalog | discovery index + catalog | Free guides only; «EXPLORE не імітуе каталог» (15, R08) — with one published guide the home shows that guide's card plus the map entry, not an empty directory |
| `RouteDetail` | `/guides/[route_id]` | `route.json`, per-locale base `stops.json`, previews | Locked stops visible with padlock + `name` + `announce` from `previews.json`; one calm offer at the bottom → app; languages, duration, distance and stop count shown from the bundle |
| `Run` (GPS session) | Stop pages `/guides/[route_id]/stops/[stop_id]`, browsable in the recommended order | base `stops.json`, audio, transcripts | Free stories play by explicit user tap only; the full story text (transcript) renders for SEO; locked stops render the public preview + app CTA. No GPS, no autoplay, no session — the web walk is manual by contract |
| `Map` («Побач») | `/map` — static city map | public place projections | Manual overview only: no position, no «nearby» personalization, ODbL attribution visible and clickable (09 §6.3.1) |
| `MyKUDY` | — excluded | — | No accounts, downloads or progress exist on the web (04 role list is deliberately narrower); a footer link to the app replaces it |
| `demo/reviewer` | — excluded | — | App-only store-review tooling |

Exclusions are part of the plan, not omissions: each excluded screen exists on the web only as a link into the app.
