// Reintroduce reviewed defects in temporary copies: the tests must reject each.
import { readFileSync, writeFileSync, mkdtempSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

// Mutation anchors are written with \n; normalize checkouts that use CRLF.
const source = readFileSync(new URL('./run-model.mjs', import.meta.url), 'utf8')
  .replace(/\r\n/g, '\n');
const tests = readFileSync(new URL('./run-model.test.mjs', import.meta.url), 'utf8');
const mutations = [
  ['consume queued stop before playback',
    's.queued = { stopId: event.stopId, radius: event.radius, at: now };',
    'add(s.autoFired, event.stopId); s.queued = { stopId: event.stopId, radius: event.radius, at: now };'],
  ['erase heard during replay',
    'const playStory = (stopId, storyId, automatic) => {',
    'const playStory = (stopId, storyId, automatic) => { s.heard = s.heard.filter(x => x !== storyId);'],
  ['autoplay manually completed stop',
    '&& !s.autoFired.includes(id) && !s.heard.includes(primary);',
    '&& !s.autoFired.includes(id);'],
  ['credit extended together with base',
    'add(s.heard, s.playing.storyId);',
    'for (const storyId of storiesOf(findStop(s, s.playing.stopId))) add(s.heard, storyId);'],
  ['swap primary to extended after unlock',
    'const primaryOf = stop => stop && (stop.storyBaseId ?? stop.storyExtendedId);',
    'const primaryOf = stop => stop && (stop.storyExtendedId ?? stop.storyBaseId);'],
  ['accept completion from another session',
    'event.sessionId !== s.sessionId', 'false'],
  ['accept completion from earlier playback',
    '|| event.playId !== s.playing.playId', '|| false'],
  ['validate story id by truthiness instead of presence',
    "|| ('storyId' in event && event.storyId !== s.playing.storyId)) break;",
    "|| (event.storyId && event.storyId !== s.playing.storyId)) break;"],
  ['accept a foreign moment completion',
    "if (s.playing?.owner !== 'moment' || !tokenMatches(event.token)) break;",
    "if (s.playing?.owner !== 'moment') break;"],
  ['credit a moment teaser to guide history',
    "if (s.playing?.owner !== 'moment' || !tokenMatches(event.token)) break;\n      s.playing = null;",
    "if (s.playing?.owner !== 'moment') break;\n      add(s.heard, s.playing.storyId);\n      s.playing = null;"],
  ['resume a stale or closed launch',
    'if (!s.playing || !s.playing.paused || !tokenMatches(event.token)) break;',
    'if (!s.playing) break;'],
  ['stop a moment on session pause',
    "if (!s.playing || s.playing.owner === 'guide') stopAudio();",
    'stopAudio();'],
  ['treat a manual pause as a full stop',
    'if (s.playing) s.playing.paused = true;\n      s.suspended = true;',
    'stopAudio();\n      s.suspended = true;'],
  ['accept stale queued location',
    '&& now - f.at <= 30_000', ''],
  ['play locked stop manually',
    "if (s.state === 'Active' && storyAccessible(s, primaryOf(stop))) {",
    "if (s.state === 'Active' && stop) {"],
  ['autoplay locked stop',
    'return !!primary && storyAccessible(s, primary)',
    'return !!primary'],
  ['activate a different content version',
    'event.version !== s.version', 'true'],
  ['accept a grant for another route',
    'event.routeId !== s.routeId', 'false'],
  ['accept a grant for another locale',
    'event.locale !== s.locale', 'false'],
  ['accept a grant from a foreign issuer',
    "event.issuer !== 'services/download'", 'false'],
  ['start without verified layers',
    'tierAvailable.length === 0', 'false'],
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
