// The YouTube collector (G17.05): campaign video ids → yt-dlp subtitles →
// timecode-anchored transcript paragraphs + metadata + a slug-named thumbnail
// cover (docs/24_web_collection.md «Калектары → YouTube», «Фота» — вокладка
// тым жа правілам імёнаў). Manual subtitles win over automatic (якасць); the
// kind and language are recorded. Videos without any subtitles land in the
// campaign's asr-backlog and the run continues — speech recognition is not in
// this version.
//
// Two-phase invocation keeps the selection logic in this repo (the AC2 revert
// proof targets it): phase 1 dumps the video JSON (available subtitle
// languages, no downloads), this code picks kind+language, phase 2 writes the
// one chosen VTT. The binary lives behind the `command` boundary — tests run
// the real spawn path with a stub command, the live run is manual.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fillYoutubeRecord, sha256Hex, upsertRawRecord } from './store.mjs';
import { slugify } from './snapshot.mjs';

// VTT → cues: one entry per cue block, inline tags and speaker labels are not
// content — stripped; whitespace collapsed. NOTE/STYLE/REGION blocks skipped.
export function parseVtt(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new Error('empty VTT — nothing to parse');
  }
  const cues = [];
  const blocks = text.replace(/\r\n/g, '\n').trim().split(/\n\n+/);
  for (const block of blocks) {
    if (/^(WEBVTT|NOTE|STYLE|REGION)\b/m.test(block.split('\n')[0])) continue;
    const timing = block.split('\n').find((line) => line.includes('-->'));
    if (timing === undefined) continue;
    const match = timing.match(/(\d{2,}):(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(\d{2,}):(\d{2}):(\d{2})[.,](\d{3})/);
    if (!match) continue;
    const [, h1, m1, s1, ms1, h2, m2, s2, ms2] = match;
    const body = block
      .split('\n')
      .filter((line) => !line.includes('-->') && !/^\d+$/.test(line.trim()))
      .join(' ')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (body === '') continue;
    cues.push({
      startMs: Number(h1) * 3600000 + Number(m1) * 60000 + Number(s1) * 1000 + Number(ms1),
      endMs: Number(h2) * 3600000 + Number(m2) * 60000 + Number(s2) * 1000 + Number(ms2),
      text: body,
    });
  }
  return cues;
}

function renderClock(ms) {
  const total = Math.floor(ms / 1000);
  const parts = [Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60];
  return parts.map((n) => String(n).padStart(2, '0')).join(':');
}

// Transcript paragraphs: one paragraph per cue, anchored at its start
// timecode «[HH:MM:SS]» (seconds granularity — navigation anchors, not
// captions). Consecutive duplicate texts (rolling auto-caption overlap) keep
// only the first — the transcript must not repeat itself.
export function renderTranscript(cues) {
  const paragraphs = [];
  let lastText = null;
  for (const cue of cues) {
    if (cue.text === lastText) continue;
    lastText = cue.text;
    paragraphs.push(`[${renderClock(cue.startMs)}] ${cue.text}`);
  }
  return paragraphs.join('\n\n') + '\n';
}

// The language order for one kind: the video's original language first, the
// rest alphabetical — deterministic for a given video.
function orderedLanguages(languages, original) {
  const rest = [...languages].filter((lang) => lang !== original).sort();
  return (original !== undefined && languages.has(original) ? [original] : []).concat(rest);
}

// THE subtitle preference (the AC2 revert proof targets this): manual wins
// over automatic; inside one kind the original language wins. Returns null
// when neither kind has any available language.
function pickLanguage(info) {
  for (const [kind, available] of [
    ['manual', new Set(Object.keys(info.subtitles ?? {}))],
    ['automatic', new Set(Object.keys(info.automatic_captions ?? {}))],
  ]) {
    const lang = orderedLanguages(available, info.language)[0];
    if (lang) return { kind, lang };
  }
  return null;
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command[0], [...command.slice(1), ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', (error) => {
      reject(new Error(`${command.join(' ')}: ${error.code === 'ENOENT' ? 'binary not found — install yt-dlp (e.g. pip install yt-dlp) and rerun' : error.message}`));
    });
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`${command.join(' ')} exited ${code}: ${stderr.trim().split('\n').slice(-3).join('; ') || 'no stderr'}`));
        return;
      }
      resolve(stdout);
    });
  });
}

async function defaultLoadThumbnail(url) {
  const response = await fetch(url);
  if (response.status >= 400) throw new Error(`thumbnail ${url}: HTTP ${response.status}`);
  const ext = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' })[response.headers.get('content-type')?.split(';')[0]] ??
    (url.match(/\.(jpe?g|png|webp)(?:$|\?)/i)?.[1]?.toLowerCase().replace('jpeg', 'jpg') ?? null);
  if (!ext) throw new Error(`thumbnail ${url}: unknown image format`);
  return { bytes: Buffer.from(await response.arrayBuffer()), ext };
}

// The yt-dlp boundary. command defaults to the binary from PATH; tests pass a
// stub command ([node, stub.js]) and exercise the real spawn/parse path.
export function createYoutubeFetch({ command = ['yt-dlp'], loadThumbnail = defaultLoadThumbnail } = {}) {
  return async function fetchYoutube({ videoId, stagingDir }) {
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    // Phase 1: metadata only — available subtitle languages, nothing written.
    const info = JSON.parse(runJson(await runCommand(command, ['--dump-json', '--skip-download', url])));
    // Phase 2: write exactly the one chosen subtitle file.
    fs.mkdirSync(stagingDir, { recursive: true });
    let selected = null;
    const chosen = pickLanguage(info);
    if (chosen) {
      const template = path.join(stagingDir, videoId);
      await runCommand(command, [
        '--skip-download', '--write-subs', '--write-auto-subs', '--sub-format', 'vtt',
        '--sub-langs', chosen.lang, '-o', template, url,
      ]);
      const file = `${template}.${chosen.lang}.vtt`;
      if (fs.existsSync(file)) selected = { ...chosen, path: file };
    }
    let cover = null;
    // Only a collected video stores its cover — a video without usable
    // subtitles goes to the asr-backlog and would throw the fetch away.
    if (selected && info.thumbnail) {
      cover = await loadThumbnail(info.thumbnail);
    }
    return { info, url, selected, cover };
  };
}

function runJson(stdout) {
  // yt-dlp prints one JSON object per requested video on stdout; warnings may
  // precede it, so take the last line that parses.
  for (const line of stdout.trim().split('\n').reverse()) {
    if (line.trim().startsWith('{')) return line.trim();
  }
  throw new Error('yt-dlp produced no JSON on stdout');
}

function renderUploadDate(raw) {
  if (typeof raw !== 'string' || !/^\d{8}$/.test(raw)) return null;
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

// The asr-backlog (docs/24: «Відэа зусім без субтытраў трапляюць у адкладзены
// спіс asr-backlog») — append-only JSONL in the campaign's run dir, one line
// per deferred video.
export function createBacklogWriter(backlogPath) {
  let madeDir = false;
  return function backlog(entry) {
    if (!madeDir) {
      fs.mkdirSync(path.dirname(backlogPath), { recursive: true });
      madeDir = true;
    }
    fs.appendFileSync(backlogPath, `${JSON.stringify(entry)}\n`);
  };
}

// The step body: shell row (G17.01.a's contract — the library row exists
// before the pipeline fills it) → fetch → snapshot dir per the slug-hash rule
// (transcript.md + subtitles.vtt + metadata.json + media cover) → row filled
// with content_hash/snapshot_path/media_dir. No usable subtitles →
// asr-backlog entry, done-with-note, run continues; no snapshot files.
export async function processYoutubeStep(ctx, step) {
  const { db, campaign, campaignId, now, snapshotsRoot, youtubeFetch, backlog } = ctx;
  const url = `https://www.youtube.com/watch?v=${step.ref}`;
  registerShell(db, campaign, campaignId, url, now);
  const runDir = path.join(snapshotsRoot, campaignId.slice(0, 12));
  const stagingDir = path.join(runDir, `.yt-${step.ref}`);
  try {
    const { info, selected, cover } = await youtubeFetch({ videoId: step.ref, stagingDir });
    if (!selected) {
      backlog({ video_id: step.ref, url, reason: 'no subtitles available', collected_at: now });
      return `asr-backlog: video ${step.ref} has no usable subtitles — deferred to the backlog`;
    }
    const cues = parseVtt(fs.readFileSync(selected.path, 'utf8'));
    if (cues.length === 0) {
      backlog({ video_id: step.ref, url, reason: 'subtitles file is empty', collected_at: now });
      return `asr-backlog: video ${step.ref} subtitles are empty — deferred to the backlog`;
    }
    if (typeof info.title !== 'string' || info.title.trim() === '') {
      throw new Error(`video ${step.ref}: yt-dlp returned no title — the record cannot be identified`);
    }
    const transcript = renderTranscript(cues);
    const paragraphCount = transcript.trimEnd().split('\n\n').length;
    const slug = slugify(info.title);
    const snapshotDir = path.join(runDir, `${slug}-${sha256Hex(url).slice(0, 8)}`);
    const mediaDir = path.join(snapshotDir, 'media');
    fs.mkdirSync(mediaDir, { recursive: true });
    fs.copyFileSync(selected.path, path.join(snapshotDir, 'subtitles.vtt'));
    fs.writeFileSync(path.join(snapshotDir, 'transcript.md'), Buffer.from(transcript, 'utf8'));
    let coverFile = null;
    if (cover) {
      coverFile = `${slug}-cover.${cover.ext}`;
      fs.writeFileSync(path.join(mediaDir, coverFile), cover.bytes);
    }
    const metadata = {
      title: info.title,
      channel: info.channel ?? info.uploader ?? null,
      upload_date: renderUploadDate(info.upload_date),
      duration_s: typeof info.duration === 'number' ? Math.round(info.duration) : null,
      language: info.language ?? null,
      subtitle_kind: selected.kind,
      subtitle_language: selected.lang,
      cover: coverFile ? `media/${coverFile}` : null,
    };
    fs.writeFileSync(path.join(snapshotDir, 'metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`);
    fillYoutubeRecord(db, {
      campaignId,
      url,
      contentHash: sha256Hex(transcript),
      snapshotPath: snapshotDir,
      mediaDir,
    });
    return `${selected.kind}/${selected.lang}: ${paragraphCount} paragraph(s), cover ${coverFile ?? 'none'}`;
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
}

export function registerShell(db, campaign, campaignId, url, now) {
  upsertRawRecord(db, {
    id: randomUUID(),
    campaign_id: campaignId,
    source_type: 'youtube',
    url,
    canonical_url: url,
    collected_at: now,
    city: campaign.city,
    topics: JSON.stringify(campaign.topics),
    rights: 'research_only',
    content_hash: null,
    status: 'raw',
    snapshot_path: null,
    media_dir: null,
  });
}
