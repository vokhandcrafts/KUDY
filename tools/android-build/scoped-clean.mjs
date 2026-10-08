// G21.36 (#592): scoped cleanup of generated Android build outputs.
//
// The 2026-10-04 retest replaced module `build` directories inside the shared
// checkout with junctions into a shared drive-wide build root. A cleanup that
// follows such a link can delete another session's outputs, so every target is
// resolved first (junctions included) and must stay inside the task-owned
// roots: the published checkout and the explicit --build-root. Anything else
// is refused with a reason, and the CLI deletes nothing while any target is
// refused.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// Directories Gradle/CMake/AGP generate next to a Gradle project file. The
// `.gradle` project cache exists only at a build root (next to settings.gradle);
// a `.gradle` shipped inside a published package (react-native-svg has one)
// is package content, not output of this build.
const PROJECT_OUTPUTS = new Set(['build', '.cxx']);
const PROJECT_MARKERS = new Set(['build.gradle', 'build.gradle.kts']);
const SETTINGS_MARKERS = new Set(['settings.gradle', 'settings.gradle.kts']);
// node_modules/expo-modules-autolinking/android/expo-gradle-plugin/<plugin>/build
// is the deepest generated directory the Expo/React Native toolchain creates.
const MAX_NODE_MODULES_DEPTH = 6;
const NEVER_DESCEND = new Set(['.git', 'src', 'ios']);

const caseFold = (value) => (process.platform === 'win32' ? value.toLowerCase() : value);

// Containment idiom shared with the repo (implementation-rules 3):
// startsWith(root + sep) on resolved paths, case-folded on Windows.
export function isInside(child, root) {
  const resolvedChild = caseFold(path.resolve(child));
  const resolvedRoot = caseFold(path.resolve(root));
  const prefix = resolvedRoot.endsWith(path.sep) ? resolvedRoot : resolvedRoot + path.sep;
  return resolvedChild !== resolvedRoot && resolvedChild.startsWith(prefix);
}

function realpathOrNull(target) {
  try {
    return fs.realpathSync.native(target);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function readEntries(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return [];
    throw error;
  }
}

function collectGradleOutputs(dir, depth, out) {
  if (depth > MAX_NODE_MODULES_DEPTH) return;
  const entries = readEntries(dir);
  const hasFile = (names) => entries.some((entry) => entry.isFile() && names.has(entry.name));
  const isSettingsRoot = hasFile(SETTINGS_MARKERS);
  const isGradleProject = isSettingsRoot || hasFile(PROJECT_MARKERS);
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const generated = (isGradleProject && PROJECT_OUTPUTS.has(entry.name)) || (isSettingsRoot && entry.name === '.gradle');
    if (generated && (entry.isDirectory() || entry.isSymbolicLink())) {
      out.push(full);
      continue;
    }
    // Links are never followed during discovery; a linked package is not ours.
    if (entry.isDirectory() && !entry.isSymbolicLink() && !NEVER_DESCEND.has(entry.name)) {
      collectGradleOutputs(full, depth + 1, out);
    }
  }
}

// Generated outputs of the prebuild project (android/) and of every Gradle
// project shipped inside node_modules (native modules and included plugin
// builds). Returns absolute paths that currently exist (links included).
export function findCandidates(checkoutRoot) {
  const out = [];
  for (const rel of ['android/.gradle', 'android/build', 'android/app/build', 'android/app/.cxx']) {
    const full = path.join(checkoutRoot, rel);
    try {
      fs.lstatSync(full);
      out.push(full);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  collectGradleOutputs(path.join(checkoutRoot, 'node_modules'), 0, out);
  return out;
}

export function gitOwnership(checkoutRoot) {
  const run = (args) => execFileSync('git', args, { cwd: checkoutRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return {
    isIgnored(rel) {
      try {
        run(['check-ignore', '-q', '--no-index', '--', rel]);
        return true;
      } catch (error) {
        if (error.status === 1) return false;
        throw new Error(`git check-ignore failed for ${rel}: ${String(error.stderr || error.message).trim()}`);
      }
    },
    hasTrackedFiles(rel) {
      return run(['ls-files', '--', rel]).trim() !== '';
    },
  };
}

// Validates the explicit build root before it is trusted as an allowed root.
export function validateBuildRoot(buildRoot, checkoutRoot) {
  if (typeof buildRoot !== 'string' || !path.isAbsolute(buildRoot)) {
    return `--build-root must be an absolute path, got ${JSON.stringify(buildRoot)}`;
  }
  const resolved = path.resolve(buildRoot);
  if (path.parse(resolved).root === resolved) return `--build-root must not be a filesystem root: ${resolved}`;
  if (caseFold(resolved) === caseFold(path.resolve(checkoutRoot)) || isInside(checkoutRoot, resolved)) {
    return `--build-root must not contain the checkout (${checkoutRoot}); it would make source files deletable`;
  }
  if (isInside(resolved, checkoutRoot)) {
    return `--build-root must be outside the checkout so it never mixes with tracked files: ${resolved}`;
  }
  return null;
}

function nestedLinks(dir, out) {
  for (const entry of readEntries(dir)) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) out.push(full);
    else if (entry.isDirectory()) nestedLinks(full, out);
  }
  return out;
}

// Pure planning step: nothing is deleted here. Every refusal carries a reason
// so a successor sees why a directory was kept.
export function planCleanup({ checkoutRoot, buildRoot, candidates, ownership }) {
  const rootError = validateBuildRoot(buildRoot, checkoutRoot);
  if (rootError) throw new Error(rootError);
  const allowed = [fs.realpathSync.native(checkoutRoot), fs.realpathSync.native(buildRoot)];
  const insideAllowed = (target) => allowed.some((root) => isInside(target, root));
  const remove = [];
  const refused = [];

  for (const candidate of candidates) {
    const rel = path.relative(checkoutRoot, candidate);
    if (!isInside(candidate, checkoutRoot)) {
      refused.push({ path: candidate, reason: 'candidate is outside the checkout' });
      continue;
    }
    const stat = fs.lstatSync(candidate);
    const target = realpathOrNull(candidate);
    if (target === null) {
      refused.push({ path: candidate, reason: 'link target cannot be resolved (dangling link)' });
      continue;
    }
    if (!insideAllowed(target)) {
      refused.push({ path: candidate, reason: `resolves outside the task-owned roots: ${target}` });
      continue;
    }
    let ignored;
    try {
      ignored = ownership.isIgnored(rel);
    } catch (error) {
      refused.push({ path: candidate, reason: error.message });
      continue;
    }
    if (!ignored) {
      refused.push({ path: candidate, reason: 'not git-ignored: may hold source' });
      continue;
    }
    if (ownership.hasTrackedFiles(rel)) {
      refused.push({ path: candidate, reason: 'contains tracked files' });
      continue;
    }
    if (stat.isSymbolicLink()) {
      remove.push({ path: candidate, kind: 'link', target, links: [] });
      continue;
    }
    const links = nestedLinks(candidate, []);
    const badLink = links
      .map((link) => ({ link, linkTarget: realpathOrNull(link) }))
      .find(({ linkTarget }) => linkTarget === null || !insideAllowed(linkTarget));
    if (badLink) {
      refused.push({
        path: candidate,
        reason: badLink.linkTarget === null
          ? `nested link cannot be resolved: ${badLink.link}`
          : `nested link resolves outside the task-owned roots: ${badLink.link} -> ${badLink.linkTarget}`,
      });
      continue;
    }
    remove.push({ path: candidate, kind: 'dir', target, links });
  }
  return { remove, refused };
}

// Links are removed as links (never followed) before their parent directory,
// so the recursive delete never meets a reparse point whatever the Node
// implementation of fs.rm does with junctions.
export function applyCleanup(plan) {
  const removed = [];
  const failed = [];
  for (const item of plan.remove) {
    try {
      for (const link of item.links) fs.unlinkSync(link);
      if (item.kind === 'link') fs.unlinkSync(item.path);
      else fs.rmSync(item.path, { recursive: true, maxRetries: 3, retryDelay: 200 });
      removed.push(item.path);
    } catch (error) {
      failed.push({ path: item.path, code: error.code ?? 'UNKNOWN', message: error.message });
    }
  }
  return { removed, failed };
}
