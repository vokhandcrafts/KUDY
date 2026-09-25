# G05.01.d — model parity and invariant properties

*Showboat demo for issue #201 (`core/engine`), created 2026-09-25.*

<!-- showboat-id: g0501d-model-parity -->

The production reducer `core/engine/reducer.ts` is proven answer-identical to
the frozen documentation model `docs/run-model/run-model.mjs`. The demo runs
the two proofs the issue demands; both are deterministic and print their own
counts.

First, the count comparison: every scenario the model suite registers (67)
must also run in the ported parity suite under the model's own title — the
tool runs both suites end to end and compares the title sets:

```sh
node tools/engine-regressions/parity-count.mjs
```

```output
the model registers 67 scenarios; the ported suite registers 76 tests — all 67 model scenarios are ported, plus 9 property tests.
PARITY COUNT: 67/67 — every model scenario is ported.
```

Second, the mutation run: each of the model's 21 reviewed regressions is
applied to a byte-identical temporary copy of the engine, and the named
model-parity test guarding the broken property must turn red. The repository
engine is never touched:

```sh
node tools/engine-regressions/check-regressions.mjs
```

```output
HARNESS: the unmutated copy passes its guard.
CAUGHT: consume queued stop before playback — C8: queued stop remains eligible and plays after current audio
CAUGHT: erase heard during replay — C7/C11: interrupted replay preserves heard and finish summary
CAUGHT: autoplay manually completed stop — C12: manually completed stop does not autoplay on later arrival
CAUGHT: credit extended together with base — G01.01.b: extended is credited only by its own finished playback
CAUGHT: swap primary to extended after unlock — G01.01.b: base heard stays heard after same-version unlock; no new Play
CAUGHT: accept completion from another session — C10: equal play numbers from different sessions do not collide
CAUGHT: accept completion from earlier playback — C10: old completion cannot finish a replay of the same story
CAUGHT: validate story id by truthiness instead of presence — G01.01.b: completion with present-but-empty or null story id is ignored
CAUGHT: accept a foreign moment completion — G01.02.b (§4.12): moment → moment leaves one sound; the old token is ignored entirely
CAUGHT: credit a moment teaser to guide history — G01.02.b (§4.3): moment finished frees the player without crediting history or automation
CAUGHT: resume a stale or closed launch — G01.02.b (§4.12): moment → moment leaves one sound; the old token is ignored entirely
CAUGHT: stop a moment on session pause — G01.02.b (§4.9): a session pause touches only the walk; a moment keeps sounding
CAUGHT: treat a manual pause as a full stop — C18/C19/C20: UserPausedAudio is a live pause that blocks arrivals until explicit Play
CAUGHT: accept stale queued location — C22: stale position retires queue without playback
CAUGHT: play locked stop manually — C33: locked preview is excluded from manual and automatic playback and remaining list
CAUGHT: autoplay locked stop — C33: locked preview is excluded from manual and automatic playback and remaining list
CAUGHT: activate a different content version — C35: catalog version change cannot unlock or replace active session content
CAUGHT: accept a grant for another route — G01.03.b: grant for another route is ignored entirely
CAUGHT: accept a grant for another locale — G01.03.b: grant for another locale is ignored entirely
CAUGHT: accept a grant from a foreign issuer — G01.03.b: grant from a non-download issuer is ignored entirely
CAUGHT: start without verified layers — G01.03.b: start refuses a package claiming no verified layer or an unknown layer
21/21 reviewed regressions rejected by the named guards. Repository engine unchanged.
```

The parity suite itself (67 ported scenarios + 9 property tests, including the
depth-4 exhaustive enumeration of 69 904 transitions) is wired into
`npm test` through the `core/**/*.test.ts` glob:

```sh
node --test --experimental-strip-types --test-reporter=spec core/engine/model-parity.test.ts 2>&1 | grep -E "^ℹ (tests|pass|fail)"
```

```output
ℹ tests 76
ℹ pass 76
ℹ fail 0
```
