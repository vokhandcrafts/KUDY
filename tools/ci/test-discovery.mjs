// G20.28 (#501, spec verification-integration.md §V7) — real test discovery
// for the default command. The previous guard (tools/build-bundle/
// test-wiring.test.mjs) only substring-matched glob literals inside the
// `npm test` script: a test file dropped into an enumerated folder stayed
// owned by a *literal*, not by the runner, and an unwired file in an
// unenumerated path (the eight spikes/G00.* suites) was invisible to it.
//
// This module is the single owner of the ownership question: it expands the
// actual `node --test` globs and the jest testMatch patterns, inventories the
// committed test files, and answers with the files no runner claims. The
// package.json test script and jest.config.js stay the only glob sources —
// nothing here restates them (implementation-rules 2).
//
// Corrupt or incomplete configuration answers with diagnostics in the result
// (implementation-rules 14); only a missing repository file throws.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const TEST_FILE_PATTERN = /\.test\.(mjs|ts|tsx|cjs|cts|js|jsx)$/;

// Justified exclusions from runner ownership (V7: «выключэнні маюць яўнага
// ўладальніка і прычыну»). Each entry must name a committed test file; a
// stale entry — pointing at a deleted or renamed suite — is a finding, so
// the list cannot rot quietly. Empty today: every committed test file,
// including the spikes/G00.* suites, is wired into `npm test`.
export const EXCLUSIONS = [];

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function defaultTrackedFiles(root) {
  return execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    // The index can outlive the working tree (a not-yet-staged deletion);
    // ownership is about files npm test would actually find.
    .filter((file) => fs.existsSync(path.join(root, file)));
}

// Defaults read the real repository; a caller passing null (the delta tests)
// gets diagnostics instead of a thrown ENOENT — a deleted config file is
// exactly the wiring loss this guard must name.
function defaultTestScript(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts?.test ?? null;
  } catch (error) {
    console.error(`test-discovery: cannot read package.json: ${error.message}`);
    return null;
  }
}

function defaultJestConfig(root) {
  try {
    return fs.readFileSync(path.join(root, 'jest.config.js'), 'utf8');
  } catch (error) {
    console.error(`test-discovery: cannot read jest.config.js: ${error.message}`);
    return null;
  }
}

// The runner part of the test script (before ` && jest`): `node --test`
// arguments that are not flags are glob patterns. Quotes survive into the
// script string — npm hands the whole line to the shell, and the quotes keep
// Node's own globber (not the shell's) expanding them; strip them here.
export function nodeTestPatterns(testScript, diagnostics) {
  if (typeof testScript !== 'string' || testScript.trim() === '') {
    diagnostics.push('package.json has no test script');
    return [];
  }
  const nodePart = testScript.split('&&')[0].trim();
  if (!/^node\s+--test\b/.test(nodePart)) {
    diagnostics.push('npm test must run `node --test` before the jest step');
    return [];
  }
  return nodePart
    .split(/\s+/)
    .slice(2)
    .filter((arg) => !arg.startsWith('--'))
    .map((arg) => arg.replace(/^["']|["']$/g, ''));
}

// testMatch lives only in jest.config.js (single owner); extract the
// `<rootDir>/...` glob strings from the testMatch array — not from
// moduleNameMapper, whose <rootDir> entries are mocks, not suites.
export function jestMatchPatterns(jestConfigSource, diagnostics) {
  if (typeof jestConfigSource !== 'string' || jestConfigSource.trim() === '') {
    diagnostics.push('jest.config.js is missing or empty');
    return [];
  }
  const block = jestConfigSource.match(/testMatch:\s*\[([^\]]*)\]/s);
  if (!block) {
    diagnostics.push('jest.config.js declares no testMatch array');
    return [];
  }
  const patterns = [...block[1].matchAll(/["']<rootDir>\/([^"']+)["']/g)].map((m) => m[1]);
  if (patterns.length === 0) {
    diagnostics.push('jest.config.js declares no <rootDir>/ testMatch patterns');
  }
  return patterns;
}

function expand(root, patterns, diagnostics, label) {
  const files = new Set();
  for (const pattern of patterns) {
    let matched;
    try {
      matched = fs.globSync(pattern, { cwd: root });
    } catch (error) {
      diagnostics.push(`${label} glob "${pattern}" is invalid: ${error.message}`);
      continue;
    }
    for (const file of matched) files.add(path.normalize(file));
    if (matched.length === 0) {
      diagnostics.push(`${label} glob "${pattern}" matches no files — a dead pattern hides new tests`);
    }
  }
  return files;
}

// Options are injectable for the guard's own delta tests; the defaults read
// the real repository state.
export function discoverTests({
  root = repoRoot,
  testScript = defaultTestScript(root),
  jestConfigSource = defaultJestConfig(root),
  trackedFiles = defaultTrackedFiles(root),
  exclusions = EXCLUSIONS,
} = {}) {
  const diagnostics = [];
  const nodePatterns = nodeTestPatterns(testScript, diagnostics);
  const jestPatterns = jestMatchPatterns(jestConfigSource, diagnostics);
  const nodeFiles = expand(root, nodePatterns, diagnostics, 'npm test');
  const jestFiles = expand(root, jestPatterns, diagnostics, 'jest testMatch');

  for (const file of nodeFiles) {
    if (/\.tsx$/.test(file)) {
      diagnostics.push(`${file}: .tsx suites are jest-owned (node --test cannot strip tsx), remove the npm test glob covering it`);
    }
  }
  for (const file of jestFiles) {
    if (nodeFiles.has(file)) {
      diagnostics.push(`${file}: both runners claim it — it would execute twice in npm test`);
    }
  }

  const trackedTestFiles = trackedFiles
    .filter((file) => TEST_FILE_PATTERN.test(file))
    .map((file) => path.normalize(file));

  const exclusionPaths = new Set();
  for (const entry of exclusions) {
    if (!entry || typeof entry.path !== 'string' || typeof entry.reason !== 'string' || entry.reason.trim() === '') {
      diagnostics.push(`malformed exclusion entry: ${JSON.stringify(entry)} — each exclusion needs {path, reason}`);
      continue;
    }
    const normalized = path.normalize(entry.path);
    if (!trackedTestFiles.includes(normalized)) {
      diagnostics.push(`stale exclusion "${entry.path}" (${entry.reason}): no committed test file at that path`);
      continue;
    }
    exclusionPaths.add(normalized);
  }

  const owned = new Set([...nodeFiles, ...jestFiles]);
  const unowned = trackedTestFiles.filter((file) => !owned.has(file) && !exclusionPaths.has(file));

  return { nodeFiles, jestFiles, trackedTestFiles, unowned, diagnostics };
}

// Convenience for the guard test: run against the real repository.
export function discoverRepoTests() {
  return discoverTests({});
}
