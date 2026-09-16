# Draft issue bodies for the web wave (G10)

Preserved per AGENTS.md: publish these **after** the web plan reaches the default branch, so brief links resolve. Do not set `agent:ready`, `prio:*` or `epic` labels — the operator owns them. Fill the `Issue` column of [README.md](README.md) after creation. If an issue body changes on GitHub, the drafts here stay as the record of what was published.

Order: epic first (its number is needed by the task bodies), then G01.04 and G03.05 tracking issues (their numbers are needed by `Blocked-by`), then G10.01, then G10.02.

---

## 1. Epic — «G10 — вэб як канал бясплатнага кантэнту»

Title: `G10 — вэб як канал бясплатнага кантэнту (вэб-аўдыёверсія)`

```markdown
## Epic

Parent of the web audio channel tasks. This is a coordination issue: never claim it, work happens in child issues.

## Goal

The accepted web audio channel (docs/04 §«Паралельны трэк — вэб-аўдыёверсія (прынята)»): the same guide content as the app, free tier only, every path to paid content leads to the app. Roles: promo link without install, free access without install, SEO via text versions.

## Children

- G10.01 — #<G10.01> (scaffold/readers, catalog+guide pages, stop pages/player)
- G10.02 — #<G10.02> (app transition, SEO+publication)

Plan: docs/plans/2026-09-16-web-audio-version.md · Briefs: docs/agent-tasks/web/README.md

## Acceptance

1. [ ] Both children closed.
2. [ ] The live web serves only the public layer (leak scan clean).

## Out of scope

GPS, offline, accounts, checkout, analytics, a second content source.

## Dependencies

None (this epic exists since the 2026-09 backlog; M3 in docs/architecture/09 §13).
```

---

## 2. Tracking — G01.04 «Навігацыйны кантракт Горад → Гіды»

Title: `G01.04 — навігацыйны кантракт Горад → Гіды (tracking)`

```markdown
## Epic

`Epic: #<G10-epic>` is unrelated to the content of this task; this tracking issue exists so G10.01 can name its prerequisite. The canonical row is docs/16_delivery_backlog.md (G01.04). No brief file yet — the operator or a future planning task splits it.

## Goal

The City → Guides navigation contract is decided: single/multiple guide transitions, return to Run, Back, empty city, locked preview and no empty rubrics; places/collections/guides and exact/alternatives paths per docs/20/21. Canonical docs (09/11 or a dedicated contract) match the decision.

## Acceptance

1. [ ] The navigation contract is written in the canonical docs with examples.
2. [ ] Locked preview rules and empty-state rules are testable.
3. [ ] Downstream consumers (G06.01, G10.01.b) can start from the recorded contract.

## Out of scope

Screen implementation (G06), web pages (G10).

## Dependencies

None.

## Notes for the dispatcher

Tracking issue without `agent:ready` until the operator splits it.
```

---

## 3. Tracking — G03.05 «Першы апублікаваны гід і правераны бясплатны вэб-пласт»

Title: `G03.05 — першы апублікаваны гід і правераны бясплатны вэб-пласт (tracking)`

```markdown
## Epic

`Epic: #<G10-epic>` is unrelated to the content of this task; this tracking issue exists so G10.02 can name its prerequisite. The canonical row is docs/16_delivery_backlog.md (G03.05). No brief file yet.

## Goal

The first real published guide: export passes G02, map/stops/audio match on site, the catalog shows real size and languages, a previous version exists for rollback — including the verified free web layer.

## Acceptance

1. [ ] A real guide is published through the G02 pipeline.
2. [ ] The catalog shows real size and actually available locales.
3. [ ] The free web layer renders this content correctly (after G10.01).
4. [ ] A previous version exists for rollback.

## Out of scope

English audio recording (separate content decision), G10 implementation itself.

## Dependencies

`Blocked-by: #56 (G02.04)` plus G03.03 and G03.04 (canonical row in docs/16; they have no issues yet — name them in the body and link once created).

## Notes for the dispatcher

Tracking issue without `agent:ready` until the operator splits it.
```

---

## 4. Task — G10.01 «Старонка гіда, кропкі і асобнае аўдыё»

Title: `G10.01 — старонка гіда, кропкі і асобнае аўдыё (вэб, бясплатны пласт)`

```markdown
## Epic

`Epic: #<G10-epic>`

## Goal

The web serves the same guides as the app from the same public bundles: a catalog page, a guide page with stops, and stop pages with separate audio — free tier only, BE/EN text, transcripts, manual Play; locked stops exist only as public previews leading to the app. Split into parts G10.01.a–c (docs/agent-tasks/web/).

## Acceptance

1. [ ] G10.01.a — web scaffold, typed public-layer readers, leak guard, `npm test` wiring (docs/agent-tasks/web/G10.01.a.md).
2. [ ] G10.01.b — catalog + guide pages in BE/EN, locked previews (padlock + name + announce), calm offer per docs/01 (docs/agent-tasks/web/G10.01.b.md).
3. [ ] G10.01.c — stop pages, manual audio player, transcripts, safe unknown-version handling (docs/agent-tasks/web/G10.01.c.md).
4. [ ] Rendered output contains no extended/paid content (leak scan on input and output).
5. [ ] Parent completes only when all three parts are complete.

## Out of scope

Deployment/domain (G10.02.b), store links/QR (G10.02.a), GPS/offline/accounts/checkout, a second content source.

## Dependencies

`Blocked-by: #55 (G02.03), #<G01.04-tracking>`

## Proof

Per-part proof is in each brief (leak-guard test and wiring test fail when reverted).

## Notes for the dispatcher

Work per part; each part writes docs/agent-tasks/results/<ID>.md.
```

---

## 5. Task — G10.02 «Лінкі, QR, індэксацыя і публікацыя»

Title: `G10.02 — лінкі, QR, індэксацыя і публікацыя (вэб, пераход у дадатак)`

```markdown
## Epic

`Epic: #<G10-epic>`

## Goal

The web→app transition is clear and dead-end-free: a single app-links config (real store URLs when they exist — never fabricated), an `/app` fallback page, QR assets, OG metadata from public fields only; then SEO (sitemap, indexable transcripts), Vercel publication, and a proven rollback (a failed publish leaves the previous release serving). Split into parts G10.02.a–b (docs/agent-tasks/web/).

## Acceptance

1. [ ] G10.02.a — app transition: single config, /app fallback, QR, public-only metadata (docs/agent-tasks/web/G10.02.a.md).
2. [ ] G10.02.b — SEO, publication, rollback drill, deployed-output leak scan (docs/agent-tasks/web/G10.02.b.md).
3. [ ] An installed-app-less visitor never hits a dead end; store URLs are never invented.
4. [ ] Metadata and deployed output disclose no private content.
5. [ ] Parent completes only when both parts are complete.

## Out of scope

Store metadata and claims (G11.04), content publication itself (G02.04/G03.05), app-side deep links (M7).

## Dependencies

`Blocked-by: #<G10.01>, #<G03.05-tracking>`

## Proof

Per-part proof is in each brief (config scan test fails when reverted; rollback drill recorded).

## Notes for the dispatcher

G10.02.b needs Vercel/domain access — coordinate with the operator; without it the part is `blocked-external`.
```

---

After creation: replace `#<...>` placeholders with the real numbers in the GitHub bodies, fill the `Issue` column in [README.md](README.md), and record the URLs in the wave README per AGENTS.md.
