// G05.01.d (issue #201) — production equivalents of the model's 21 reviewed
// regressions (docs/run-model/check-regressions.mjs). Every mutation is
// applied to a temporary copy of the engine, never to the repository, and the
// named model-parity test guarding the broken property must turn red. The
// labels are the model's own, so a regression keeps its name across the model
// and the engine. run-model files are frozen (19 §7.2) and are not touched.
//
// Only the named guard test runs per mutation (--test-name-pattern): the
// property suite as a whole runs in npm test, and the guard names exactly the
// property a mutation breaks. The copy holds the engine's runtime files only;
// a later runtime import of another engine file surfaces as
// ERR_MODULE_NOT_FOUND and fails the run below — add the file to ENGINE_FILES.
// Like the model's runner, only known files are deleted, never a recursive rm.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const engineDir = fileURLToPath(new URL('../../core/engine/', import.meta.url));

// The engine files the parity suite loads at runtime (reducer.ts imports
// state.ts; the events/commands imports are type-only and are erased).
const ENGINE_FILES = ['reducer.ts', 'state.ts', 'model-parity.test.ts'];
const SUITE = 'model-parity.test.ts';
const NODE_FLAGS = ['--test', '--experimental-strip-types', '--test-reporter=tap'];

// [model label, engine file, before, after, guarding test title, name probe]
const mutations = [
  ['consume queued stop before playback', 'reducer.ts',
    '      s.queued = { stopId: event.stopId, radius: event.radius, at: now };',
    '      addOnce(s.autoFired, event.stopId);\n      s.queued = { stopId: event.stopId, radius: event.radius, at: now };',
    'C8: queued stop remains eligible and plays after current audio',
    'C8: queued stop remains eligible'],
  ['erase heard during replay', 'reducer.ts',
    '  stopAudio(s, commands);\n  if (automatic) addOnce(s.autoFired, stopId);',
    '  stopAudio(s, commands);\n  s.heard = s.heard.filter((story) => story !== storyId);\n  if (automatic) addOnce(s.autoFired, stopId);',
    'C7/C11: interrupted replay preserves heard and finish summary',
    'interrupted replay preserves heard'],
  ['autoplay manually completed stop', 'reducer.ts',
    '    !s.autoFired.includes(stopId) &&\n    !s.heard.includes(primary)\n  );',
    '    !s.autoFired.includes(stopId)\n  );',
    'C12: manually completed stop does not autoplay on later arrival',
    'C12: manually completed stop does not autoplay'],
  ['credit extended together with base', 'reducer.ts',
    '  addOnce(s.heard, launch.storyId);',
    '  for (const story of storiesOf(findStop(s, launch.stopId))) addOnce(s.heard, story);',
    'G01.01.b: extended is credited only by its own finished playback',
    'extended is credited only by its own'],
  ['swap primary to extended after unlock', 'state.ts',
    '  stop && (stop.storyBaseId ?? stop.storyExtendedId);',
    '  stop && (stop.storyExtendedId ?? stop.storyBaseId);',
    'G01.01.b: base heard stays heard after same-version unlock; no new Play',
    'base heard stays heard after same-version unlock'],
  ['accept completion from another session', 'reducer.ts',
    '    event.sessionId !== s.sessionId ||',
    '    false ||',
    'C10: equal play numbers from different sessions do not collide',
    'C10: equal play numbers from different sessions'],
  ['accept completion from earlier playback', 'reducer.ts',
    '    event.playId !== launch.playId ||',
    '    false ||',
    'C10: old completion cannot finish a replay of the same story',
    'C10: old completion cannot finish a replay'],
  ['validate story id by truthiness instead of presence', 'reducer.ts',
    "    ('storyId' in event && event.storyId !== launch.storyId)",
    '    (event.storyId && event.storyId !== launch.storyId)',
    'G01.01.b: completion with present-but-empty or null story id is ignored',
    'completion with present-but-empty or null story id'],
  ['accept a foreign moment completion', 'reducer.ts',
    "      if (s.playing?.owner !== 'moment' || !tokenMatches(s, event.token)) break;\n      s.playing = null;",
    "      if (s.playing?.owner !== 'moment') break;\n      s.playing = null;",
    'G01.02.b (§4.12): moment → moment leaves one sound; the old token is ignored entirely',
    'moment leaves one sound'],
  ['credit a moment teaser to guide history', 'reducer.ts',
    "      if (s.playing?.owner !== 'moment' || !tokenMatches(s, event.token)) break;\n      s.playing = null;",
    "      if (s.playing?.owner !== 'moment') break;\n      addOnce(s.heard, s.playing.storyId);\n      s.playing = null;",
    'G01.02.b (§4.3): moment finished frees the player without crediting history or automation',
    'moment finished frees the player'],
  ['resume a stale or closed launch', 'reducer.ts',
    '      if (!s.playing || !s.playing.paused || !tokenMatches(s, event.token)) break;',
    '      if (!s.playing) break;',
    'G01.02.b (§4.12): moment → moment leaves one sound; the old token is ignored entirely',
    'moment leaves one sound'],
  ['stop a moment on session pause', 'reducer.ts',
    "      if (s.playing && s.playing.owner === 'guide') stopAudio(s, commands);",
    '      stopAudio(s, commands);',
    'G01.02.b (§4.9): a session pause touches only the walk; a moment keeps sounding',
    'a session pause touches only the walk'],
  ['treat a manual pause as a full stop', 'reducer.ts',
    '      if (s.playing) s.playing.paused = true;\n      s.autoplaySuspended = true;',
    '      stopAudio(s, commands);\n      s.autoplaySuspended = true;',
    'C18/C19/C20: UserPausedAudio is a live pause that blocks arrivals until explicit Play',
    'UserPausedAudio is a live pause'],
  ['accept stale queued location', 'reducer.ts',
    '    fix.at <= now &&\n    now - fix.at <= freshnessMs\n  );',
    '    fix.at <= now\n  );',
    'C22: stale position retires queue without playback',
    'stale position retires queue without playback'],
  ['play locked stop manually', 'reducer.ts',
    "      if (s.phase === 'Active' && primary !== undefined && storyAccessible(s, primary)) {",
    "      if (s.phase === 'Active' && primary !== undefined) {",
    'C33: locked preview is excluded from manual and automatic playback and remaining list',
    'C33: locked preview is excluded from manual and automatic'],
  ['autoplay locked stop', 'reducer.ts',
    '    storyAccessible(s, primary) &&\n    !s.autoFired.includes(stopId) &&',
    '    !s.autoFired.includes(stopId) &&',
    'C33: locked preview is excluded from manual and automatic playback and remaining list',
    'C33: locked preview is excluded from manual and automatic'],
  ['activate a different content version', 'reducer.ts',
    '    event.version === s.version &&',
    '    true &&',
    'C35: catalog version change cannot unlock or replace active session content',
    'catalog version change cannot unlock'],
  ['accept a grant for another route', 'reducer.ts',
    '    event.routeId === s.routeId &&',
    '    true &&',
    'G01.03.b: grant for another route is ignored entirely',
    'grant for another route is ignored'],
  ['accept a grant for another locale', 'reducer.ts',
    '    event.locale === s.locale &&',
    '    true &&',
    'G01.03.b: grant for another locale is ignored entirely',
    'grant for another locale is ignored'],
  ['accept a grant from a foreign issuer', 'reducer.ts',
    "    event.issuer === 'services/download' &&",
    '    true &&',
    'G01.03.b: grant from a non-download issuer is ignored entirely',
    'grant from a non-download issuer is ignored'],
  ['start without verified layers', 'reducer.ts',
    '    event.tier.length === 0 ||',
    '    false ||',
    'G01.03.b: start refuses a package claiming no verified layer or an unknown layer',
    'start refuses a package claiming no verified layer'],
];

// Harness sanity: an unmutated copy must pass its guard before any mutation
// can claim credit for a failure.
function runGuard(directory, probe) {
  const result = spawnSync(
    process.execPath,
    [...NODE_FLAGS, `--test-name-pattern=${probe}`, join(directory, SUITE)],
    { encoding: 'utf8', timeout: 120_000 },
  );
  assert.ifError(result.error);
  return result;
}

const precheck = mkdtempSync(join(tmpdir(), 'kudy-engine-regressions-'));
try {
  for (const file of ENGINE_FILES) writeFileSync(join(precheck, file), readFileSync(join(engineDir, file)));
  const sound = runGuard(precheck, 'C8: queued stop remains eligible');
  assert.equal(sound.status, 0, 'the harness copy must pass its guard before mutations');
  console.log('HARNESS: the unmutated copy passes its guard.');
} finally {
  for (const file of ENGINE_FILES) {
    try { unlinkSync(join(precheck, file)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  rmdirSync(precheck);
}

let caught = 0;
for (const [label, file, before, after, guardTitle, probe] of mutations) {
  const source = readFileSync(join(engineDir, file), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(source.split(before).length, 2, `mutation must match once: ${label}`);
  const directory = mkdtempSync(join(tmpdir(), 'kudy-engine-regressions-'));
  try {
    for (const name of ENGINE_FILES) {
      const text = name === file ? source.replace(before, after) : readFileSync(join(engineDir, name), 'utf8').replace(/\r\n/g, '\n');
      writeFileSync(join(directory, name), text);
    }
    const result = runGuard(directory, probe);
    assert.notEqual(result.status, 0, `tests missed regression: ${label}`);
    const output = result.stdout + result.stderr;
    assert.doesNotMatch(output, /SyntaxError|ERR_MODULE_NOT_FOUND/, `broken runner, not a caught regression: ${label}`);
    const failed = [...output.matchAll(/^not ok \d+ - (.+)$/gm)].map((match) => match[1].trim());
    assert.ok(
      failed.includes(guardTitle),
      `the guard must be among the failures: ${label}\n  expected: ${guardTitle}\n  failed:   ${failed.join('; ') || '(none)'}`,
    );
    caught += 1;
    console.log(`CAUGHT: ${label} — ${guardTitle}`);
  } finally {
    for (const name of ENGINE_FILES) {
      try { unlinkSync(join(directory, name)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    rmdirSync(directory);
  }
}

// The criterion's own claim: repository files stay unchanged — the anchors
// must still match exactly once, so no mutation text ever landed in the repo.
for (const [label, file, before] of mutations) {
  assert.equal(readFileSync(join(engineDir, file), 'utf8').replace(/\r\n/g, '\n').split(before).length, 2, `repository file was mutated: ${label} (${file})`);
}

console.log(`${caught}/${mutations.length} reviewed regressions rejected by the named guards. Repository engine unchanged.`);
