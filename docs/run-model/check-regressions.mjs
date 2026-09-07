// Reintroduce reviewed defects in temporary copies: the tests must reject each.
import { readFileSync, writeFileSync, mkdtempSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('./run-model.mjs', import.meta.url), 'utf8');
const tests = readFileSync(new URL('./run-model.test.mjs', import.meta.url), 'utf8');
const mutations = [
  ['consume queued stop before playback',
    's.queued = { stopId: event.stopId, radius: event.radius };',
    'add(s.autoFired, event.stopId); s.queued = { stopId: event.stopId, radius: event.radius };'],
  ['erase heard during replay',
    'const playStop = (id, automatic) => {',
    'const playStop = (id, automatic) => { s.heard = s.heard.filter(x => x !== id);'],
  ['autoplay manually completed stop',
    '&& !s.autoFired.includes(id) && !s.heard.includes(id);',
    '&& !s.autoFired.includes(id);'],
  ['accept completion from another session',
    'event.sessionId !== s.sessionId || !s.playing', '!s.playing'],
  ['accept completion from earlier playback',
    '|| event.playId !== s.playing.playId', '|| false'],
  ['accept stale queued location',
    '&& now - f.at <= 30_000', ''],
  ['play locked stop manually',
    "s.state === 'Active' && s.accessibleIds.includes(event.stopId)",
    "s.state === 'Active' && s.stopIds.includes(event.stopId)"],
  ['autoplay locked stop',
    'const eligible = id => s.accessibleIds.includes(id)',
    'const eligible = id => s.stopIds.includes(id)'],
  ['activate a different content version',
    'event.version === s.version && Array.isArray(event.stopIds)',
    'Array.isArray(event.stopIds)'],
];

const directory = mkdtempSync(join(tmpdir(), 'kudy-run-regressions-'));
const modelPath = join(directory, 'run-model.mjs');
const testPath = join(directory, 'run-model.test.mjs');
try {
  writeFileSync(testPath, tests);
  for (const [label, before, after] of mutations) {
    assert.equal(source.split(before).length, 2, `Mutation must match once: ${label}`);
    writeFileSync(modelPath, source.replace(before, after));
    const result = spawnSync(process.execPath,
      ['--test', '--test-reporter=spec', testPath], { encoding: 'utf8', timeout: 30_000 });
    assert.ifError(result.error);
    assert.notEqual(result.status, 0, `Tests missed regression: ${label}`);
    assert.match(result.stdout + result.stderr, /AssertionError/,
      `Expected assertion failure, not a broken runner: ${label}`);
    assert.doesNotMatch(result.stdout + result.stderr, /SyntaxError|ERR_MODULE_NOT_FOUND/);
    console.log(`CAUGHT: ${label}`);
  }
  console.log(`${mutations.length}/${mutations.length} reviewed regressions rejected. Repository model unchanged.`);
} finally {
  // Only these two known files are removed; no recursive deletion.
  for (const path of [modelPath, testPath]) {
    try { unlinkSync(path); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  rmdirSync(directory);
}
