# G05.05.a — durable Start and checkpoints (useRunController)

*Showboat demo for issue #216 (`controllers/useRunController.ts`), created 2026-09-25.*

<!-- showboat-id: g0505a-durable-start -->

`useRunController` wraps the G05.04 orchestrator with the durable session row:
Start gates on G04.03 readiness, inserts the row (version, locale, play_seq=0,
R07 carry-over) in one transaction through the services/db public API, and
only then starts the engine. The hook of the orchestrator's header note 7 is
the durability point — the monotonic sets are checkpointed and `play_seq` is
written through before the play command reaches the audio service. The
scenarios run the real db over the node:sqlite adapter, the real contentRepo
fixture package route-x@1 and the real services over fake OS ports.

The acceptance suite (the six criteria; durations stripped):

```sh
node --test --experimental-strip-types --test-reporter=spec controllers/useRunController.test.ts 2>/dev/null | sed -E 's/ \([0-9]+(\.[0-9]+)?ms\)//' | grep -E "✔|✖|ℹ (tests|pass|fail)"
```

```output
✔ criterion 1: Start on a ready package inserts the row and starts the engine after the commit
✔ criterion 1: the R07 carry-over moves the carried hints into session scope inside Start
✔ criterion 1: an injected failure mid-transaction leaves no row and no half carry-over
✔ criterion 1: a not-ready package refuses Start with a named reason and writes nothing
✔ criterion 1: a layer document that vanishes after readiness refuses Start
✔ criterion 1: the verified layers of an extended start land in the row and the engine
✔ criterion 2: a second Start while the session is active is refused with a named reason
✔ criterion 2: a second Start while a paused session exists is refused the same way
✔ criterion 3: play_seq is written through before the play command reaches the audio service
✔ criterion 3: a crash between the write-through and the play leaves a play_seq no callback can match
✔ criterion 4: an accepted AudioFinished checkpoints heard and auto_fired
✔ criterion 4: a callback rejected by step() writes nothing
✔ criterion 4: an accepted DwellCompleted while suspended checkpoints auto_fired
✔ criterion 5: AccessReady reaches the engine through the download capability channel
✔ criterion 5: a look-alike emission on a foreign port never reaches the engine
ℹ tests 15
ℹ pass 15
ℹ fail 0
```

The proof the issue demands: sending the play command before persisting
`play_seq` must turn the crash-between test red. On a temporary copy of the
source trees (created inside the repository root — so `zustand` resolves —
gitignored under `.tmp-g0505a-proof/` and removed by the same block), the
orchestrator's dispatch order is swapped — effects first, the durability hook
after — exactly the defect a crash between the two would expose. The
repository working tree is never mutated. Both criterion-3 tests fail; on the
unmutated tree they pass:

```sh
node -e '
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const tmp = path.join(process.cwd(), ".tmp-g0505a-proof");
fs.rmSync(tmp, { recursive: true, force: true });
for (const dir of ["controllers", "core", "services"]) {
  fs.cpSync(path.join(process.cwd(), dir), path.join(tmp, dir), { recursive: true });
}
const orchestratorPath = path.join(tmp, "controllers/run/runOrchestrator.ts");
const source = fs.readFileSync(orchestratorPath, "utf8");
const before = "    this.onCommitted?.(before, result.state);\n    this.applyEffects(result.commands);";
const after = "    this.applyEffects(result.commands);\n    this.onCommitted?.(before, result.state);";
console.log("anchor matches once:", source.split(before).length - 1 === 1);
fs.writeFileSync(orchestratorPath, source.replace(before, after));
const mutated = spawnSync(process.execPath, ["--test", "--experimental-strip-types", "--test-reporter=tap", "--test-name-pattern=criterion 3", path.join(tmp, "controllers/useRunController.test.ts")], { encoding: "utf8" });
console.log("mutated run exit code:", mutated.status);
console.log(mutated.stdout.split("\n").filter((line) => line.startsWith("not ok")).join("\n"));
fs.rmSync(tmp, { recursive: true, force: true });
' && node --test --experimental-strip-types --test-reporter=tap --test-name-pattern="criterion 3" controllers/useRunController.test.ts 2>/dev/null | grep -E "^ok"
```

```output
anchor matches once: true
mutated run exit code: 1
not ok 1 - criterion 3: play_seq is written through before the play command reaches the audio service
not ok 2 - criterion 3: a crash between the write-through and the play leaves a play_seq no callback can match
ok 1 - criterion 3: play_seq is written through before the play command reaches the audio service
ok 2 - criterion 3: a crash between the write-through and the play leaves a play_seq no callback can match
```
