# architecture-class-map result — class and module map (`19`)

**Status:** `complete` (documentation task; no runtime claim)

The task `docs/agent-tasks/architecture-class-map.md` asked for a concrete implementation map of the accepted component architecture: files, exported names, classes vs pure functions, ownership of every state fact, interface catalogue with TypeScript signatures, diagrams, and scenario walkthroughs — documentation only, no scaffold, no dependencies, no production code.

## Changed files

- `docs/architecture/19_class_and_module_map.md` (created) — the map: §1 decision boundaries (accepted / in-review / unresolved with owner→interface→blocked work), §2 file-and-responsibility map (contracts, core, services, controllers, app, server, tools, web, authoring tool, explicit out-of-scope), §3 interface catalogue (ids, `RunState`, `RunEvent`/`RunCommand`, `AudioService`, `LocationService`, `ContentRepository`, `DownloadService`/`EntitlementService`, `EventLogService`, `Db`/`SuggestionGate`/feedback, `selectDiscovery` verbatim from `21` §4), §4 three Mermaid diagrams (classes, module/trust boundaries, session/player/location lifecycle), §5 single-owner table for the ten required facts plus stale-callback/partial-write rules and the durable/derived/never-resumed classification, §6 eight scenario walkthroughs resolving every call to a catalogue interface, §7 handoff (module→task→predecessor status, what can start now, shared-file exclusivity, missing briefs G01.04/G01.05 — no new IDs, no renumbering), §8 non-duplication statement.
- `docs/16_delivery_backlog.md` (edited) — the "наступнае архітэктурнае заданне" line now points to the finished result; a dated update bullet added.
- `docs/17_development_readiness.md` (edited) — dated update distinguishing the finished module map from pending contracts (G01.02, G01.03.c), platform proof (G00.04, device tails), configuration and design (G06.06–G06.08), and the missing G01.04/G01.05 briefs.
- `docs/architecture/18_component_blueprint.md` (edited) — header note linking the detail level to `19`; blueprint stays the source of boundaries and flows.
- `docs/architecture/readme.md` (edited) — file table row + "пішаш код" entry point now names `19` for signatures and state owners.
- `docs/readme.md` (edited) — architecture table row for `19`.
- `docs/agent-tasks/results/architecture-class-map.md` (this file)

Not changed: `09`, `11`, `15`, `20`, `21`, `run-model/*`, `contracts/` (does not exist yet), fixtures, any code, dispatcher/workflow files.

## Inputs

| Input | Fact |
|---|---|
| Accepted contracts | ADR G01.01 (variant A, #12), ADR G01.03 (#18), `09` v1.1 + §20/§21, `21` + G01.06 fixtures, `11`, `15` R01–R10/P01, `run-model/README.md` + `run-model.mjs` |
| In-flight (treated as NOT approved) | G01.02.a result/ADR on branch `zcode/14` (unmerged) — recorded in `19` §1.2 with the exact boundary the map keeps. Mid-task, origin/main advanced: the G01.03.c sync merged (PR #52), so `09` §6.1 now carries the full `AccessReady` identity; `19` §1.2/§2.2/§7 were updated on rebase (the model-emitted `UnsubscribeLocation`/`ReleaseWakelock` remain absent from `09` §6.1's command list — the map follows the accepted model) |
| Merged mid-task | PR #52 (G01.03.c sync), PR #53 (G00.03.b negative grant checks), PR #77 (discovery briefs published as GitHub issues) |
| Unresolved with owners | G01.02 (audio owner details), G07.04 (R07 thresholds), G00.02.c (`decision-required`, map A/B/C), G00.04 (versions/scaffold), G01.05 (event schema, no brief yet), G01.04 (navigation, no brief yet), G14.04.a package (founder decisions) — table in `19` §1.3 |
| Task file | `docs/agent-tasks/architecture-class-map.md` incl. the 2026-09-13 scope update (consume `20`/`21`/plan; no competing discovery/feedback classes) |
| Repository state | no app code exists; results in main: G00.01.a–c, G00.02.a–c, G00.03.a, G01.01.a–c, G01.03.a–b, G01.06 |

## Checks

| Action | Expected | Actual |
|---|---|---|
| Relative md links in `docs/` resolve | own files resolve | script over 551 links: 0 broken in the seven touched files; 6 pre-existing broken links, all in already-merged files — `results/G00.02.c.md` → `(G01.03-session-access.md)`; `decisions/G01.01-narration-progress.md` → `(18_component_blueprint.md)`; `decisions/G01.03-session-access.md` → `(18_component_blueprint.md)` ×1 and `(21_discovery_feedback_architecture.md)` ×2; `18_component_blueprint.md` → `(G01.03-session-access.md)` (arrived with merged PR #52). Out of this task's file scope, reported to their owners, not fixed here |
| Canonical names | no parallel field names; reuse verbatim | `AccessReady` full identity + `issuer='services/download'`; `heard`/`auto_fired` monotone sets keyed story/stop; `playSeq` write-through; `one_live_session` partial index; `guide_hint_state`/`guide_hint_last`; zone A/B tables; feedback CAS/limits 8 KiB/30-120 rpm; `selectDiscovery` copied verbatim from `21` §4 — spot-checked by grep |
| `selectDiscovery` | identical to `21` §4 | verbatim, including `DiscoveryCriteria`/`DiscoveryResult`/`DiscoveryMatch` |
| Unresolved details gated, not invented | each has owner task + affected interface | `19` §1.3 table; scenario 3 stops at the G01.02 boundary instead of inventing Moment-switch behavior |
| Mermaid | parses as far as tooling permits | no mermaid CLI in the environment (none installed, none installable without network guarantee); syntax kept to plain classDiagram/flowchart/sequenceDiagram constructs and manually checked (labels quoted where Cyrillic/special chars, no colons inside flowchart node labels) — recorded as a stated limitation, not a passed proof |
| `npx tsc --noEmit` / `npm run lint` | N/A | no root `package.json`; no toolchain installed (plan rule: do not install a stack to validate Markdown) |
| jscpd copy-paste gate | 0 clones | `npx --yes jscpd@5.1.2 --config .jscpd.json --no-tips .` → Found 0 clones (0.00%, 20 files / 2414 lines) |
| Showboat | docs-only diff: none of conditions 1–5 | `git diff --numstat` — 646 added lines, all `.md`; 0 runtime source files → no demo created |
| OS / store / server / device | not claimed | not run |

## Code review (own diff, per `code-review.md`)

Scope: `git diff --numstat main...HEAD` — 6 files, all documentation. Lead concern: contract conformance (one canonical name per field; no invented norms).

Findings found and fixed during the pass:

1. [MEDIUM] `19` §1.3 originally listed the 10-minute FocusRegain rule as G01.02-owned; it is already an accepted invariant of `09` §6.1 (only its modeling is pending). Fixed: the G01.02 row now owns pause position / moment return / manual-audio queue, with the focus invariants marked accepted.
2. [MEDIUM] `19` §2.3 stated map-tile readiness as part of package readiness; in [ADR G00.02] §3.1 that is a candidate selection criterion for variant A, not accepted law. Fixed: marked as candidate criterion.
3. [LOW] bare `[21] §N` citations normalized to the repo's `` `21` §N `` style; two mixed-script typos (`legacy-sumяшчальны`, `таблицы`) and one grammatical slip fixed.

```
Summary: 0 critical · 0 high · 0 medium-residual · 0 low-residual (3 findings fixed in-branch)
Verdict: merge — map follows accepted contracts verbatim, gates every unresolved detail to its owner task, adds no parallel names and no new IDs
```

## Not done / honest limitations

- No implementation, no scaffold, no TS files on disk — the interface catalogue lives in Markdown by design of the task.
- No GitHub interactions: this executor has no `gh` CLI and no API access (anonymous REST on the private repo → 404; token reading forbidden by `dispatcher-loop.md`). Therefore no issue claim comment, no `agent:running` label, no PR was created. The branch `zcode/class-map` (rebased onto current `origin/main`) is pushed for the operator/dispatcher instead. The task itself has no published GitHub issue (the architecture-class-map task was never published; the 2026-09-15 publication run covered the discovery briefs only).
- **Task collision (operator decision needed).** While this task was in progress, a parallel branch `origin/zcode/82` appeared: `9195eb0 docs(arch): class/module map 19 — files, interfaces, owners, walkthroughs (AR-5, #82)` — the same assignment executed by another executor against issue #82. No claim was visible on the board at selection time (no `agent:running` was readable without API access, and no branch or result file existed then). This branch is pushed as a second candidate; the operator should choose one, close the other's PR without merging, and keep the result file of the merged one. Nothing here touches #82 or its branch.
- Mermaid rendering unverified by tooling (see Checks).
- The map intentionally leaves `EventMap`, navigation and R07 thresholds as typed boundaries owned by G01.05/G01.04/G07.04.

## Handoff

- First runnable next work is unchanged by this map: contract tasks wait on G01.02 (review) and the G01.04/G01.05 briefs; the G01.03 parent close now awaits only the reverse field-consistency check against G01.02.c; G00.04 owns scaffold/versions; independent device work stays `blocked-external` (G00.03.b is merged, G00.03.c/.d need sandbox accounts); G03.01 (authoring tool) has no predecessors.
- When G01.02 merges, update `19` §1.2/§1.3 (remove the in-review row) in the same change-set as the contract tasks, per §7.3.
- The 5 pre-existing broken links (listed above) belong to the owners of `G00.02.c` and the two ADRs.
