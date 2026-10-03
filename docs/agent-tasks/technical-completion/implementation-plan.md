# Technical completion and eight UI locales Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Follow the repository issue workflow; the plan does not authorize taking an issue or starting a worker. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the uncovered retest defects and provide be/en/uk/de/es/fr/cs/sv interfaces independently of narration availability.

**Architecture:** Generate typed static dictionaries from canonical source/translation data and retain existing service boundaries. UI locale, actual published text availability and explicitly selected audio remain separate facts. Mixed-language session/access changes require the reviewed G21.20 design before G21.21 implementation.

**Tech Stack:** Existing TypeScript, Expo/React Native, Next static export, JSON Schema, Node/Jest, Chromium and Android tools; no new runtime translation dependency.

**Spec:** `docs/specifications/technical-completion/2026-10-03-completion-and-locales.md`.

## Global Constraints

- Work in the current checkout; preserve unrelated edits and claims.
- UI codes: be/en/uk/de/es/fr/cs/sv. Guides appear only when text exists in the selected UI language; audio can be in a separately named explicitly selected language.
- Production content writing/translation/narration and runtime LLM calls are outside the technical tasks.
- One storage/audio/GPS owner; no secret or privileged key in a build, no foreign-locale grant bypass, no fabricated availability.
- Full readiness before Start, pinned content identity, progress preservation and recoverable persistence changes remain mandatory.
- G21.00 publication and G21.20 written-design approval are real prerequisites, not implied by creating an issue. Claimed existing contracts must not be edited.

## Review Focus

1. Unsupported UI code or stale stored setting: approved fallback/error without hidden exposure of an incomplete catalogue — G21.09/G21.15.
2. No selected-language text: a valid localized empty catalogue rather than fallback content or service error — G21.17/G21.22.
3. Different audio locale, stale/corrupt mapping or foreign grant: deny unsafe playback/start and preserve pinned progress — G21.20/G21.21.
4. Missing host filesystem capability or changed EOL: explicit platform evidence without weakening security/integrity — G21.05–G21.08.
5. Long translation, counts, accessibility and restart: readable complete messages and durable selection — G21.10–G21.15/G21.18/G21.19.

## Deliverables and execution steps

The [task index](README.md) and the individual `G21.NN.md` briefs own scope, concrete files, observable criteria, predecessor interfaces and proof. Existing tasks retain their original contracts. New proof names in the briefs are planned deliverables. A worker reads the specification and its brief; it does not infer implementation permission from this index.

For each runtime brief, use this cycle after checking the issue's real prerequisites:

- [ ] Write the smallest behavioral case described by that brief's acceptance/proof, using the actual exported surface and the exact locale/input values specified there.
- [ ] Run that focused case and record the failing output on the unmodified implementation.
- [ ] Implement only the brief's scoped behavior; preserve its incoming contract and document any concrete interface needed by successors.
- [ ] Run the same case, the applicable standard runner, type/layer checks and a controlled revert where required. Record platform limitations and collect real screenshots/device evidence only where relevant.
- [ ] Write `docs/agent-tasks/results/G21.NN.md`, apply the Showboat decision rule and repository review/pre-push checks, then publish through the issue PR workflow.

G21.00 has publication/read-back rather than a runtime test cycle. G21.20 has an approved written language-identity design rather than runtime code. Neither completes another issue implicitly.

## File and interface ownership

- G21.01–G21.04: web language/layout/error/media behavior; retain public route and leak-scan contracts.
- G21.05–G21.08: existing test guard/path/byte/capability/database lifecycle boundaries; retain canonical byte identity and Linux security cases.
- G21.24 owns canonical source/context/schema; G21.09 owns shared pure UI-code/message interfaces and selector adapters. G21.25 owns generation; G21.26 owns revision/completeness checks. G21.19 owns the same-commit authoring/review procedure and glossary.
- G21.10–G21.14: author each new locale in canonical translation data and generate native/web files. Consumers use G21.09 signatures and G21.19 review procedure. Shared source changes include review of all shipped locales in the same commit; an incomplete set is not registered.
- G21.15: UI registry publication, accessible picker and durable UI-locale port composed by existing #491.
- G21.16: schema-owned content locale allowlist and generated wire types; no restated service/web allowlist and no new audio availability without media.
- G21.17/G21.22: exact selected-text-locale filtering and UI chrome; active content pins and direct-link denial retained.
- G21.20: reviewed field/version/migration/access/feedback design consumed verbatim by G21.21; do not invent that contract while implementing a successor.
- G21.18: final functional, semantic and visual evidence across all shipped interfaces. Physical/iOS/store evidence remains distinct from emulator/browser/adapter evidence.

## Self-review and handoff

Every finding from the retest maps to one G21 brief or an existing issue. Shared string/picker files are changed in registry/publish tasks; translators own their separate files. The dependency graph must resolve to real GitHub IDs and be acyclic before handoff. No worker is dispatched by this planning task. Runtime execution requires the repository claim protocol and any explicitly stated written-design approval.

## Translation extension ownership and handoff

Extension specification: `docs/specifications/technical-completion/2026-10-03-single-source-translations.md`. G21.23 (#556) publishes this supplement after the claimed G21.00 (#533); the claimed body/criteria stay unchanged.

- [ ] G21.24 (#557): inventory real messages, define one base/context record and deterministic revision inputs; behavioral schema and revision tests.
- [ ] G21.09 (#542) → G21.25 (#558): preserve typed adapters, then generate safely escaped static catalogues from canonical records and translations; regeneration is deterministic and check mode rejects drift.
- [ ] G21.26 (#559): standard required checks reject missing/stale/unreviewed translations, invalid parameters and stale generated output for all shipped locales; prove failure on controlled omissions and source changes. Fingerprints establish reviewed revisions, not semantic correctness.
- [ ] G21.28–G21.32 (#560–#564): five independent source reports with primary evidence, actual coverage/access/licensing and proposed follow-up requirements. Research is future execution; no corpus/MCP installation is preselected.
- [ ] G21.33 (#565): use the reports to make source-specific use/defer/reject/owner-decision records; reuse or publish independently testable follow-up issues with real report/publication dependencies; read back and check visibility.
- [ ] G21.27 (#566) → G21.19 (#543): require actual lookup evidence when uncertain; demonstrate source edit, all shipped-locale review, provenance, generation and gate in one commit. Unchanged valid wording needs renewed review and a reason.
- [ ] G21.10–G21.14 (#544–#548) consume canonical records and review/generation gates for de/es/fr/cs/sv, then existing publication and acceptance tasks consume them.

Read-only source samples are untrusted reference data. Do not bypass licence/access controls or send private content/secrets to a reference source. The research reports and adoption tasks must distinguish observations from recommendations and a proposed connector from an approved installation.
