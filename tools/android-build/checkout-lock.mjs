// G21.36 (#592): one checkout, one mutating Android operation at a time.
// `build` and `clean --apply` take this lock before their process checks and
// hold it until they finish, so a cleanup can never start in the middle of a
// build (or another cleanup) of the same checkout. The lock lives in the
// checkout's own git dir: never tracked, never a cleanup candidate, and
// separate per worktree.
//
// A lock whose owner no longer runs is reported as stale and never taken
// over automatically [key: stale-lock-reclaim-race]: two callers that both
// saw the same dead owner could otherwise delete each other's fresh lock and
// both proceed. Removing a stale lock is a manual step (docs/development_setup.md).
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

// Returns { release } when the lock is ours, or { holder, stale } describing
// the lock that is in the way. The lock file is only ever created with
// O_EXCL and only removed by its own owner, so no caller can remove a lock
// another caller just took. stale is true when the holder is a process of
// this host that no longer runs; such a lock stays until a person removes
// it. Anything unreadable counts as held.
export function acquireLock(file, command, { pid = process.pid, alive = isAlive } = {}) {
  const content = JSON.stringify({ pid, command, host: os.hostname(), startedAt: new Date().toISOString() });
  try {
    fs.writeFileSync(file, content, { flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const holder = readHolder(file) ?? { unreadable: file };
    // Host names compare case-insensitively (Windows reports HPELITEBOOK or hpEliteBook).
    const thisHost = typeof holder.host === 'string' && holder.host.toLowerCase() === os.hostname().toLowerCase();
    const stale = Number.isInteger(holder.pid) && thisHost && !alive(holder.pid);
    return { holder, stale };
  }
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    if (readHolder(file)?.pid === pid) fs.rmSync(file, { force: true });
  };
  return { release };
}
