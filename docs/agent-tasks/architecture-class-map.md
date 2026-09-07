# Task: Define KUDY's classes, modules and interface contracts

**Recommended model class:** strong.
**Deliverable:** documentation, not application implementation.
**Status:** ready for architectural documentation; unresolved product and platform decisions must remain explicitly gated.

## Assignment

Turn the existing component architecture into a concrete implementation map: which classes, interfaces, pure functions and modules should exist; which files own them; how they communicate; and who owns each piece of state and each resource's lifecycle.

Work autonomously on the documentation. Do not scaffold the application, install dependencies, implement production code, create threads, or execute the development backlog. TypeScript signatures and small illustrative data examples inside Markdown are appropriate. Do not turn every component into a class merely to produce a class diagram.

## Read first

Read the repository's current `AGENTS.md`, then:

1. [Component blueprint](../architecture/18_component_blueprint.md): boundaries, ownership, flows and trust zones.
2. [Technical architecture](../architecture/09_technical_architecture.md): services, API, engine, storage and constraints.
3. [Accepted decisions and proposals](../15_guide_decisions.md): R01–R07 versus P01–P03.
4. [Run interaction contract](../11_run_interaction.md), [user journeys](../03_user_journeys.md) and [product structure](../01_product_structure.md).
5. [Development readiness](../17_development_readiness.md), [delivery backlog](../16_delivery_backlog.md) and [atomic tasks](atomic/README.md).
6. Any actual G01/G00 results under `docs/agent-tasks/results/` and decisions under `docs/architecture/decisions/`. Check whether they exist and are approved; never infer completion from a task file.
7. [Executable model limitations](../run-model/README.md), and the model itself where needed to verify current names and behavior.

The project root is `C:/Users/kamyl/WebstormProjects/KUDY`. Work in the current checkout without worktrees or overwriting unrelated changes. Inspect actual files before treating planned paths as existing code.

## Product context that must survive the design

- KUDY is an authored city guide. City → Guides → selected guide is one entry point; other city sections need not be walking routes.
- A guide consists of independently playable stories at stops. Visitors may start anywhere, use any order and end after any story. Recommended route geometry never gates playback.
- Automatic audio belongs only to the explicitly started active guide. Manual Play is independent of proximity. Interrupted audio may restart from the beginning; interruption is not completion.
- One physical player and one location-service owner. Opening a Moment does not play it. The detailed guide/Moment ownership proposal P02 must use its actual approval status.
- Nearby-guide suggestions R07 are silent foreground UI. They do not start another guide, interrupt audio, modify playback ownership or restart location during a paused session. Deferred suggestions recheck freshness and proximity before display; local dismissal limits work without analytics consent.
- Full verified selected-content download is required before Start. Payment, authorization, download readiness and listening progress are distinct facts.
- Locked stops expose public previews only. The server authorizes private files against the exact permitted manifest, not a client flag or arbitrary path.
- Sessions pin content versions until End. Progress is durable; cache recreation must not erase it. Late callbacks must not mutate another playback or session.
- Local playback/progress must work without analytics consent. No coordinates or secrets in analytics. No LLM at application runtime.
- Imported guides are a future direction. Preserve a safe origin/identity boundary without building an importer, plugin system or marketplace now.

## Required documentation

Create `docs/architecture/19_class_and_module_map.md`, with the following sections:

### 1. Design status and decision boundaries

Distinguish accepted architecture, recommendations, and unresolved G01/G00 decisions. Reuse completed contracts verbatim where appropriate. Do not invent approved story-progress semantics, playback tokens, SDK versions or offline-map provider choices.

Proceed with independent boundaries even when a detail is unresolved. For each unresolved detail, name the exact owning atomic task, the affected interface and the implementation it blocks. Avoid parallel alternative field names scattered through the document. If a concrete product choice needs the founder's decision, prepare the proposal and consequences before asking; do not ask to reconfirm settled R01–R07 rules.

### 2. File and responsibility map

For each required unit specify:

- Exact proposed file path and exported name.
- Whether it is a class, interface/type, pure function, service module, controller or UI component, and why.
- One concrete responsibility and explicit exclusions.
- Inputs, outputs, dependencies and consumers.
- State it owns versus state it only reads or derives.
- Creation, active use, cleanup and restart behavior where relevant.
- Implementing backlog/atomic task and required predecessor contracts.

Cover engine, location pipeline, playback coordination, audio and location adapters, content repository, downloads, entitlement integration, persistence, event queue/consent, nearby suggestions, controllers, UI boundaries, server grant/auth, content validation/building, and the public web reader. Keep authoring tools separate from application runtime. Document future-only units as out of scope rather than creating speculative classes for them.

### 3. Interface catalogue

Use concise TypeScript declarations in Markdown for the public boundaries that agents need to share: commands/events, reducer input/output, tagged audio callbacks, location input, content lookup/readiness, download activation, persistence transactions and authorization responses.

Define every referenced custom type in the catalogue or link to its canonical contract. For each operation specify synchronous/asynchronous behavior, success and error outcomes, idempotency, cancellation and stale-result rejection where applicable. Distinguish missing permission, missing entitlement, unavailable verification, incomplete content and invalid input.

Do not include full implementations, dozens of trivial getters, an abstract base-service hierarchy, a generic event bus or a dependency-injection framework without a demonstrated need. Classes suit owned mutable resources; pure domain transitions should remain functions.

### 4. Diagrams

Add focused Mermaid diagrams:

- Classes/interfaces and their relationships, using composition unless inheritance has a concrete justification.
- Allowed module dependencies and trust boundaries; no circular dependencies or UI/core access to OS/network/storage directly.
- Lifecycle of session, player and location ownership across Start, manual playback, pause, interruption, End and restart.

Do not duplicate the whole component blueprint. Link to it and show the additional class/module-level detail.

### 5. Ownership and consistency rules

Give one authoritative owner for session progress, playback identity, audio focus, queued triggers, current inspected content, content version, verified asset readiness, authorization, suggestion dismissal state and consent.

Explain how events reach the owner, how effects are performed, and how stale callbacks and partially completed writes are handled. Identify which data lives in durable storage, which can be rebuilt, and which must never be resumed automatically. No independently mutable copies of the same business fact.

### 6. Scenario walkthroughs

Trace named methods/events and state owners for:

1. Ready package → explicit Start → any eligible stop → audio completion.
2. Manual replay interrupted halfway without erasing earlier progress.
3. Guide audio → open Moment → explicit Moment Play → return to guide, respecting P02's approval status.
4. Purchase succeeds → download fails → retry → same-version activation without automatic audio.
5. Old audio/download callback arrives after End and a new session.
6. Restart with a pinned old version while the catalogue points to a new version.
7. Nearby-guide suggestion deferred during audio, followed by departure from the area or dismissal.
8. No location permission or analytics consent, with manual playback and local progress preserved.

Every call in a walkthrough must resolve to an interface in the catalogue. If an interaction still depends on a pending decision, identify that boundary explicitly rather than silently completing the story with invented behavior.

### 7. Handoff to implementation agents

Map modules/interfaces to existing tasks. State which tasks are implementable now, which need G01 decisions, which require G00 platform evidence, and which need approved UI designs G06.06–G06.08.

Identify shared files that must not be edited concurrently. A task should have one independently reviewable result. If the mapping exposes a missing or oversized task, propose or add a bounded child task with stable identity and update the affected dependency references; do not renumber the entire backlog or pretend every future task is implementation-ready.

## Files to update

- Create `docs/architecture/19_class_and_module_map.md`.
- Update `docs/16_delivery_backlog.md` with a prominent link to the result and narrowly necessary ownership/dependency changes.
- Link the result from `docs/architecture/18_component_blueprint.md`, `docs/architecture/readme.md` and `docs/readme.md`.
- Update `docs/17_development_readiness.md` to distinguish a finished module map from pending contracts, platform proof, configuration and design.
- Modify existing contracts or task briefs only where required to remove a demonstrated contradiction; preserve unrelated changes and clearly record the reason.

Do not mark G01 or G00 complete merely because this architecture document exists.

## Verification and completion

Before reporting completion:

- Check local links, Mermaid syntax as far as available tooling permits, task identifiers and dependency cycles.
- Trace every public interface to a producer and consumer, every state field to one owner, and every walkthrough call to a declared signature.
- Check names against actual approved G01 results and current documentation; report unresolved decisions precisely.
- Review lifecycle cleanup, stale callbacks, authorization boundaries, durable/cache separation and consent independence.
- Read applicable repository review/proof policies. Do not install a TypeScript toolchain just to test Markdown declarations or call documentation checks proof of OS/store behavior.

Report the resulting file, what is ready for implementation, what remains gated, and the exact next runnable task. Keep the user-facing explanation in Belarusian. No application implementation is required for this assignment.
