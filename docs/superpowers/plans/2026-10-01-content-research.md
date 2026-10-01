# Content research implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for inline execution, or superpowers:subagent-driven-development only if the user explicitly selects delegation. Steps use checkbox syntax. Work in the current checkout; no worktrees. This document schedules work; it does not authorize execution.

**Goal:** Import saved articles into a private local corpus, cheaply annotate them for selection, then extract and review evidence-backed facts only for an explicit research Case.

**Architecture:** Immutable file packages own source material; an independent SQLite database owns machine runs, identity proposals, Cases and author decisions. One shared model boundary validates outputs, reserves cost before attempts and caches by versioned inputs. No stage changes the remote scraper or publishes a Story.

**Tech stack:** Node.js within the repository's `>=22.19.0 <27` engine range, npm `>=10.9.8 <13`, MJS, `node:sqlite`, FTS5, existing pinned Playwright, JSON schemas and `node:test`. Actual model/provider adapter is selected by the owner in G19.08 before G19.04.

**Spec:** [docs/25_content_research.md](../../25_content_research.md). Fields, limits, classifications, privacy modes and editorial gates are owned there; task files reference them rather than introducing alternate contracts.

## Global constraints

- Source identity, URLs, real text/media and private filesystem locations never enter Git, issues or public proof.
- Offline import: no script execution, network access or mutation of original input; first profile `wiki-html/v1`, unsupported templates produce diagnostics.
- Limits: 20 MiB HTML, 50 MiB per image, 200 images/article, 10 000 manifest records, 6000 Unicode code points/fragment, at most three model attempts and one in-flight request.
- Level 1 is unverified selection metadata, up to three hooks/article; no corpus-wide Claim extraction or auto-merging of persons/families.
- Level 2 requires a saved, non-stale, explicitly selected Case; only version-bound author decisions allow facts into script-material export.
- Default model command is dry-run; missing owner data-transfer consent, price/cost cap or budget blocks live calls; uncertain spend remains reserved.
- Author decisions are durable data; index rebuild, model rerun and migration must not erase them.
- No app model calls, route planning, source crawling, graph/vector server, web UI, guide publishing or automatic bulk run.
- Every runtime task follows repository implementation/security/review rules and provides behavioral tests through the actual production boundary.

## File ownership and interfaces

Runtime belongs to `tools/corpus/`; schema and dictionary files also live there, not in the app's public bundle contracts. Search existing helpers before implementing path/hash/JSON/diagnostic utilities. Extract only a genuinely shared utility when needed; do not import collector network code into offline import.

The CLI is `node tools/corpus/cli.mjs <command>`:

| Command | Task | Contract |
|---|---|---|
| `validate-input --manifest PATH` / `validate-run --config PATH` | G19.01 | Validate local JSON; exit 0 or diagnostics/nonzero |
| `unpack --manifest PATH --input-root PATH --library-root PATH` | G19.02 | Safe deterministic package extraction |
| `import --db PATH --library-root PATH` / `backup` / `restore` | G19.03 | Register complete packages and recoverable snapshots |
| `annotate --db PATH --config PATH [--execute]` | G19.04 | Dry-run unless execute is explicit and policy accepted |
| `search` / `case-create` / `case-select` | G19.05 | Filters and revision-pinned selection |
| `claims --db PATH --case ID --config PATH [--execute]` | G19.06 | Budgeted extraction limited to a Case |
| `review` / `correct` / `export --mode private|public-status` | G19.07 | Version-bound decisions and isolated export modes |
| `pilot --db PATH --manifest PATH --config PATH --case ID` | G19.09 | Owner-authorized private pilot; no bulk mode |

Paths in the table are argument metavariables, not commands to run before inputs exist. Final usage/options belong to `tools/corpus/README.md` in G19.09. No task may silently broaden another command's permissions.

## Review focus

| Failure/input | Owned check |
|---|---|
| One HTML paragraph contains the whole article; nav and captions share its container | G19.02 body preservation and nav-exclusion tests |
| Windows junction or encoded/non-ASCII path escapes the input root | G19.02 confinement and diagnostics tests |
| Same surname refers to different people or a family | G19.03 unresolved/separate identity persistence; G19.09 private collision review |
| Provider timeout after spend, or crash between response and commit | G19.04 persisted reservation/cache recovery; G19.09 restart |
| Correct evidence quote accompanies an unrealized plan or stale author decision | G19.06 modality checks; G19.07 version-bound approval/export |
| A public report leaks nested source names/paths or reversible identifiers | G19.07 nested privacy/opaque-ID tests; G19.09 source-free report |

## Execution order

G19.00 publishes this plan, specification and briefs to the default branch. All work remains backlog until the owner explicitly authorizes execution and sets the relevant status.

```text
G19.00 → G19.01 → G19.02 → G19.03 ─┐
               └→ G19.08 ─────────┤
                                 ↓
          G19.04 → G19.05 → G19.06 → G19.07 → G19.09
```

G19.08 is owner-input tracking, not a permission for an agent to grant consent or acquire credentials. Its missing resources need not block schema/import/storage work. Do not run tasks concurrently when they share `cli.mjs` or the same issue.

## Task briefs

| Task | Independently reviewable deliverable |
|---|---|
| [G19.00](../../agent-tasks/research/G19.00.md) | Documents published and readable in the runner's default-branch checkout |
| [G19.01](../../agent-tasks/research/G19.01.md) | Validated contracts, synthetic fixtures, dictionaries and test wiring |
| [G19.02](../../agent-tasks/research/G19.02.md) | Safe immutable article/image packages |
| [G19.03](../../agent-tasks/research/G19.03.md) | Durable database and restore proof |
| [G19.04](../../agent-tasks/research/G19.04.md) | Shared budgeted model runner and level-1 annotation |
| [G19.05](../../agent-tasks/research/G19.05.md) | Search, suggested threads and explicit Case selection |
| [G19.06](../../agent-tasks/research/G19.06.md) | Case-limited facts/relations with exact quotes |
| [G19.07](../../agent-tasks/research/G19.07.md) | Author decisions and private/public-status export separation |
| [G19.08](../../agent-tasks/research/G19.08.md) | Actual private inputs and owner model policy |
| [G19.09](../../agent-tasks/research/G19.09.md) | Actual pilot, editorial cost report and bulk-use verdict |

Each linked brief specifies exact files, exported interfaces, behavioral assertions, out-of-scope boundaries and its proof. Those briefs are the implementation steps for this plan, not completed results.

## Verification and handoff

- [ ] Run the task's real behavioral suite first against the missing behavior, then after implementation. Mock only the external model transport, never schema validation, persistence or editorial gates.
- [ ] Run `npm test`, `npm run typecheck`, `npm run arch:check`, then `npx --yes jscpd@5.1.2 --config .jscpd.json --no-tips .` on the final implementation; run `npm run ledger:check` for documentation changes. Fix actual failures; never weaken gates.
- [ ] Record Showboat proof when required, using synthetic input only. Record live-model quality and cost separately in the private pilot; a synthetic response cannot satisfy G19.08/G19.09.
- [ ] Read back task/issue dependencies and compare every acceptance criterion against the results file. A publication pointer alone is not a completed implementation.
- [ ] Preserve owner execution choice. Implementation starts only after review of these written documents and explicit authorization; creating GitHub backlog items does not select workers or enable the dispatcher.
