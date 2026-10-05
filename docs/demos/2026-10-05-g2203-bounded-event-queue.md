# G22.03 — абмежаванае чытанне чаргі падзей

*2026-10-05T12:46:10Z by Showboat 0.6.1*
<!-- showboat-id: 447e9358-ae8b-4055-a2cd-78bcf1d5e868 -->

```python
import os
import pathlib
import re
import subprocess
import sys

sys.stdout.reconfigure(encoding="utf-8", newline="\n")

root = pathlib.Path.cwd()
env = dict(os.environ)
env["LD_LIBRARY_PATH"] = str(pathlib.Path.home() / ".local" / "lib")

db_src = (root / "services/db/db.ts").read_text(encoding="utf-8")
open_database = re.search(r"export function (open\w*Database)\(", db_src).group(1)
append_event = re.search(r"export function (append\w*)\(", db_src).group(1)
latest_seq = re.search(r"export function (latest\w*Seq)\(", db_src).group(1)
list_pending = re.search(r"export function (listPending\w*)\(", db_src).group(1)
event_log_src = (root / "services/eventLog.ts").read_text(encoding="utf-8")
flush_events = re.search(r"export async function (flush\w*)\(", event_log_src).group(1)
test_src = (root / "services/db/db.test.ts").read_text(encoding="utf-8")
mem_driver = re.search(r"const driver = (node\w+Driver)\(\)", test_src).group(1)
schema_src = (root / "services/db/schema.ts").read_text(encoding="utf-8")
table = re.search(r"CREATE TABLE (event_\w+)", schema_src).group(1)
types_src = (root / "services/db/types.ts").read_text(encoding="utf-8")
event_input = re.search(r"export interface EventInput \{(.*?)\}", types_src, re.S).group(1)
fields = re.findall(r"(\w+):", event_input)
f_id, f_type, f_at, f_schema, f_payload = fields
dispatch_cols = re.search(r"ORDER BY (\w+), (\w+)", db_src).group(1, 2)
c_at, c_id = dispatch_cols

script = root / ".g2203-demo-bounded-flush.ts"
script.write_text(
    f"import {{ {open_database}, {append_event}, {latest_seq} }} from './services/db/db.ts';\n"
    f"import {{ {mem_driver} }} from './services/db/test-fixture.ts';\n"
    f"import {{ {flush_events} }} from './services/eventLog.ts';\n"
    "\n"
    f"const driver = {mem_driver}();\n"
    f"{open_database}(driver);\n"
    "const total = 1000;\n"
    "for (let i = 0; i < total; i += 1) {\n"
    f"  {append_event}(driver, {{ {f_id}: `evt-${{String(i).padStart(4, '0')}}`, {f_type}: 'app_open', {f_at}: 1_700_000_000_000 + i, {f_schema}: 1, {f_payload}: '{{}}' }});\n"
    "}\n"
    "const reads = { pendingRows: 0 };\n"
    "const rowsAtSend: number[] = [];\n"
    "const pages: number[] = [];\n"
    "const counting = {\n"
    "  execSql: (sql: string) => driver.execSql(sql),\n"
    "  prepare: (sql: string) => {\n"
    "    const statement = driver.prepare(sql);\n"
    f"    if (!sql.includes('FROM {table}') || !sql.includes('ORDER BY {c_at}, {c_id}')) return statement;\n"
    "    return {\n"
    "      run: (...p: any[]) => statement.run(...p),\n"
    "      get: (...p: any[]) => statement.get(...p),\n"
    "      all: (...p: any[]) => {\n"
    "        const rows = statement.all(...p);\n"
    "        reads.pendingRows += rows.length;\n"
    "        return rows;\n"
    "      },\n"
    "    };\n"
    "  },\n"
    "};\n"
    f"const marked = await {flush_events}(counting as never, (batch: unknown[]) => {{\n"
    "  rowsAtSend.push(reads.pendingRows);\n"
    "  pages.push(batch.length);\n"
    "  return Promise.resolve();\n"
    "});\n"
    "console.log('queued events:', total);\n"
    "console.log('rows handed over before the first send:', rowsAtSend[0]);\n"
    "console.log('page sizes:', pages.join(', '));\n"
    "console.log('max rows per query:', Math.max(...pages));\n"
    "console.log('events acknowledged:', marked, 'of', total);\n"
    f"console.log('enqueue_seq bound after the flush:', {latest_seq}(driver));\n",
    encoding="utf-8",
)

run = subprocess.run(
    ["node", "--experimental-strip-types", script.name],
    capture_output=True,
    text=True,
    encoding="utf-8",
    cwd=root,
    env=env,
)
ok = run.returncode == 0
tail = (run.stdout + run.stderr)[-2000:]
script.unlink()
assert ok, tail
print(run.stdout, end="")
```

```output
queued events: 1000
rows handed over before the first send: 256
page sizes: 256, 256, 256, 232
max rows per query: 256
events acknowledged: 1000 of 1000
enqueue_seq bound after the flush: 1000
```

```python
import os
import pathlib
import subprocess
import sys

sys.stdout.reconfigure(encoding="utf-8", newline="\n")

root = pathlib.Path.cwd()
env = dict(os.environ)
env["LD_LIBRARY_PATH"] = str(pathlib.Path.home() / ".local" / "lib")

db_tests = sorted(p.name for p in (root / "services/db").glob("*.test.ts"))
event_tests = sorted(p.name for p in (root / "services").glob("eventLog*.test.ts"))
targets = [f"services/db/{name}" for name in db_tests] + [f"services/{name}" for name in event_tests]

run = subprocess.run(
    [
        "node",
        "--experimental-strip-types",
        "--test",
        "--test-reporter",
        "tap",
        *targets,
    ],
    capture_output=True,
    text=True,
    encoding="utf-8",
    cwd=root,
    env=env,
)
assert run.returncode == 0, (run.stdout + run.stderr)[-2000:]

markers = (
    "page",
    "tail",
    "owner",
    "clearing",
    "counter",
    "partial index",
    "upgrades",
    "backdated",
)
plan = None
for line in run.stdout.splitlines():
    if line.startswith("1.."):
        plan = line
    if line.startswith("ok ") and any(marker in line for marker in markers):
        print(line)
print(plan)
```

```output
ok 18 - enqueue_seq survives account clearing and reopen, and keeps rising
ok 19 - an old file-backed store upgrades in place: rows keep payloads, keys backfill in dispatch order
ok 21 - a broken enqueue_seq counter answers with a named diagnostic, never a guess
ok 22 - the bounded pending read plans over the partial index — no full tail read or sort
ok 38 - the beforeBatch gate stops the flush between chunks — acknowledged chunks stay marked, the tail stays pending
ok 41 - flush_reads_one_bounded_page_before_send
ok 42 - backdated_insert_waits_for_next_flush
ok 43 - batch_failure_preserves_pending_tail
ok 44 - owner_change_stops_old_flush
ok 45 - account_clearing_mid_flush_keeps_the_replacement_event_pending
1..45
```
