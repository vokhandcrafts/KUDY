# G22.06 — порцыі гісторыі My KUDY

*2026-10-05T19:40:00Z by Showboat 0.6.1*
<!-- showboat-id: 6b1f2a44-90c7-4d2e-8a31-c0d5e77a9b12 -->

G22.06 (issue #611): гісторыя My KUDY чытаецца завершанымі старонкамі па keyset-курсоры (started_at, session_id) без поўнага чытання сховішча і без offset-праходжання; жывая прагулка чытаецца асобна пры кожнай старонцы; парадок плануе над частковым індэксам міграцыйнага кроку 4. Дэма сее 500 завершаных сесій і адну прыпыненую жывую ў чыстым сховішчы, чытае першую старонку, праходзіць усю гісторыю па курсары і паказвае план запыту:

```python
import os
import pathlib
import subprocess
import sys

sys.stdout.reconfigure(encoding="utf-8", newline="\n")

root = pathlib.Path.cwd()
env = dict(os.environ)
env["LD_LIBRARY_PATH"] = str(pathlib.Path.home() / ".local" / "lib")

script = root / ".g2206-demo-history-pages.ts"
script.write_text(
    "import { listSessionHistoryPage, openDatabase, SESSION_HISTORY_PAGE_SIZE } from './services/db/db.ts';\n"
    "import { nodeSqliteDriver } from './services/db/test-fixture.ts';\n"
    "\n"
    "const driver = nodeSqliteDriver();\n"
    "openDatabase(driver);\n"
    "const insert = driver.prepare(\n"
    "  \"INSERT INTO session (session_id, route_id, version, locale, state, started_at, finished_at, heard) VALUES (?, ?, ?, ?, 'finished', ?, ?, ?)\",\n"
    ");\n"
    "for (let i = 0; i < 500; i += 1) {\n"
    "  const startedAt = 1_700_000_000_000 + i * 1_000;\n"
    "  insert.run(`walk-${String(i).padStart(4, '0')}`, 'route-page', '1', 'be', startedAt, startedAt + 500, JSON.stringify(['story-1', 'story-2']));\n"
    "}\n"
    "driver\n"
    "  .prepare(\"INSERT INTO session (session_id, route_id, version, locale, state, started_at) VALUES ('walk-live', 'route-page', '1', 'be', 'paused', 1_700_000_500_000)\")\n"
    "  .run();\n"
    "\n"
    "const reads = { rows: 0 };\n"
    "const captured: string[] = [];\n"
    "const counting = {\n"
    "  execSql: (sql: string) => driver.execSql(sql),\n"
    "  prepare: (sql: string) => {\n"
    "    const statement = driver.prepare(sql);\n"
    "    if (sql.includes('FROM session') && sql.includes('LIMIT ?')) captured.push(sql);\n"
    "    if (!sql.includes('FROM session')) return statement;\n"
    "    return {\n"
    "      run: (...p: any[]) => statement.run(...p),\n"
    "      get: (...p: any[]) => statement.get(...p),\n"
    "      all: (...p: any[]) => {\n"
    "        const rows = statement.all(...p);\n"
    "        reads.rows += rows.length;\n"
    "        return rows;\n"
    "      },\n"
    "    };\n"
    "  },\n"
    "};\n"
    "\n"
    "const first = listSessionHistoryPage(counting as never, null);\n"
    "console.log('page size the store fixes:', SESSION_HISTORY_PAGE_SIZE);\n"
    "console.log('rows on the first page:', first.rows.length);\n"
    "console.log('rows read for the first page:', reads.rows);\n"
    "console.log('live walk beside the first page:', first.live?.sessionId);\n"
    "\n"
    "const seen = [...first.rows.map((row) => row.sessionId)];\n"
    "let cursor = first.nextCursor;\n"
    "let pages = 1;\n"
    "let liveEverywhere = first.live?.sessionId === 'walk-live';\n"
    "while (cursor !== null) {\n"
    "  const page = listSessionHistoryPage(counting as never, cursor);\n"
    "  seen.push(...page.rows.map((row) => row.sessionId));\n"
    "  if (page.live?.sessionId !== 'walk-live') liveEverywhere = false;\n"
    "  pages += 1;\n"
    "  cursor = page.nextCursor;\n"
    "}\n"
    "console.log('cursor walk:', seen.length, 'rows of 500');\n"
    "console.log('unique rows across pages:', new Set(seen).size);\n"
    "console.log('pages walked:', pages);\n"
    "console.log('live walk on every page:', liveEverywhere ? 'yes' : 'no');\n"
    "const plan = driver\n"
    "  .prepare(`EXPLAIN QUERY PLAN ${captured[0]}`)\n"
    "  .all(50)\n"
    "  .map((row) => String(row.detail))\n"
    "  .join(' | ');\n"
    "console.log('plan:', plan.includes('session_history_order') && !plan.includes('TEMP B-TREE') ? 'partial index used, no TEMP B-TREE' : 'UNBOUNDED');\n",
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
out = run.stdout.rstrip("\n")
assert "rows on the first page: 50" in out, out
assert "cursor walk: 500 rows of 500" in out, out
assert "pages walked: 11" in out, out
print(out)
```

```output
page size the store fixes: 50
rows on the first page: 50
rows read for the first page: 50
live walk beside the first page: walk-live
cursor walk: 500 rows of 500
unique rows across pages: 500
pages walked: 11
live walk on every page: yes
plan: partial index used, no TEMP B-TREE
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
targets = [f"services/db/{name}" for name in db_tests]

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
    "history_page_is_bounded",
    "live_session_is_visible_on_every_page",
    "tied",
    "history page read plans over the partial index",
    "cursor is validated",
    "gains the history order",
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
ok 24 - history_page_is_bounded: one page reads at most 50 completed summaries at 20/100/500 sessions
ok 25 - live_session_is_visible_on_every_page: the live walk rides each page read, the completed pages stay clean
ok 26 - tied started_at rows keep the keyset stable, and the final empty page closes the walk
ok 27 - the history page read plans over the partial index — no full history read or sort
ok 28 - the history page cursor is validated with a named diagnostic, never a wrong page
ok 29 - an old file-backed store gains the history order in place: rows and counts stay untouched
1..36
```
