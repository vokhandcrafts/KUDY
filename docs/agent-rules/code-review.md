# Code review policy

This file is the single source of truth for Codex, Claude Code, and Cursor.
Apply it whenever you are asked to review a diff, a PR, a branch before merge, or code you
or another agent just wrote — and as a self-check before reporting an implementation task
as done.

A review answers two questions: **does this hold when the input, the network, or the device
misbehaves**, and **does it match the contracts already agreed in `docs/`?** Everything else
is secondary.

## 1. Scope first — never review blind

State in one line before reading anything:

- **What is the diff?** `git diff --numstat <base>...HEAD` for committed work, `git diff` for
  uncommitted. If the user named a branch, PR or path, use that. Never review the whole repo.
- **What is the primary concern?** Contract conformance / correctness / security / performance.
  Pick one as the lead — it decides what you read deeply; the rest still get checked.

If scope is genuinely ambiguous, ask once instead of producing a 40-item report.

## 2. Automated pre-checks — before reading a single line

```bash
git diff --numstat <base>...HEAD     # size and shape of the change
git log --oneline <base>..HEAD       # stray merges, unrelated work, secrets in messages
npx tsc --noEmit                     # no NEW type errors vs the baseline
npm run lint                         # if the package defines it
```

Plus, by hand on the diff:

- **Secrets.** Supabase service-role keys, RevenueCat secret keys, signing keys, tile-provider
  or CDN tokens, `.env*` files, anything that looks like a JWT. A hit is CRITICAL and stops
  the review. Note the split explicitly: the Supabase **anon** key belongs in the client, the
  **service-role** key never does — it lives only in an Edge Function.
- **Dependencies.** Every new entry in `package.json`: is it maintained, is the version
  pinned, does it duplicate something already there, and is the licence usable? The reference
  projects are read-only inspiration — Tramio is AGPL and TourForge is unlicensed, so
  **copied code from either is CRITICAL**, not a style note.
- **Forbidden list.** Check the change against §17 of `docs/architecture/09_technical_architecture.md`.
  That document outranks "how it is usually done".

## 3. Diff-first reading strategy

- **< ~150 changed lines** — read every touched file in full.
- **larger** — read the diff, then open in full only: every module whose behaviour changes,
  every contract type or schema touched, every place that persists or migrates data, and any
  file the diff calls into for the first time. Skip pure formatting churn.
- Always open the file a new helper is added *to*, not just the hunk — duplicate helpers hide
  there and are the cheapest finding to catch early.

## 4. What to check

### Contracts and layering — the KUDY-specific part

- **One canonical name per field, one owner.** A contract field renamed or shadowed in a
  second file is HIGH: `docs/17_development_readiness.md` calls this out as the main risk of
  parallel agent work. Names must match the G01 contracts, not paraphrase them.
- **Layer boundaries hold**: pure engine/pipeline · controllers · OS/network services · UI.
  A `fetch`, a GPS call, a filesystem write or a Supabase client inside engine or UI code is
  a finding regardless of how well it works.
- **Irreplaceable progress is separated from the rebuildable cache.** Anything that writes
  to local storage must make clear which of the two it is; a change that lets a cache purge
  take user progress with it is CRITICAL.
- **Bundle format is a public contract.** Content JSON must validate against the schema —
  no field invented at the call site because it was convenient.
- **No LLM at runtime.** No model call, no API key, no prompt in the app. This is decided,
  not a preference.
- **No coordinates in analytics.** Events are consent-gated and location-free.

### TypeScript / React Native

- No new `any` and no `as` cast that hides a real mismatch; `strict` stays on. A cast added to
  silence `tsc` is a finding, not a fix.
- Errors are handled where they can be acted on: no empty `catch`, no promise left unawaited,
  no `.catch(console.log)` standing in for real handling.
- Cleanup on unmount — subscriptions, timers, listeners, audio and location watchers. A
  background GPS or audio watcher that outlives its screen is HIGH (battery, and it is exactly
  the native-side risk the architecture flags as un-fixable by OTA update).
- Re-render cost: work inside `render`, a new object or arrow function passed as a prop into a
  list row, a `useEffect` whose dependency array re-triggers every frame.
- Lists are virtualised and paginated; no full-collection render.

### Offline, permissions and platform

- Every network call has a defined offline behaviour: cached, queued, or a stated user-visible
  failure. "It throws" is not a behaviour.
- Permission denial (location, notifications, audio focus) has a path through the UI — not a
  crash and not a silent no-op.
- Interruptions are handled: incoming call, another app taking audio focus, app backgrounded
  mid-run, device rebooted mid-run.
- Signed media URLs are short-TTL and minted server-side; a client that builds or caches a
  long-lived URL is CRITICAL.
- Anything the diff claims about platform behaviour (background GPS, store sandbox, storage)
  needs an actual check on a device or a stated "not verified" — an assumption presented as a
  fact is a finding on its own.

### Supabase, SQL and migrations

- Row Level Security is on for every new table, and the policy is in the diff. A table added
  without a policy is CRITICAL.
- Client access goes through authorised operations / Edge Functions; the client never gets a
  privileged path "for now".
- Every `UPDATE` / `DELETE` has a selective `WHERE`. No exceptions.
- Migrations are reversible, or the diff states why not. A destructive migration with no
  backup or rollback note is CRITICAL.
- No `SELECT *` in code that persists or serialises the result.

### Payments

- The server verifies entitlement against RevenueCat; the client's word is never the grant.
- Purchase **and restore** are both handled; restore-only-later is a HIGH gap, not a TODO.

### Tests

- The diff adds a test that fails if the change is reverted. If you cannot name that test,
  say so — it is a HIGH finding.
- Tests assert behaviour, not implementation details. One passing Node test does not prove a
  platform, a store, or storage works — do not let a test's existence be read as that proof.

### Recurring corpus classes — `docs/agent-rules/lessons-learned.md`

The closed-PR corpus (52 merged PRs → 369 findings, 2026-09-19) ranks the defect classes
that actually recur. Each has a prevention rule in `implementation-rules.md`; the
reviewer-side minimum:

- Re-run the default test command; every count and status the diff's docs or PR text
  claims must match the fresh output (57 stale-claim instances in 25 PRs).
- Open every relative link and `§`-citation the diff adds (24 instances).
- For every new or changed validation rule, name the negative test that fails when the
  rule is removed, and feed the parser corrupt input — diagnostics, not a crash
  (64 instances across corpus classes 3–4).
- Trace one new test end-to-end to the production entrypoint; a helper that pre-processes
  inputs in a way production never does voids the test. Diff the mock vs live
  negative-case lists (19 instances).
- Walk the task card's acceptance criteria against the results doc line by line
  (17 instances).
- Run the mixed-script grep from `implementation-rules.md` rule 12 over added
  human-facing text (24 instances).

## 5. Output format

Group by severity, most severe first. One block per finding:

```
[SEVERITY] <file>:<line> — <one-sentence claim>
Why it matters: <the concrete failure — what breaks, what leaks, what the user loses>
Fix: <the concrete change, with a short snippet where it helps>
```

- **CRITICAL** — a secret in the diff; copied AGPL/unlicensed reference code; a table without
  RLS; a privileged key or path in the client; user progress that a cache purge can destroy;
  a long-lived media URL; a destructive migration with no rollback.
- **HIGH** — a contract field renamed or duplicated; a layer boundary crossed; a leaked
  watcher/subscription; unhandled offline or permission-denied path; entitlement trusted from
  the client; no test that would catch the regression.
- **MEDIUM** — duplicated logic, wrong layer for a helper, missing type, avoidable re-render,
  missing pagination.
- **LOW** — naming, comments, formatting. Cap at five; nobody reads more.

Close with:

```
Summary: N critical · N high · N medium · N low
Verdict: merge / merge after fixing the CRITICAL+HIGH items / needs rework — <one line why>
```

## 6. Review discipline

- **Report only what you verified.** Did not open a file, did not run a check, had no device?
  Say so plainly. An unverified claim stated as a fact is worse than a gap.
- **Quote real lines.** Every finding names a file and line that exists in the diff.
- **No praise padding**, no "great work overall", no restating the diff back. A clean diff
  gets the summary line and the verdict, nothing more.
- **Reviewing and fixing are separate passes.** Do not rewrite the code under review unless
  asked — an agent that edits its own baseline can no longer report on it.
- A review is not an implementation task, so it does not by itself trigger the Showboat
  policy in `showboat.md`. Fixing what the review found may.
