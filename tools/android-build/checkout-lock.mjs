// G21.36 (#592): one checkout, one mutating Android operation at a time.
// `build` and `clean --apply` take this lock before their process checks and
// hold it until they finish, so a cleanup can never start in the middle of a
// build (or another cleanup) of the same checkout. The lock lives in the
// checkout's own git dir: never tracked, never a cleanup candidate, and
// separate per worktree.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export function lockPath(checkoutRoot) {
  const gitDir = execFileSync('git', ['rev-parse', '--absolute-git-dir'], { cwd: checkoutRoot, encoding: 'utf8' }).trim();
  return path.join(gitDir, 'kudy-android-build.lock');
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function readHolder(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    return { unreadable: file };
  }
}

// Returns { release } when the lock is ours, or { holder } describing the
// process that holds it. A lock left by a process of this host that no
// longer runs is taken over once; anything unreadable counts as held.
export function acquireLock(file, command, { pid = process.pid, alive = isAlive } = {}) {
  const content = JSON.stringify({ pid, command, host: os.hostname(), startedAt: new Date().toISOString() });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fs.writeFileSync(file, content, { flag: 'wx' });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const holder = readHolder(file);
      const stale = holder && Number.isInteger(holder.pid) && holder.host === os.hostname() && !alive(holder.pid);
      if (stale && attempt === 0) {
        fs.rmSync(file, { force: true });
        continue;
      }
      return { holder: holder ?? { unreadable: file } };
    }
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      if (readHolder(file)?.pid === pid) fs.rmSync(file, { force: true });
    };
    return { release };
  }
  return { holder: readHolder(file) ?? { unreadable: file } };
}
