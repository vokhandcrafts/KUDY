# G05.04 — queue and automation blocking across the real boundaries

*Showboat demo for issue #215 (`controllers/run`), created 2026-09-25.*

<!-- showboat-id: g0504-queue-real-boundaries -->

The run orchestrator composes the real pipeline, reducer and both services
(fake OS ports, injected clock) so that every input — GPS fix, manual tap,
tagged audio callback — enters `step()` through one path. The demo runs the
scenario suite and then the proof the task demands: making the deferred-play
check read the fix that triggered the queue instead of the latest accepted fix
must turn the walked-away test red.

The full scenario suite (the six acceptance criteria, 9 tests):

```sh
node --test --experimental-strip-types --test-reporter=spec controllers/run/runOrchestrator.test.ts 2>/dev/null | grep -E "^ℹ (tests|pass|fail)"
```

```output
ℹ tests 9
ℹ pass 9
ℹ fail 0
```

The proof: on a temporary copy of the engine (never the repository), the
deferred-play check in `audioFinished` is rewired from «freshness + distance of
the latest accepted fix» to «freshness of the queued trigger alone» — exactly
the defect the walked-away person would feel. The distance-bound test must
fail; on the unmutated engine it passes:

```sh
node -e '
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const os = require("node:os");
const path = require("node:path");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "g0504-proof-"));
for (const dir of ["core/engine", "core/pipeline", "core/geo", "services/location", "services/audio", "controllers/run"]) {
  fs.mkdirSync(path.join(tmp, dir), { recursive: true });
  for (const file of fs.readdirSync(path.join(process.cwd(), dir))) {
    if (file.endsWith(".ts")) fs.copyFileSync(path.join(process.cwd(), dir, file), path.join(tmp, dir, file));
  }
}
const reducerPath = path.join(tmp, "core/engine/reducer.ts");
const source = fs.readFileSync(reducerPath, "utf8");
const before = "    fixIsFresh(s, now, config.fixFreshnessMs) &&\n    fixWithinDistance(s, queued.stopId, queued.radius, config.queueDistanceMultiplier);";
const after = "    now - queued.at <= config.fixFreshnessMs;";
console.log("anchor matches once:", source.split(before).length - 1 === 1);
fs.writeFileSync(reducerPath, source.replace(before, after));
const mutated = spawnSync(process.execPath, ["--test", "--experimental-strip-types", "--test-reporter=tap", "--test-name-pattern=distance bound on both sides", path.join(tmp, "controllers/run/runOrchestrator.test.ts")], { encoding: "utf8" });
console.log("mutated run exit code:", mutated.status);
console.log(mutated.stdout.split("\n").filter((line) => line.startsWith("not ok")).join("\n"));
fs.rmSync(tmp, { recursive: true, force: true });
' && node --test --experimental-strip-types --test-reporter=tap --test-name-pattern="distance bound on both sides" controllers/run/runOrchestrator.test.ts 2>/dev/null | grep -E "^ok"
```

```output
anchor matches once: true
mutated run exit code: 1
not ok 1 - criterion 2: the deferred play re-checks the latest accepted fix — distance bound on both sides
ok 1 - criterion 2: the deferred play re-checks the latest accepted fix — distance bound on both sides
```

The mutated copy fails the walked-away test (exit 1, `not ok`) because the
deferred play no longer re-checks the latest accepted fix; the repository
engine (last line, `ok`) keeps rejecting it. No repository file was touched.
