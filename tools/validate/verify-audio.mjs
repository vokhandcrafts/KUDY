// G03.03 — audio verification instrument for a content package (issue #300).
// Complements validate-package, which owns the structural media rules
// (missing-media, orphan-media, tier-mismatch): this instrument owns the
// recorded bytes themselves — the file ↔ transcript ↔ story_id binding,
// duration and loudness of every recording, duplicate recordings, and the
// machine-checkable part of the memorial-tone checklist.
//
// Canon, copied not paraphrased:
// - 09 §3 Story: tone is `standard` | `memorial`; "tone: memorial — не
//   дэкарацыя: сцішае тэмп начытвання і забараняе ставіць побач trivia";
//   invariant 1: "Аўдыё ніколі без транскрыпту"; invariant 7: "Даўжыня аўдыё
//   і адлегласці правяраюцца на карэктнасць… дыягностыка, не забарона".
// - 09 §6 `audio` row: "Гучнасць начытанага нармалізуецца (мэта −16 LUFS)".
// - 13 §2: "Аўдыё асобна на гісторыю кропкі, не суцэльны запіс маршруту",
//   "прыёмка тэксту не павінна патрабаваць пачуць папярэдні файл"; §3:
//   "Пачатковы арыенцір аднаго аўдыё — 60–120 секунд" (гайдлін),
//   "У наратыве няма рэкламнага закліку купіць пашырэнне"; §5 keeps the
//   read-aloud audio↔transcript match and the restrained-tone judgement as
//   the author's acceptance rows — they are reported as `human` checklist
//   rows, never machine verdicts.
//
// Measurement: ffprobe (container duration) and ffmpeg ebur128 (integrated
// loudness), both on PATH or given via options. Missing tools are a
// package-level `audio-tool-missing` error — the gate fails closed, never a
// silent pass. Diagnostics carry stable rules and entity paths, never file
// content (the same leak boundary validate-package keeps); measured values
// live only in the `measurements` section of the report.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import { diag, readJson, listFiles, asArray } from './validate-package.mjs';

// The target is the 09 audio row; the tolerance is this instrument's
// matching band — loudness work is judged in LU around a target, so a
// broadcast-style ±2 LU band is the contract, not an invented canon value.
const LOUDNESS_TARGET_LUFS = -16;
const LOUDNESS_TOLERANCE_LU = 2;
// A mismatch beyond this means the file is not the declared recording at
// all, so it is an error (criterion 1); the 60–120 s band below is the 13 §3
// guideline and only records an info, never blocks (09 §3 invariant 7).
const DURATION_TOLERANCE_S = 1;
const DURATION_GUIDELINE_MIN_S = 60;
const DURATION_GUIDELINE_MAX_S = 120;

// Proxy marker lists for the two 13 §2/§3 prose rules. Substring match over
// the lowercased transcript; both fire warnings for the author to read — the
// canon keeps the final call with the author (13 §5).
const AD_CALL_MARKERS = [
  'купіць пашырэнне',
  'купіць падпіску',
  'прыдбаць пашырэнне',
  'прома-код',
  'зніжка па коду',
];
const ORDERING_MARKERS = [
  'пасля папярэдняй кропкі',
  'папярэдняй кропкі',
  'папярэдняя кропка',
  'у папярэдняй гісторыі',
  'папярэдняй гісторыі',
  'працяг папярэдняй',
];

const round = (value, digits) => Number(value.toFixed(digits));

function run(bin, args, timeoutMs) {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ err, stdout, stderr });
    });
  });
}

// Container duration via ffprobe; integrated loudness via ffmpeg ebur128.
// The ebur128 summary is the LAST `I:` line on stderr (per-frame log lines
// carry their own `I:`), and silence reports `-inf` rather than a number.
async function measureFile(absFile, opts, tool) {
  if (!tool.available) return { error: 'tool-missing' };
  const probe = await run(
    opts.ffprobePath,
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', absFile],
    opts.timeoutMs,
  );
  if (probe.err) {
    if (probe.err.code === 'ENOENT') {
      tool.available = false;
      return { error: 'tool-missing' };
    }
    return { error: 'unreadable' };
  }
  let duration;
  try {
    duration = Number(JSON.parse(probe.stdout)?.format?.duration);
  } catch {
    return { error: 'unreadable' };
  }
  if (!Number.isFinite(duration) || duration <= 0) return { error: 'unreadable' };
  const loud = await run(
    opts.ffmpegPath,
    ['-nostats', '-hide_banner', '-i', absFile, '-af', 'ebur128', '-f', 'null', '-'],
    opts.timeoutMs,
  );
  if (loud.err) {
    if (loud.err.code === 'ENOENT') {
      tool.available = false;
      return { error: 'tool-missing' };
    }
    return { error: 'unreadable' };
  }
  let match = null;
  for (match of loud.stderr.matchAll(/\bI:\s+(-?[\d.]+|-inf)\s+LUFS/g)) { /* keep the last */ }
  if (!match) return { error: 'unreadable' };
  const lufs = match[1] === '-inf' ? -Infinity : Number(match[1]);
  return { duration, lufs: Number.isFinite(lufs) ? lufs : -Infinity };
}

export async function verifyAudio(dir, options = {}) {
  const opts = { ffprobePath: 'ffprobe', ffmpegPath: 'ffmpeg', timeoutMs: 30000, ...options };
  const rootAbs = path.resolve(dir);
  const errors = [];
  const warnings = [];
  const infos = [];
  const tool = { available: true };
  const measurements = [];
  const hashes = new Map();
  let files;
  try {
    files = listFiles(rootAbs);
  } catch {
    diag(errors, 'error', 'missing-file', '.');
    files = [];
  }

  for (const rel of files) {
    const m = rel.match(/^([^/]+)\/(base|extended)\/stops\.json$/);
    if (!m) continue;
    const locale = m[1];
    const tier = m[2];
    const stories = asArray(readJson(rootAbs, rel, errors), rel, errors);
    for (let i = 0; i < stories.length; i++) {
      const story = stories[i];
      const at = `${rel}[${i}]`;
      const storyId = story?.story_id;
      const relAudio = typeof storyId === 'string' ? `${locale}/${tier}/audio/${storyId}.m4a` : null;
      // A story without a bound audio file is a text-only story or a broken
      // name — both are validate-package's structural rules, not byte facts.
      if (!relAudio || !files.includes(relAudio)) continue;

      // 09 §3 invariant 1: audio is never published without its transcript.
      const transcript = typeof story?.transcript === 'string' ? story.transcript : '';
      if (!transcript.trim()) diag(errors, 'error', 'missing-transcript', `${at}#transcript`);

      // Two stories sharing one recording break the per-story independence
      // (13 §2: audio is per story, and a per-locale recording — 09 §8).
      const hash = crypto
        .createHash('sha256')
        .update(fs.readFileSync(path.join(rootAbs, relAudio)))
        .digest('hex');
      if (hashes.has(hash)) diag(errors, 'error', 'duplicate-audio', relAudio);
      else hashes.set(hash, relAudio);

      const lower = transcript.toLowerCase();
      if (AD_CALL_MARKERS.some((marker) => lower.includes(marker))) {
        diag(warnings, 'warning', 'ad-call-in-transcript', `${at}#transcript`);
      }
      if (ORDERING_MARKERS.some((marker) => lower.includes(marker))) {
        diag(warnings, 'warning', 'ordering-reference-in-transcript', `${at}#transcript`);
      }

      const measured = await measureFile(path.join(rootAbs, relAudio), opts, tool);
      if (measured.error === 'tool-missing') continue;
      if (measured.error) {
        diag(errors, 'error', 'audio-unreadable', relAudio);
        continue;
      }
      const declared = typeof story?.duration_s === 'number' ? story.duration_s : null;
      if (declared !== null && Math.abs(measured.duration - declared) > DURATION_TOLERANCE_S) {
        diag(errors, 'error', 'duration-mismatch', `${at}#duration_s`);
      }
      if (measured.duration < DURATION_GUIDELINE_MIN_S || measured.duration > DURATION_GUIDELINE_MAX_S) {
        diag(infos, 'info', 'duration-guideline', `${at}#audio`);
      }
      if (Math.abs(measured.lufs - LOUDNESS_TARGET_LUFS) > LOUDNESS_TOLERANCE_LU) {
        diag(errors, 'error', 'loudness-target-deviation', `${at}#audio`);
      }
      const tempo = transcript && measured.duration > 0 ? transcript.length / measured.duration : null;
      measurements.push({
        story_id: storyId,
        locale,
        tier,
        file: relAudio,
        tone: typeof story?.tone === 'string' ? story.tone : null,
        duration_declared_s: declared,
        duration_measured_s: round(measured.duration, 2),
        loudness_lufs: Number.isFinite(measured.lufs) ? round(measured.lufs, 1) : '-inf',
        tempo_chars_per_s: tempo === null ? null : round(tempo, 1),
        sha256: hash,
      });
    }
  }
  if (!tool.available) diag(errors, 'error', 'audio-tool-missing', 'audio');

  // 09 audio row: narration is normalized to the −16 LUFS target — the whole
  // package must sit in one loudness, so the pairwise spread is judged, too.
  const finite = measurements
    .filter((m) => typeof m.loudness_lufs === 'number')
    .map((m) => m.loudness_lufs);
  if (finite.length >= 2 && Math.max(...finite) - Math.min(...finite) > LOUDNESS_TOLERANCE_LU) {
    diag(errors, 'error', 'loudness-spread', 'audio');
  }

  // 09 §3: memorial "сцішае тэмп начытвання" — a relative proxy: a memorial
  // story must not read faster than the package's typical standard pace.
  // With no standard story to compare against, the tempo is recorded only.
  const standard = measurements
    .filter((m) => m.tone === 'standard' && m.tempo_chars_per_s !== null)
    .map((m) => m.tempo_chars_per_s)
    .sort((a, b) => a - b);
  if (standard.length > 0) {
    const mid = Math.floor(standard.length / 2);
    const median = standard.length % 2 ? standard[mid] : (standard[mid - 1] + standard[mid]) / 2;
    for (const m of measurements) {
      if (m.tone === 'memorial' && m.tempo_chars_per_s !== null && m.tempo_chars_per_s > median) {
        diag(warnings, 'warning', 'memorial-tempo-not-restrained', `${m.locale}/${m.tier}/stops.json#${m.story_id}`);
      }
    }
  }

  // The checklist mirrors the report's own severity arrays (error → fail,
  // warning → warn, info → the pass-with-note row) — a summary row must never
  // outstate a diagnostic it summarizes: ok stays true over a warn row.
  const fired = new Set([...errors, ...warnings, ...infos].map((d) => d.rule));
  const failed = new Set(errors.map((d) => d.rule));
  const warned = new Set(warnings.map((d) => d.rule));
  const hasAudio = measurements.length > 0;
  const machineRow = (rule, source, item, informational = false) => {
    const hit = fired.has(rule);
    const outcome = !hit
      ? hasAudio
        ? 'pass'
        : 'n/a'
      : failed.has(rule)
        ? 'fail'
        : warned.has(rule)
          ? 'warn'
          : 'pass';
    return {
      kind: 'machine',
      source,
      item,
      outcome,
      ...(informational && hit
        ? { note: 'outside the 60–120 s guideline; recorded, non-blocking (09 §3 invariant 7)' }
        : {}),
    };
  };
  const checklist = [
    machineRow('missing-transcript', '09 §3 invariant 1', 'every audio file has a transcript'),
    machineRow('duration-mismatch', 'issue #300 criterion 1', 'recording duration matches the declared duration_s'),
    machineRow('duration-guideline', '13 §3', 'duration inside the 60–120 s guideline', true),
    machineRow('loudness-target-deviation', '09 §6 audio row', 'loudness within ±2 LU of the −16 LUFS target'),
    machineRow('loudness-spread', 'issue #300 criterion 2', 'loudness consistent across the package'),
    machineRow('duplicate-audio', '13 §2', 'no recording shared by two stories'),
    machineRow('memorial-tempo-not-restrained', '09 §3 tone', 'memorial stories read no faster than standard'),
    machineRow('ad-call-in-transcript', '13 §3', 'no ad call to buy the extension in the narration'),
    machineRow('ordering-reference-in-transcript', '13 §2', 'no narration that requires hearing a previous file'),
    { kind: 'human', source: '13 §5', item: 'the text was read aloud and the audio matches the transcript', outcome: 'author' },
    { kind: 'human', source: '13 §2', item: 'every story is understandable from any approach, without the previous file', outcome: 'author' },
    { kind: 'human', source: '13 §3', item: 'restrained tone at memorial places is confirmed by the author', outcome: 'author' },
  ];

  measurements.sort((a, b) =>
    a.locale < b.locale ? -1 : a.locale > b.locale ? 1 : a.tier < b.tier ? -1 : a.tier > b.tier ? 1 : a.story_id < b.story_id ? -1 : a.story_id > b.story_id ? 1 : 0,
  );

  return { ok: errors.length === 0, errors, warnings, infos, measurements, checklist };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const dir = args[0] === '--in' ? args[1] : undefined;
  if (!dir) {
    console.error('usage: verify-audio.mjs --in <package-dir>');
    process.exitCode = 2;
  } else {
    const result = await verifyAudio(dir);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.ok ? 0 : 1;
  }
}
