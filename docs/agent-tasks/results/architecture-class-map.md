# architecture-class-map result — class and module map (`19`, AR-5 / issue #82)

**Status:** `complete` (documentation task; no runtime claim)

The assignment `docs/agent-tasks/architecture-class-map.md` (tracked as issue #82, action item AR-5 of the 2026-09-15 technical architecture review, doc 22 / PR #84) asked for a concrete implementation map of the accepted component architecture: files, exported names, classes vs pure functions, owners of every state fact, an interface catalogue with TypeScript signatures, diagrams, and scenario walkthroughs — documentation only, no scaffold, no dependencies, no production code.

## History

1. **Author pass** (executor session of branch `zcode/82`, commit `9195eb0`): the map itself and the five link updates.
2. **Review-fix pass** (this commit, operator-instructed): PR #91 was reviewed against `docs/agent-rules/code-review.md` with contract conformance as the lead concern; the findings below were fixed in this same branch, per the rule that review findings are fixed in the same branch, never in a duplicate PR.

## Changed files

- `docs/architecture/19_class_and_module_map.md` — the map: §1 accepted sources / open contracts with owners / AR-5 single owner of position-acceptance rules, §2 file-and-responsibility map (core, controllers, services, server, contracts, tools, web, UI, explicit omissions), §3 interface catalogue (`RunEvent`/`RunCommand`/`step`, `AccessReady` capability port, location/pipeline, audio (gated by G01.02), content/download/readiness, closed grant error list, durable transactions, discovery/feedback canon), §4 three Mermaid diagrams, §5 single-writer ownership, stale-callback and partial-write rules, durable vs rebuildable zones, §6 eight walkthroughs, §7 handoff with shared-file exclusivity.
- `docs/16_delivery_backlog.md`, `docs/17_development_readiness.md`, `docs/architecture/18_component_blueprint.md`, `docs/architecture/readme.md`, `docs/readme.md` — links to the result and the "finished / still gated" distinction (their diffs also fix the pre-existing broken `ADR G01.03` link in `18`).
- `docs/agent-tasks/results/architecture-class-map.md` (this file).

## Review-fix pass (this commit)

| Finding (severity) | Disposition |
|---|---|
| [HIGH] §5.4 placed the pending event queue in zone A (rebuildable) | fixed — `event_queue` moved to zone B with the `09` §7 rationale (dedup/storage do not require consent); `catalog_cache` added to zone A; cache purge can no longer be read as destroying queued events |
| [MEDIUM] no result file | fixed — this file |
| [MEDIUM] `Start` event payload presented under "Канон: 09 §6.1" | fixed — the union now states explicitly that the payload is the reducer-level form of the accepted model's `start()` inputs (ADR G01.03 §3.3), while `09` §6.1 lists `Start` without fields; the map's addition is not a second canon |
| [LOW] "lock-screen таймаўт 10 хв" mischaracterized the 10-minute rule | fixed — named as the FocusRegain window (invariant 5 of `09`) |
| [LOW] mixed-script and broken tokens (Idempotentнасць, Persistэнтнасць, checkpайнт, стал-result, прыняцатага, узброіванне, пісы, стагінг, Никад, на хэшам, пише, у бэклозе ўяўлены, "пр такаж") | fixed |

Not changed in the fix pass: contract names and semantics (they already matched the accepted sources), diagrams, walkthrough logic, task mapping.

## Inputs (verified during review)

| Input | Fact |
|---|---|
| Accepted contracts | ADR G01.01 (variant A), ADR G01.03, `09` v1.1 incl. the merged G01.03.c sync (PR #52), `21` + G01.06 fixtures, `11`, `15` R01–R10, `run-model` |
| Grant error codes | not invented — each code in §3.6 matches the merged spike server logic (`spikes/G00.03-sandbox-grant/server/`) |
| Unresolved with owners | G01.02 (audio owner, result on branch `zcode/14`, not merged → not approved), G01.04/G01.05 (no briefs), G00.02.c (`decision-required`), G00.04 (versions/scaffold), G07.04 (R07 thresholds), G06.06–G06.08 (design) |

## Checks

| Action | Expected | Actual |
|---|---|---|
| Contract-name conformance | no parallel names; reuse verbatim | `AccessReady(route_id, version, locale, tier, stop_ids[], issuer='services/download')` verbatim; monotone `heard`/`auto_fired`; `play_seq` write-through; zone A/B per `09` §7 (after the fix); R07 tables; `migration_log`; feedback CAS/limits; `selectDiscovery` canon |
| Relative md links in `docs/` | resolve | script over all `docs/**.md`: 0 broken in this branch's files; the pre-existing broken links that remain belong to already-merged files outside this task's scope (`G00.02.c` result, two ADRs) |
| Mermaid | parses as far as tooling permits | standard classDiagram/flowchart/sequenceDiagram constructs; no mermaid CLI in the environment — manual check, recorded as a stated limitation |
| `npx tsc --noEmit` / `npm run lint` | N/A | no root `package.json`; no toolchain installed (documentation-only task) |
| jscpd copy-paste gate | 0 clones | run at branch level, 0 clones (diff is `.md`-only; formats scanned are js/ts) |
| Showboat | docs-only diff: none of conditions 1–5 of `docs/agent-rules/showboat.md` | `git diff --numstat` — all `.md`; 0 runtime source lines → no demo created |
| OS / store / server / device | not claimed | not run |

## Not done / limitations

- No implementation, no scaffold, no TS files on disk — the interface catalogue lives in Markdown by design of the assignment.
- This executor session has no `gh` CLI and no GitHub API access (private repo → anonymous 404; token reading forbidden by `dispatcher-loop.md`): no labels or PR comments were written; the branch is pushed and PR #91 is left to the operator/dispatcher.
- Mermaid rendering is manually checked, not tool-verified.
- The map intentionally leaves `EventPayload`, navigation and R07 thresholds as typed boundaries owned by G01.05/G01.04/G07.04.

## Handoff

- Next concrete task per the map's §7: the audio-ownership contract line (G01.02 — its drafted result on `zcode/14` awaits review; the map treats it as open until merged), then the G01.04/G01.05 briefs.
- Shared-file exclusivity and the frozen `run-model` rule hold as stated in `19` §7.2.
