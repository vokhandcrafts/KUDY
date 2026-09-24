# G06.09.b — composition root, controller store and layer rules

*2026-09-24T00:40:21Z by Showboat 0.6.1*
<!-- showboat-id: 729c8697-62ea-463a-b5c1-c6e9823fe012 -->

Issue #209 G06.09.b: the composition root (controllers/createServices.ts) is the one place that constructs services from explicit ports, a zustand store helper is the single import point of the pinned store (ADR G00.04 §6: 5.0.15), and the sample controller driven here runs end to end in plain Node — fake ports in, real services/contentRepo out, no React and no React Native. The same root builds the app: app/_layout.tsx calls createServices(devicePorts) and provides it to screens via context (device adapters land with G05.02.c/G05.03.b/TR-10; until then the app port set is empty — no fake stands in for a device adapter).

```python
import subprocess, re

r = subprocess.run(
    ["node", "--no-warnings", "--test", "--experimental-strip-types",
     "--test-reporter=spec", "controllers/sampleController.test.ts",
     "controllers/wiring.test.ts"],
    capture_output=True, text=True,
)
out = r.stdout + r.stderr
out = re.sub(r" \([\d.]+ ?m?s\)$", "", out, flags=re.M)
out = re.sub(r"^(ℹ duration_ms) .*$", r"\1 <stripped>", out, flags=re.M)
print(out.strip())

```

```output
✔ criterion 2: the root with a fake port drives the sample controller end to end
✔ criterion 2: without the port the root constructs no contentRepo (the app build today)
✔ criterion 2: a failing port surfaces as a readiness card, not a crash
✔ criterion 2: a superseded refresh never overwrites the newer result
✔ wiring: the controllers suite runs in npm test
✔ wiring: root tsc accepts the explicit .ts specifiers node strip-types requires
ℹ tests 6
ℹ suites 0
ℹ pass 6
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms <stripped>
```

Criterion 2: the same root with a fake port drives the sample controller end to end (refresh → real evaluatePackage over the synthetic package → readiness in store state); without the port the root constructs nothing; a failing port yields a readiness card, not a crash; a superseded refresh never overwrites the newer result (the generation-token discipline the product controllers must copy). The wiring guards (rule 1) fail when the npm-test glob or the root-tsconfig allowImportingTsExtensions flag is reverted.

```python
import subprocess, re

r = subprocess.run(
    ["node", "--no-warnings", "--test", "--test-reporter=spec",
     "tools/arch/arch-check.test.mjs"],
    capture_output=True, text=True,
)
out = r.stdout + r.stderr
out = re.sub(r" \([\d.]+ ?m?s\)$", "", out, flags=re.M)
out = re.sub(r"^(ℹ duration_ms) .*$", r"\1 <stripped>", out, flags=re.M)
print(out.strip())

```

```output
✔ arch-check wiring is guarded (package.json scripts, npm-test glob, config, baseline)
✔ clean sandbox passes the checker
✔ planted two-file cycle fails and names the no-cycles rule
✔ core/ production file importing node:fs fails and names core-zone-closed
✔ layer-direction violation (services -> web) fails and names services-zone-closed
✔ app/ importing services/ directly fails and names app-no-services (19 §4.2 edge rule)
✔ app/ importing core/ directly fails and names app-no-core (G06.09.b)
✔ a controller value-importing services/ fails and names controllers-services-type-only (issue #209 AC1)
✔ controllers that follow the port rules pass: type-only services import, root value import, core import (issue #209 AC1–AC2)
✔ services/ importing controllers/ fails and names services-zone-closed
✔ core/ importing controllers/ fails and names core-zone-closed
✔ contracts/ importing controllers/ fails and names contracts-zone-closed (review round 1)
✔ web/ importing controllers/ fails and names web-zone-closed (review round 1)
✔ tools/ importing controllers/ fails and names tools-zone-closed (review round 1)
✔ corrupt baseline yields a diagnostic, not a crash
✔ a baselined violation passes; the same violation without the baseline fails
ℹ tests 16
ℹ suites 0
ℹ pass 16
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms <stripped>
```

Criteria 1 and 3: every boundary of Allowed outputs has a planted fixture violation that npm run arch:check rejects, naming the rule — app/ → services/ (app-no-services, the issue's Proof: a screen importing a service constructor), app/ → core/ (app-no-core), a controller value-importing services/ (controllers-services-type-only; the composition root and tests are exempt, a type-only import plus a core import pass), services/ → controllers/ and core/ → controllers/ (zone-closed rules), plus the app-zone closure of contracts/, web/ and tools/ from review round 1 (contracts-zone-closed, web-zone-closed, tools-zone-closed). All of it runs against sandboxes through the real checker entrypoint (issue #209 AC1/AC3).
