# G05.05.b — Pause, Resume, End and restart recovery in useRunController

*Showboat demo for issue #217 (`controllers/`), created 2026-09-25.*

<!-- showboat-id: g0505b-pause-end-restart -->

The controller now owns the rest of the session lifecycle: Pause persists the
row `paused` with the retired queue in one store transaction and releases the
subscription, window and wakelock; Resume re-arms from a fresh fix; End
finishes the row with a final checkpoint from every state; a process restart
restores the pinned version and progress without starting any audio. The demo
runs the acceptance suite and then the proof the task demands: skipping the
location release on Pause must turn the subscription-count test red.

The full acceptance suite (criteria 1–6 and the concurrent-recover race guard, 28 tests):

```sh
node --test --experimental-strip-types --test-reporter=spec controllers/useRunController.test.ts 2>/dev/null | grep -E "^ℹ (tests|pass|fail)"
```

```output
ℹ tests 28
ℹ pass 28
ℹ fail 0
```

The proof: on a temporary copy of the stack (never the repository), the
orchestrator's Pause drops its `setMode('paused')` release — exactly the
defect the task's Proof names («skip releasing the location subscription on
Pause»). The Pause test counting subscriptions must fail; on the unmutated
stack it passes:

```sh
node -e '
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const os = require("node:os");
const path = require("node:path");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "g0505b-proof-"));
for (const dir of ["core", "services", "controllers"]) {
  fs.cpSync(path.join(process.cwd(), dir), path.join(tmp, dir), { recursive: true });
}
fs.symlinkSync(path.join(process.cwd(), "node_modules"), path.join(tmp, "node_modules"), "dir");
const orch = path.join(tmp, "controllers/run/runOrchestrator.ts");
const source = fs.readFileSync(orch, "utf8");
const anchor = "    this.location.setMode('"'"'paused'"'"'); // 11 §4.2: the subscription goes with the geofences\n";
console.log("anchor matches once:", source.split(anchor).length - 1 === 1);
fs.writeFileSync(orch, source.replace(anchor, ""));
const mutated = spawnSync(process.execPath, ["--test", "--experimental-strip-types", "--test-reporter=tap", "--test-name-pattern=Pause persists the row paused", path.join(tmp, "controllers/useRunController.test.ts")], { encoding: "utf8" });
console.log("mutated run exit code:", mutated.status);
console.log(mutated.stdout.split("\n").filter((line) => line.startsWith("not ok")).join("\n"));
fs.rmSync(tmp, { recursive: true, force: true });
' && node --test --experimental-strip-types --test-reporter=tap --test-name-pattern="Pause persists the row paused" controllers/useRunController.test.ts 2>/dev/null | grep -E "^ok"
```

```output
anchor matches once: true
mutated run exit code: 1
not ok 1 - criterion 1: Pause persists the row paused, retires the queue in the same write and releases the walk resources
ok 1 - criterion 1: Pause persists the row paused, retires the queue in the same write and releases the walk resources
```
