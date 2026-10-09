// G21.36 (#592), review finding [key: build-output-link-escape]: every
// directory and file the build writes (Gradle home, temp, logs, records and
// the Gradle home's gradle.properties) must be the build root's own entry.
// emulator-scenarios.ps1 applies the same rules to its evidence, logs and
// temp through own-paths-cli.mjs, so this file is the one source of them.
// The build root itself is checked by resolveRoots; a junction or symlink
// below it (say gradle-home pointing at a shared Gradle home) would make the
// build write into someone else's directory, so such paths are refused before
// the first write instead of being followed.
import fs from 'node:fs';
import path from 'node:path';
import { taskPaths } from './build-config.mjs';
import { resolveRoots } from './scoped-clean.mjs';

const samePath = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);

export class OwnPathError extends Error {}

function lstatOrNull(target) {
  try {
    return fs.lstatSync(target);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function linkTarget(target) {
  try {
    return fs.readlinkSync(target);
  } catch {
    return 'unknown target';
  }
}

// The directory is created when missing (unless only checking); an existing
// one must be a real directory whose canonical path is exactly its place in
// the canonical root.
function ensureOwnDir(dir, expected, create) {
  let stat = lstatOrNull(dir);
  if (!stat && !create) return;
  if (!stat) {
    try {
      fs.mkdirSync(dir);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    stat = fs.lstatSync(dir);
  }
  if (stat.isSymbolicLink()) throw new OwnPathError(`${dir} is a link to ${linkTarget(dir)}; the build writes only into its own directories`);
  if (!stat.isDirectory()) throw new OwnPathError(`${dir} exists and is not a directory`);
  const real = fs.realpathSync.native(dir);
  if (!samePath(real, expected)) throw new OwnPathError(`${dir} resolves to ${real}, not to its place ${expected} in the build root`);
}

// Creates the build root and the given directories below it (relative paths,
// default: the build's task-owned directories), or verifies the existing
// ones; with create=false (preflight) it only checks what exists. A nested
// path such as evidence/android is checked segment by segment. Returns
// taskPaths(buildRoot). Throws OwnPathError.
export function prepareOwnDirs(buildRoot, checkoutRoot, { create = true, dirs } = {}) {
  if (create) fs.mkdirSync(buildRoot, { recursive: true });
  let build;
  try {
    ({ build } = resolveRoots(buildRoot, checkoutRoot));
  } catch (error) {
    throw new OwnPathError(error.message);
  }
  const paths = taskPaths(buildRoot);
  const relative = dirs ?? Object.values(paths).map((dir) => path.basename(dir));
  for (const rel of relative) {
    const segments = rel.split(/[\\/]+/).filter(Boolean);
    if (segments.length === 0 || segments.includes('..') || segments.includes('.')) throw new OwnPathError(`${rel} is not a plain path below the build root`);
    for (let i = 1; i <= segments.length; i += 1) {
      const dir = path.join(buildRoot, ...segments.slice(0, i));
      if (!create && !lstatOrNull(dir)) break;
      ensureOwnDir(dir, path.join(build, ...segments.slice(0, i)), create);
    }
  }
  return paths;
}

// An existing link, hard link or non-file at `file` is refused: writing it
// would change the linked file.
export function checkOwnFile(file) {
  const stat = lstatOrNull(file);
  if (stat?.isSymbolicLink()) throw new OwnPathError(`${file} is a link to ${linkTarget(file)}; refusing to write through it`);
  if (stat && !stat.isFile()) throw new OwnPathError(`${file} exists and is not a regular file`);
  if (stat && stat.nlink > 1) throw new OwnPathError(`${file} has ${stat.nlink} hard links; writing it would change the other names too`);
}

// Every existing entry of an own directory whose files get overwritten: no
// link (file or directory) and no file with other hard links. Plain
// subdirectories are left alone; nothing writes into them.
export function checkOwnEntries(dir) {
  for (const entry of fs.readdirSync(dir)) {
    const target = path.join(dir, entry);
    const stat = fs.lstatSync(target);
    if (stat.isDirectory()) continue;
    checkOwnFile(target);
  }
}

// Replaces a file in a directory checked by prepareOwnDirs, after checkOwnFile.
// The new content goes to a fresh temporary file that is then renamed over
// the old entry, so even a link created after the check is replaced rather
// than followed.
export function replaceOwnFile(file, content) {
  checkOwnFile(file);
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, content, { flag: 'wx' });
  try {
    fs.renameSync(temp, file);
  } catch (error) {
    fs.rmSync(temp, { force: true });
    throw error;
  }
}

// Opens a new file for writing; an existing entry of that name (file or
// link) is an error instead of being followed or truncated.
export const openNewFile = (file) => fs.openSync(file, 'wx');
