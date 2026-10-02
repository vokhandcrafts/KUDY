# G20.19 — the schemas stay the wire-type owner: deterministic generation and a stale-output gate

*2026-10-02 by Showboat 0.6.1*

The contracts schemas are the single owner of the catalog/bundle wire formats
(specification §V4). The new generator (`tools/contracts/generate-wire-types.mjs`,
issue #490) projects them verbatim into `contracts/wire/wire-types.ts`: the
locale allowlist is derived from `localized-text.schema.json` (its canonical
owner, never a second hand-written list), and the generator fails closed with a
named diagnostic when a mirroring schema drifts from that owner. The committed
output is type-only; identifier patterns, limits and the stop `allOf`
conditionals stay runtime work of `contracts/reader.mjs` — this projection does
not replace that validation.

Freshness gate, live:

```sh
node tools/contracts/generate-wire-types.mjs --check
```

```output
wire-types: OK (fresh)
```

Repeated generation is byte-identical to the committed file — the deterministic
consumers never see a diff:

```sh
rm -rf .scratch/wire-demo && mkdir -p .scratch/wire-demo
node tools/contracts/generate-wire-types.mjs --out .scratch/wire-demo/a.ts >/dev/null
node tools/contracts/generate-wire-types.mjs --out .scratch/wire-demo/b.ts >/dev/null
cmp .scratch/wire-demo/a.ts .scratch/wire-demo/b.ts && cmp .scratch/wire-demo/a.ts contracts/wire/wire-types.ts && echo "identical: two runs and the committed file"
```

```output
identical: two runs and the committed file
```

The guard suite (wired into `npm test` via the `tools/contracts/*.test.mjs`
glob) proves the two failure modes the task demands: a schema or locale-owner
change turns `--check` red until regeneration, and an owner/mirror divergence
fails closed:

```sh
node --test --test-reporter=tap --experimental-strip-types tools/contracts/wire-types.test.mjs 2>/dev/null | grep -E "^(ok|# (tests|pass|fail))"
```

```output
ok 1 - wire-types wiring is guarded (package.json scripts, npm-test glob, committed output)
ok 2 - committed wire-types output is fresh (--check passes on HEAD)
ok 3 - repeated generation is byte-identical to the committed output
ok 4 - a locale-allowlist change fails the check until regeneration (owner: localized-text)
ok 5 - a catalog-schema field change fails the check until regeneration
ok 6 - a mirror schema diverging from the locale owner fails closed with a named diagnostic
ok 7 - a corrupt schema file yields a named diagnostic, not a stack trace
ok 8 - the committed projection keeps the v1-only shapes and the generated header
# tests 8
# pass 8
# fail 0
```

Read back: the committed projection is fresh against the schemas as committed;
regenerating twice reproduces the committed file byte for byte; the committed
guard suite runs the real CLI against sandbox schemas and shows both named
failure modes plus the wiring guard, so removing the scripts, the npm-test glob
or the generation itself turns a committed check red.
