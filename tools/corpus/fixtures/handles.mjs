// G21.08 (issue #541) — cleanup-time census for the corpus test sandboxes.
// After a test owns and closes its SQLite handles, no descriptor may still
// point into the temporary tree its after hook is about to remove. On
// Windows the removal itself enforces that contract — rmSync answers EPERM
// while a handle is live — so the census is the Linux/procfs probe for the
// identical condition; on a host without /proc/self/fd it stays a no-op —
// documented in the task results file, never a hidden pass.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

export function assertNoOpenHandlesUnder(dir) {
  if (!fs.existsSync('/proc/self/fd')) return;
  const prefix = dir.endsWith(path.sep) ? dir : dir + path.sep;
  const leaked = [];
  for (const entry of fs.readdirSync('/proc/self/fd')) {
    let target;
    try {
      target = fs.readlinkSync(path.join('/proc/self/fd', entry));
    } catch {
      continue; // the descriptor closed between readdir and readlink
    }
    if (target === dir || target.startsWith(prefix)) leaked.push(`${entry} -> ${target}`);
  }
  assert.ok(
    leaked.length === 0,
    `live file descriptors still point into the sandbox ${dir}: ${leaked.join(', ')}`,
  );
}
