// G21.04 — offline generator of the demo-route acceptance audio (issue #537).
// Replaces the 85-byte `KUDY-DEMO-AUDIO` placeholder with short valid M4A
// tones: an AAC-encoded sine, loudness-normalized to the 09 §6 −16 LUFS
// target, one distinct pitch per media record so the recordings are never
// byte-identical (verify-audio duplicate-audio rule, 13 §2).
//
// Generation source (recorded per issue criterion 1): ffmpeg lavfi `sine`
// + `loudnorm` (I=-16, TP=-1.5) + native AAC encoder, 44.1 kHz mono,
// 6 s per file. Rights: CC0 1.0 — the tones are authored for KUDY and
// waived into the public domain; the media.json license/credit records
// carry the same statement (media.schema.json).
//
// Checksums are ffmpeg-build-dependent, so the committed media.json is the
// byte-level lock: every generated file must match its record's sha256
// (validate-package media-sha-unmatched / media-bytes-mismatch fail
// otherwise). `--verify` re-checks exactly that without writing and is the
// deterministic reproduction command; a missing ffmpeg fails closed with a
// diagnostic, never a silent pass (the verify-audio audio-tool-missing
// pattern).
//
// Usage:
//   node tools/demo-audio/generate-demo-audio.mjs            # write the four files
//   node tools/demo-audio/generate-demo-audio.mjs --verify   # check bytes against media.json
//
// Scope: fixtures/content/demo-route only — this tool owns no other
// package's media (G21.04 criterion 2).
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOL_ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TOOL_ROOT, '..', '..');
const PACKAGE = path.join(REPO_ROOT, 'fixtures', 'content', 'demo-route');

const DURATION_S = 6;
const SAMPLE_RATE = 44100;
const BITRATE = '64k';
const LOUDNESS_TARGET_LUFS = -16;
const PITCHES_HZ = {
  'be/base/audio/story-1-base.m4a': 220,
  'be/extended/audio/story-2-ext.m4a': 261.63,
  'en/base/audio/story-1-base.m4a': 329.63,
  'en/extended/audio/story-2-ext.m4a': 392,
};

const VERIFY = process.argv.includes('--verify');

function run(bin, args) {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: 60000, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ err, stdout, stderr });
    });
  });
}

async function ffmpegAvailable() {
  const probe = await run('ffmpeg', ['-version']);
  if (probe.err) {
    console.error('generate-demo-audio: ffmpeg is not available on PATH — the generator fails closed, nothing was written');
    process.exit(2);
  }
}

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

async function probeDuration(file) {
  const probe = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', file]);
  if (probe.err) return null;
  try {
    const duration = Number(JSON.parse(probe.stdout)?.format?.duration);
    return Number.isFinite(duration) && duration > 0 ? duration : null;
  } catch {
    return null;
  }
}

const media = JSON.parse(fs.readFileSync(path.join(PACKAGE, 'media.json'), 'utf8'));
await ffmpegAvailable();

if (VERIFY) {
  const failures = [];
  for (const rel of Object.keys(PITCHES_HZ)) {
    const abs = path.join(PACKAGE, rel);
    if (!fs.existsSync(abs)) {
      failures.push(`${rel}: missing`);
      continue;
    }
    const sha = sha256(abs);
    const bytes = fs.statSync(abs).size;
    const declared = media.find((m) => m.sha256 === sha);
    if (!declared) {
      failures.push(`${rel}: sha256 ${sha} not covered by media.json`);
      continue;
    }
    if (declared.bytes !== bytes) failures.push(`${rel}: ${bytes} bytes, media.json declares ${declared.bytes}`);
    const duration = await probeDuration(abs);
    if (duration === null) failures.push(`${rel}: does not decode (ffprobe)`);
    else if (Math.abs(duration - DURATION_S) > 1) failures.push(`${rel}: duration ${duration.toFixed(2)}s outside the ±1 s band of ${DURATION_S}s`);
  }
  if (failures.length > 0) {
    console.error(`generate-demo-audio --verify FAILED:\n${failures.map((f) => `  ${f}`).join('\n')}`);
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: true, files: Object.keys(PITCHES_HZ).length, duration_s: DURATION_S, loudness_target_lufs: LOUDNESS_TARGET_LUFS }, null, 2));
  process.exit(0);
}

const report = [];
for (const [rel, frequency] of Object.entries(PITCHES_HZ)) {
  const abs = path.join(PACKAGE, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const generate = await run('ffmpeg', [
    '-y', '-v', 'error',
    '-f', 'lavfi', '-i', `sine=frequency=${frequency}:duration=${DURATION_S}:sample_rate=${SAMPLE_RATE}`,
    '-af', `loudnorm=I=${LOUDNESS_TARGET_LUFS}:TP=-1.5:LRA=11`,
    '-c:a', 'aac', '-b:a', BITRATE,
    abs,
  ]);
  if (generate.err) {
    console.error(`generate-demo-audio: ffmpeg failed for ${rel}:\n${generate.stderr}`);
    process.exit(1);
  }
  report.push({ file: rel, sha256: sha256(abs), bytes: fs.statSync(abs).size });
}
console.log(JSON.stringify(report, null, 2));
console.error('next: copy the printed sha256/bytes into media.json in the same commit (media.json is the lock)');
