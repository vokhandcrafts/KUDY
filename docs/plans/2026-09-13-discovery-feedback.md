# Discovery, feedback and Ukrainian localization implementation plan

> **For agentic workers:** Use `superpowers:executing-plans` to implement one ready task at a time. Work in the current checkout. Do not launch successor tasks or create worktrees from this document.

**Goal:** Help a visitor choose authored places, collections and guides, collect private editable feedback, and prepare an explicit Ukrainian release scope.

**Architecture:** A validated static discovery index supplies a pure local selector. Feedback uses the existing device-auth boundary with dedicated private storage, durable client delivery and author-only aggregate reports. It never changes live ranking or an active walk.

**Tech Stack:** Existing planned TypeScript/React Native, SQLite, Supabase/Postgres/Edge Functions and static public content delivery. G00 still owns verified versions, platform selection and scaffold. No new runtime dependency is chosen here.

**Spec:** [Business requirements](../20_discovery_and_feedback.md), [technical contracts](../architecture/21_discovery_feedback_architecture.md). Both travel with every task.

## Global constraints

- Human-facing documentation is Belarusian; agent briefs are English.
- No public rating, public review text, inferred visit proof, runtime LLM or automated rating-based ranking in MVP.
- A collection is not a Route, Run, product or entitlement. It never starts playback.
- Keep existing version/locale pinning, explicit Start, single player/location owner, durable progress and server entitlement checks.
- `uk` is planned, not automatically published or scheduled in MVP. G14.04.a decides the release package.
- Feedback submission is voluntary and distinct from analytics consent. No raw text, coordinates or session IDs in feedback.
- Do not migrate the existing `heard`/narration contract using this work; G01.01.a is still decision-required.
- Do not write application implementation in the documentation task that creates this plan.
- Root production files listed below are planned; spikes and their passing tests do not establish production readiness.

## 1. Verified starting point, 2026-09-13

| Existing result | Recorded status | Consequence |
|---|---|---|
| `agent-tasks/results/G01.01.a.md` | `decision-required` | Founder narration decision still gates G01.01.b and downstream parent completion |
| `agent-tasks/results/G00.01.a.md` | `blocked-external` | GPS/audio spike does not prove real devices |
| `agent-tasks/results/G00.02.a.md` | `blocked-external` | Offline-map spike does not select a verified native map path |
| Other result files | Not present during inventory | Do not infer complete from task brief existence |

Do not renumber or reopen the existing 22 atomic briefs. Parent G00/G01 completion still requires the existing child results. This plan adds a separate wave and narrow integration notes.

## 2. Changes to existing tasks, not duplicate work

| Existing ID | Added responsibility | Canonical output / proof |
|---|---|---|
| G01.04 | City entry supports place/collection/guide and own-feedback return paths | Navigation contract and no fake catalog/no Run mutation cases |
| G01.05 | Discovery shown/opened events, separate feedback semantics | One event table, actual visibility, consent boundaries |
| G02.01 | Discovery refs/index, duration range, themes/seasons, availability and feedback-target serialization | `contracts/discovery.ts`, `contracts/feedback.ts`, fixtures; depends additionally on G01.06 |
| G02.02 | Validate refs, duplicate members, public/private projection, actual locales | Negative content fixtures; unknown season/time do not become known |
| G02.03 | Build static public discovery index and target registry input | Deterministic output, no paid content or private ratings |
| G02.04 | Publish index/catalog and immutable target-registry export coherently; once feedback is enabled, prepare/activate registry targets | Interrupted publish and stale/unknown-schema cases; first content publication does not require feedback tables |
| G02.05 | Author template for places and collections with one theme vocabulary | Valid authored example and diagnosed invalid example |
| G03.02 | Reuse owned places and guide content as curation input | Narrative/content ownership remains here; G15.02 assembles collections |
| G04.01 | Reserve durable feedback migrations and derived discovery cache boundary | G16.02 owns concrete feedback tables; cache purge cannot touch them |
| G04.03 | Read cached public index; content readiness remains separate | Unknown index never enables Start |
| G06.06–G06.08 | Mixed offer cards, exact/alternative results, voluntary feedback, language availability | Approved UX and prototype before G15.03/G16.03 |
| G08.01 | Reuse device authentication for feedback | No new identity system or privileged client path |
| G09.03 | Allow feedback deletion integration with device lifecycle | G16 owns new-table cascade and retry tests, not a second device endpoint |
| G09.04 | Discovery visibility/opening funnel | Reports label missing consent and do not call impressions ratings |
| G11.01 | Include G15.04/G16.04 acceptance in expanded MVP | End-to-end regression includes existing Run/payment paths |
| G11.03 | Index rollback, feedback retention, private report handling and migration recovery | Runbook/deterministic synthetic drill |
| G11.04 | Disclosures and store language/feature claims match actual release | No claimed public ratings or unavailable UK audio |
| G14.04 | Explicit Ukrainian localization release scope | Child G14.04.a, no duplicate localization epic |

G00 code and result files are unchanged. G01.03 parent/children receive only an integration note: feedback is separate durable state, not a session field or reason to reopen the pending narration decision.

## 3. New tasks and execution graph

Canonical dependencies are in [16](../16_delivery_backlog.md). Agent briefs provide the file scope and tests. All new tasks start as `not-started`.

| ID | Independently reviewable result | Depends on |
|---|---|---|
| [G01.06](../agent-tasks/discovery/G01.06.md) | Validated discovery/feedback contract fixtures and integration audit | — |
| [G15.01](../agent-tasks/discovery/G15.01.md) | Pure deterministic selector | G01.06, G02.01, G00.04 |
| [G15.02](../agent-tasks/discovery/G15.02.md) | Authored places and useful collections | G02.05, G03.02 |
| [G15.03](../agent-tasks/discovery/G15.03.md) | Cached discovery screen/controller and detail transitions | G15.01, G15.02, G04.03, G06.01, G06.08 |
| [G15.04](../agent-tasks/discovery/G15.04.md) | Discovery integration acceptance, publication/Run/privacy regressions | G15.03, G02.04, G09.02 |
| [G16.01](../agent-tasks/discovery/G16.01.md) | Authenticated private feedback API, schema and deletion integration | G01.06, G02.03, G08.01, G09.03 |
| [G16.02](../agent-tasks/discovery/G16.02.md) | Durable own-feedback repository and delivery queue | G16.01, G04.01 |
| [G16.03](../agent-tasks/discovery/G16.03.md) | Voluntary accessible rating/edit/delete UI | G16.02, G06.04, G06.08 |
| [G16.04](../agent-tasks/discovery/G16.04.md) | Author report and feedback integration/retention acceptance | G16.03, G09.04 |
| [G14.04.a](../agent-tasks/discovery/G14.04.a.md) | Ukrainian release package and ordered follow-up tasks | — |

G14.04.a is a planning child that can run before the parent implementation dependencies; it does not make G14.04 complete. G14.08 remains a deferred decision about learned ranking; it has no implementation brief yet because the evaluation input does not exist.

The immediate executable documentation task is G01.06. G14.04.a is also independent planning work. Neither claims that production G02/G15/G16 can start before G00/G01 prerequisites. G01.06 may prepare its fixtures now while explicitly avoiding unaccepted narration types; G02.01 still waits for its original G01 parents.

## 4. Task execution cycle

Each linked brief contains a concrete outcome, allowed file paths, consumed/produced interfaces, numbered acceptance cases and result path. For runtime tasks:

- [ ] Read specs, own brief and predecessor results; inspect actual scaffold and test scripts.
- [ ] Write the smallest behavioral test for the specified failure. Record its command and failing output before implementation.
- [ ] Implement only the owned result, reusing accepted contracts and platform services.
- [ ] Run the same tests; include the negative/security/offline cases listed in the brief.
- [ ] Run applicable existing type/lint checks and the repository Showboat/review policy.
- [ ] Record exact files, commands, expected/actual results and outstanding device/account checks in the result file.

Do not invent `npm test` or a production schema path that the scaffold has not created. G00.04 owns root scripts. Before runtime implementation, expand its brief into executable test steps using those actual scripts and the explicit cases below. This is dependency-aware work decomposition, not a claim that unbuilt platform code already has runnable test commands.

For G01.06 and G14.04.a, the result is a document/fixture contract and consistency evidence. Do not install a mobile stack to validate Markdown or mark hardware checks complete.

## 5. Reference acceptance fixtures

Use synthetic content for executable tests, never copy the reference site's places or imply these are published author choices.

| Fixture | Content | Expected |
|---|---|---|
| A | place, city A, be text, history theme, duration [20,30], order 2 | Exact for be/history/60 |
| B | paid guide, city A, be text/audio, history, [45,75], order 1 | Alternative `over_time` at 60, exact at 120; paid does not boost rank |
| C | place, city A, be text, sea theme, unknown duration | Alternative `duration_unknown` with a time limit |
| D | guide, city B, same other fields | Never exact or alternative for city A |
| E | place, city A, en only | Never silently substituted for explicit be |
| F | collection of A and B, own authored [90,120] | No summed/card-derived duration; no automatic Run |
| G | A with no season assessment | Not exact for explicit autumn; no automatic all-season default |
| H | A with autumn reason but identical points | Valid seasonal recommendation |

Feedback fixture: device A submits guide v1/be score 2 (`audio_problem`), changes to 4 after reconsideration, deletes; device B submits v1/uk score 5. Each target has its own rows and reports. Retries do not increase counts; A cannot read/change B; device deletion removes A from aggregates. UK text-only discovery must never produce UK audio readiness.

## 6. Release order and rollback

1. Contract fixtures and existing content schema/build/publication changes.
2. Selector and authored content; UI after approved G06 designs and cache integration.
3. Private feedback migrations/API before client queue/form. No data collection until Send is visible and disclosure accepted.
4. Internal reports, retention/device-delete, discovery/feedback integration proofs.
5. Expanded MVP acceptance G11.01; public ratings and rating-based ranking remain absent.
6. Ukrainian release after G14.04.a defines and the resulting tasks deliver actual text/audio/UI availability.

Index failure rolls back the catalog pointer, not an active session. Feedback service failure leaves a pending local record; it does not fail playback. Additive DB migrations retain data on rollback. Do not destructively drop feedback tables to undo client UI. Report exports are private and regenerated after deletion. G11.03 owns the operating procedure and synthetic recovery drill.

## 7. Shared-file ownership

Only one task writes `09`, `15`, `16`, `17`, `18`, `21` or root contracts at a time. G01.06 writes its fixture/contract result; G02 writes production content contracts/build; G15.01 owns selector; G15.03 owns discovery integration; G16 owns feedback modules. The future class-map assignment must consume `21` rather than invent competing discovery/feedback classes.

The existing G01.03.a allowed-file list still applies. Its integration note is context, not permission to implement G16. No existing result is rewritten to manufacture completion. If a predecessor changes a shared signature, update producer and every named consumer and re-run the affected cases before marking the task complete.

## 8. Coverage

| Requirement | Tasks |
|---|---|
| D01–D02 immediate authored options/mixed kinds | G01.04, G02.01, G15.02–G15.03 |
| D03–D05 exact/alternative/time/season semantics | G01.06, G15.01, G15.04 |
| D06–D07 paid previews and preserved Run | G06.08, G15.03–G15.04, existing G08 |
| F01–F02 voluntary private feedback and clear target | G16.03, G06.08 |
| F03 durable retry/edit/delete | G16.01–G16.02, G16.04 |
| F04 author-only reports, no automatic ranking | G16.04; future G14.08 |
| L01–L02 honest locale availability and pinning | G02.01–G02.03, G15.04, G16.03, G14.04.a |

Planning completeness is checked through this coverage and the dependency graph. Implementation completeness requires evidence in each task result; unchecked boxes and new documentation do not complete runtime work.
