// G03.03 — acceptance suite for the audio verification instrument (issue #300).
// Criteria: 1. every audio file matches its transcript and story_id (tool,
// not eyes); 2. loudness is consistent between files with the measurement
// recorded; 3. the memorial tone is checked against the 13 §2/§3/§5
// checklist; 4. pausing/replaying any story never requires starting the whole
// guide (independent per-story files). Each negative fixture isolates exactly
// one violation (implementation-rules 14); the suite needs ffprobe/ffmpeg on
// the host because the instrument itself measures with them — without them it
// skips visibly instead of pretending (implementation-rules 7).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { verifyAudio } from './verify-audio.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const FIXTURE = path.join(REPO, 'fixtures', 'content', 'audio-verify');
const AUDIO = path.join(FIXTURE, 'be', 'base', 'audio');
const F1 = path.join(AUDIO, 'story-1-base.m4a');
const F2 = path.join(AUDIO, 'story-2-base.m4a');
const CASES = path.join(FIXTURE, 'cases');
const CLI = path.join(HERE, 'verify-audio.mjs');

const bothFiles = { 'story-1-base.m4a': F1, 'story-2-base.m4a': F2 };

const hasTools =
  spawnSync('ffprobe', ['-version']).status === 0 && spawnSync('ffmpeg', ['-version']).status === 0;
const skipReason = hasTools ? false : 'ffprobe/ffmpeg are not on PATH on this host';

const readFixtureStories = () =>
  JSON.parse(fs.readFileSync(path.join(FIXTURE, 'be', 'base', 'stops.json'), 'utf8'));

// A temp package with `be/base` holding the given stories and audio files
// copied from the committed fixture bytes (deterministic, no ffmpeg run).
function tempPackage(stories, audioFiles) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g0303-'));
  fs.mkdirSync(path.join(dir, 'be', 'base', 'audio'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'be', 'base', 'stops.json'), JSON.stringify(stories, null, 2));
  for (const [name, source] of Object.entries(audioFiles)) {
    fs.copyFileSync(source, path.join(dir, 'be', 'base', 'audio', name));
  }
  return dir;
}

const ruleNames = (part) => part.map((d) => d.rule);

test('criterion 1+2: the committed positive package passes with measurements recorded', { skip: skipReason }, async () => {
  const report = await verifyAudio(FIXTURE);
  assert.equal(report.ok, true, JSON.stringify(report.errors));
  assert.deepEqual(ruleNames(report.errors), []);
  assert.deepEqual(ruleNames(report.warnings), []);
  assert.equal(report.measurements.length, 2);
  const [m1, m2] = report.measurements;
  assert.equal(m1.story_id, 'story-1-base');
  assert.equal(m1.duration_measured_s, 2);
  assert.equal(m2.duration_measured_s, 3);
  assert.ok(Math.abs(m1.loudness_lufs + 16) <= 0.5, `loudness ${m1.loudness_lufs} must sit on the −16 LUFS target`);
  assert.ok(Math.abs(m2.loudness_lufs + 16) <= 0.5, `loudness ${m2.loudness_lufs} must sit on the −16 LUFS target`);
  assert.equal(m1.tempo_chars_per_s, 28.5);
  // The 2 s and 3 s fixtures sit below the 60–120 s guideline: recorded as
  // info rows, never as blocking failures (09 §3 invariant 7).
  assert.deepEqual(ruleNames(report.infos), ['duration-guideline', 'duration-guideline']);
  // The author rows of 13 §5/§2/§3 are reported as human, never machine.
  assert.equal(report.checklist.filter((row) => row.kind === 'human').length, 3);
  assert.ok(report.checklist.every((row) => row.outcome !== 'fail'), JSON.stringify(report.checklist));
});

test('checklist: the duration-guideline breach reaches its own row as pass with a note', { skip: skipReason }, async () => {
  // The fixture recordings are 2 s and 3 s, both outside 60–120 s, so the
  // informational row must surface the breach — a plain pass without the
  // note means the fired set missed the infos array again (issue #316).
  const report = await verifyAudio(FIXTURE);
  const row = report.checklist.find((r) => r.item === 'duration inside the 60–120 s guideline');
  assert.equal(row.outcome, 'pass');
  assert.match(row.note, /outside the 60–120 s guideline; recorded, non-blocking/);
});

test('criterion 4: the report carries one independent file per story, no shared bytes', { skip: skipReason }, async () => {
  const report = await verifyAudio(FIXTURE);
  assert.deepEqual(
    report.measurements.map((m) => m.file),
    ['be/base/audio/story-1-base.m4a', 'be/base/audio/story-2-base.m4a'],
  );
  assert.equal(new Set(report.measurements.map((m) => m.sha256)).size, 2);
});

test('negative: garbage bytes yield audio-unreadable, not a crash', { skip: skipReason }, async () => {
  const dir = tempPackage(readFixtureStories(), bothFiles);
  fs.writeFileSync(path.join(dir, 'be', 'base', 'audio', 'story-1-base.m4a'), 'definitely not audio');
  const report = await verifyAudio(dir);
  assert.deepEqual(ruleNames(report.errors), ['audio-unreadable']);
});

test('negative: audio without a transcript fails invariant 1 only', { skip: skipReason }, async () => {
  const stories = readFixtureStories();
  stories[0].transcript = '';
  const dir = tempPackage(stories, bothFiles);
  const report = await verifyAudio(dir);
  assert.deepEqual(ruleNames(report.errors), ['missing-transcript']);
  assert.deepEqual(ruleNames(report.warnings), []);
});

test('negative: a declared duration the recording does not carry fails criterion 1', { skip: skipReason }, async () => {
  const stories = readFixtureStories();
  stories[0].duration_s = 30;
  const dir = tempPackage(stories, bothFiles);
  const report = await verifyAudio(dir);
  assert.deepEqual(ruleNames(report.errors), ['duration-mismatch']);
});

test('negative: one recording bound to two stories fails criterion 4 only', { skip: skipReason }, async () => {
  // Both stories declare 2 s and carry the same bytes (story-1's recording
  // under both names), so duration and loudness checks stay clean — the
  // duplicate is the only violation.
  const stories = readFixtureStories();
  stories[1].duration_s = 2;
  const dir = tempPackage(stories, { 'story-1-base.m4a': F1, 'story-2-base.m4a': F1 });
  const report = await verifyAudio(dir);
  assert.deepEqual(ruleNames(report.errors), ['duplicate-audio']);
});

test('negative: loudness far from −16 LUFS fails the target band only', { skip: skipReason }, async () => {
  const dir = tempPackage([readFixtureStories()[0]], { 'story-1-base.m4a': path.join(CASES, 'loud.m4a') });
  const report = await verifyAudio(dir);
  assert.deepEqual(ruleNames(report.errors), ['loudness-target-deviation']);
  // An error rule keeps the fail outcome in the summary checklist row.
  assert.equal(
    report.checklist.find((r) => r.item === 'loudness within ±2 LU of the −16 LUFS target').outcome,
    'fail',
  );
});

test('negative: two consistent-looking files 3 LU apart fail the spread only', { skip: skipReason }, async () => {
  // spread-a ≈ −14.5 and spread-b ≈ −17.5: each within the ±2 LU target band,
  // so the pairwise inconsistency is the single violation (criterion 2).
  const stories = readFixtureStories();
  stories[1].duration_s = 2;
  const dir = tempPackage(stories, {
    'story-1-base.m4a': path.join(CASES, 'spread-a.m4a'),
    'story-2-base.m4a': path.join(CASES, 'spread-b.m4a'),
  });
  const report = await verifyAudio(dir);
  assert.deepEqual(ruleNames(report.errors), ['loudness-spread']);
});

test('negative: a memorial story reading faster than standard is flagged', { skip: skipReason }, async () => {
  const stories = readFixtureStories();
  stories[1].tone = 'memorial';
  stories[1].transcript = 'Зусім іншы доўгі транскрыпт мемарыяльнай гісторыі, напісаны хуткім тэмпам, які сапраўды перавышае павольны тэмп стандартнай гісторыі гэтага пакета і таму мусіць атрымаць папярэджанне інструмента.';
  const dir = tempPackage(stories, bothFiles);
  const report = await verifyAudio(dir);
  assert.deepEqual(ruleNames(report.warnings), ['memorial-tempo-not-restrained']);
  assert.deepEqual(ruleNames(report.errors), []);
});

test('positive: a memorial story no faster than standard stays clean', { skip: skipReason }, async () => {
  const stories = readFixtureStories();
  stories[1].tone = 'memorial';
  stories[1].transcript = 'Ціха.';
  const dir = tempPackage(stories, bothFiles);
  const report = await verifyAudio(dir);
  assert.deepEqual(ruleNames(report.warnings), []);
  assert.deepEqual(ruleNames(report.errors), []);
});

test('negative: an ad call in the transcript is flagged per 13 §3', { skip: skipReason }, async () => {
  const stories = readFixtureStories();
  stories[0].transcript = 'Хочаце больш? Купіць пашырэнне можна ў дадатку.';
  const dir = tempPackage(stories, bothFiles);
  const report = await verifyAudio(dir);
  assert.deepEqual(ruleNames(report.warnings), ['ad-call-in-transcript']);
  // A warning is non-blocking (ok stays true) and the summary row must show
  // warn, not fail — severity authority lives in the arrays (issue #316).
  assert.equal(report.ok, true);
  assert.equal(
    report.checklist.find((r) => r.item === 'no ad call to buy the extension in the narration').outcome,
    'warn',
  );
});

test('negative: narration requiring the previous file is flagged per 13 §2', { skip: skipReason }, async () => {
  const stories = readFixtureStories();
  stories[0].transcript = 'Гэта працяг папярэдняй гісторыі, таму без яе няма сэнсу.';
  const dir = tempPackage(stories, bothFiles);
  const report = await verifyAudio(dir);
  assert.deepEqual(ruleNames(report.warnings), ['ordering-reference-in-transcript']);
});

test('corrupt input: a null story element answers with a diagnostic, not a crash', { skip: skipReason }, async () => {
  const stories = readFixtureStories();
  stories.unshift(null);
  const dir = tempPackage(stories, bothFiles);
  const report = await verifyAudio(dir);
  assert.deepEqual(ruleNames(report.errors), ['type']);
  assert.equal(report.measurements.length, 2);
});

test('corrupt input: unreadable stops.json answers invalid-json, not a crash', { skip: skipReason }, async () => {
  const dir = tempPackage(readFixtureStories(), bothFiles);
  fs.writeFileSync(path.join(dir, 'be', 'base', 'stops.json'), '{not json');
  const report = await verifyAudio(dir);
  assert.deepEqual(ruleNames(report.errors), ['invalid-json']);
  assert.deepEqual(report.measurements, []);
});

test('fail closed: missing ffprobe/ffmpeg is an audio-tool-missing error', async () => {
  const dir = tempPackage(readFixtureStories(), bothFiles);
  const report = await verifyAudio(dir, {
    ffprobePath: '/nonexistent/ffprobe',
    ffmpegPath: '/nonexistent/ffmpeg',
  });
  assert.deepEqual(ruleNames(report.errors), ['audio-tool-missing']);
  assert.deepEqual(report.measurements, []);
});

test('cli: --in exits 0 with a JSON report, missing --in exits 2', { skip: skipReason }, () => {
  const ok = spawnSync(process.execPath, [CLI, '--in', FIXTURE], { encoding: 'utf8' });
  assert.equal(ok.status, 0);
  assert.equal(JSON.parse(ok.stdout).ok, true);
  const usage = spawnSync(process.execPath, [CLI], { encoding: 'utf8' });
  assert.equal(usage.status, 2);
});
