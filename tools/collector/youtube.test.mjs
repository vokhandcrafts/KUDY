// YouTube collector suites (G17.05). No external network: the stub yt-dlp
// command (testkit.writeYtDlpStub) is spawned by the production pipeline
// exactly like the real binary, subtitle texts are bundled VTT fixtures, and
// the thumbnail comes from a local fixture server. The tests named AC1…AC5
// are the issue's acceptance criteria in order; the proof of AC2 is its
// revert: swapping the manual-over-automatic preference fails that test
// (docs/agent-tasks/collection/G17.05.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseCampaign } from './campaign.mjs';
import { createBacklogWriter, createYoutubeFetch, parseVtt, renderTranscript } from './youtube.mjs';
import { defaultHandlers, runCampaign } from './runloop.mjs';
import { openStore, sha256Hex } from './store.mjs';
import {
  AUTO_VTT,
  MANUAL_VTT,
  articleHtml,
  campaignYaml,
  jpegBytes,
  makeTempDir,
  openCampaignFixture,
  startFixtureServer,
  writeYtDlpStub,
  youtubeInfo,
} from './testkit.mjs';

const COVER_JPG = jpegBytes(320, 180);

// Shared arrangement: stub yt-dlp command + campaign with the given video ids
// + thumbnail served by a local fixture server. The campaign fixture is
// validated first — a throw after the fixture server starts would leak it and
// hold the test runner's event loop open.
async function youtubeSetup(playlist, { ids = Object.keys(playlist), command = null } = {}) {
  const dir = makeTempDir();
  const page = path.join(dir, 'seed-page.html');
  fs.writeFileSync(page, articleHtml(), 'utf8');
  const { file, source, parsed, db } = openCampaignFixture(
    dir,
    campaignYaml({
      seeds: `seeds:\n  - ${pathToFileURL(page).href}`,
      youtube: `youtube:\n${ids.map((id) => `  - ${id}`).join('\n')}`,
    })
  );
  const server = await startFixtureServer({
    '/cover.jpg': { headers: { 'content-type': 'image/jpeg' }, body: COVER_JPG },
  });
  // The stub bakes the playlist JSON at write time — inject the local cover
  // URL before writing it.
  const withThumbnail = structuredClone(playlist);
  for (const entry of Object.values(withThumbnail)) {
    if (entry?.info) entry.info.thumbnail ??= server.url('/cover.jpg');
  }
  const stubCommand = command ?? writeYtDlpStub(dir, withThumbnail);
  const snapshotsRoot = path.join(dir, 'snapshots');
  const handlers = defaultHandlers({
    youtubeFetch: createYoutubeFetch({ command: stubCommand }),
  });
  return {
    server,
    dir,
    db,
    handlers,
    snapshotsRoot,
    run: (campaign = parsed.campaign) =>
      runCampaign(db, campaign, { sourcePath: file, contentHash: sha256Hex(source), snapshotsRoot, handlers }),
  };
}

test('AC1: VTT fixture → paragraphs anchored to timecodes; count and first/last asserted', async (t) => {
  const cues = parseVtt(MANUAL_VTT);
  assert.equal(cues.length, 3);
  assert.equal(cues[0].startMs, 1000);
  assert.equal(cues[2].startMs, 10000);
  const transcript = renderTranscript(cues);
  const paragraphs = transcript.trimEnd().split('\n\n');
  assert.equal(paragraphs.length, 3);
  assert.equal(paragraphs[0], '[00:00:01] Witajcie w Gdańsku.');
  assert.match(paragraphs[1], /^\[00:00:05\] Stocznia Gdańska zaczęła strajk w sierpniu 1980\.$/);
  assert.equal(paragraphs[2], '[00:00:10] To początek Solidarności.');
  assert.match(transcript, /\[00:00:01\]/, 'first timecode anchor');
  assert.match(transcript, /\[00:00:10\]/, 'last timecode anchor');
});

test('AC1 end-to-end: the run stores the transcript with the anchored paragraphs', async (t) => {
  const fx = await youtubeSetup({ dQw4w9WgXcQ: { info: youtubeInfo(), vtt: { en: MANUAL_VTT } } });
  t.after(() => fx.server.close());
  const run = await fx.run();
  assert.equal(run.failed, 0);
  const row = fx.db.prepare("SELECT * FROM raw_records WHERE source_type = 'youtube'").get();
  assert.ok(row.snapshot_path);
  const transcript = fs.readFileSync(path.join(row.snapshot_path, 'transcript.md'), 'utf8');
  const paragraphs = transcript.trimEnd().split('\n\n');
  assert.equal(paragraphs.length, 3);
  assert.equal(paragraphs[0], '[00:00:01] Witajcie w Gdańsku.');
  assert.equal(paragraphs[2], '[00:00:10] To początek Solidarności.');
});

// Runs the campaign and reads back the single youtube record's snapshot
// artifacts (these suites arrange exactly one subtitle-bearing video).
async function storeSingleYoutubeRecord(fx) {
  const run = await fx.run();
  assert.equal(run.failed, 0);
  const row = fx.db.prepare("SELECT * FROM raw_records WHERE source_type = 'youtube'").get();
  const metadata = JSON.parse(fs.readFileSync(path.join(row.snapshot_path, 'metadata.json'), 'utf8'));
  const transcript = fs.readFileSync(path.join(row.snapshot_path, 'transcript.md'), 'utf8');
  return { run, row, metadata, transcript };
}

test('AC2: manual subtitles are stored over automatic ones and the kind is recorded', async (t) => {
  const fx = await youtubeSetup({
    dQw4w9WgXcQ: { info: youtubeInfo(), vtt: { en: MANUAL_VTT } },
    // The automatic track would produce different text — the manual win is visible.
  });
  t.after(() => fx.server.close());
  const { row, metadata, transcript } = await storeSingleYoutubeRecord(fx);
  assert.equal(metadata.subtitle_kind, 'manual');
  assert.equal(metadata.subtitle_language, 'en');
  assert.match(transcript, /Witajcie w Gdańsku/, 'manual text stored, not the automatic track');
  const step = fx.db.prepare("SELECT detail FROM run_log WHERE kind = 'youtube'").get();
  assert.match(step.detail, /manual\/en: 3 paragraph/);
});

test('AC2: rolling auto-caption duplicates collapse; the automatic fallback works', async (t) => {
  const fx = await youtubeSetup({
    aQw4w9WgXcQ: {
      info: youtubeInfo({
        id: 'aQw4w9WgXcQ',
        subtitles: {},
        automatic: { en: [{ ext: 'vtt', url: 'https://example/auto.en.vtt' }] },
      }),
      vtt: { en: AUTO_VTT },
    },
  });
  t.after(() => fx.server.close());
  const { metadata, transcript } = await storeSingleYoutubeRecord(fx);
  assert.equal(metadata.subtitle_kind, 'automatic');
  const paragraphs = transcript.trimEnd().split('\n\n');
  assert.equal(paragraphs.length, 2, 'the rolling duplicate is collapsed');
  assert.equal(paragraphs[0], '[00:00:02] witajcie w gdansku');
});

test('AC3: metadata row complete; the thumbnail is the slug-named cover', async (t) => {
  const fx = await youtubeSetup({ dQw4w9WgXcQ: { info: youtubeInfo(), vtt: { en: MANUAL_VTT } } });
  t.after(() => fx.server.close());
  const { row, metadata } = await storeSingleYoutubeRecord(fx);
  assert.equal(metadata.title, 'Gdansk shipyard — the August story');
  assert.equal(metadata.channel, 'History of the Coast');
  assert.equal(metadata.upload_date, '2024-08-15');
  assert.equal(metadata.duration_s, 217);
  assert.equal(metadata.language, 'en');
  assert.equal(metadata.cover, 'media/gdansk-shipyard-the-august-story-cover.jpg');
  const cover = path.join(row.snapshot_path, 'media', 'gdansk-shipyard-the-august-story-cover.jpg');
  const bytes = fs.readFileSync(cover);
  assert.equal(bytes[0], 0xff, 'cover bytes are the served JPEG');
  assert.equal(fs.existsSync(path.join(row.snapshot_path, 'subtitles.vtt')), true, 'raw VTT kept');
  assert.ok(row.content_hash, 'the record is filled with the transcript hash');
  assert.ok(fs.existsSync(row.snapshot_path), 'snapshot dir exists on disk');
  assert.ok(fs.existsSync(row.media_dir));
});

test('AC4: a subtitle-less video lands in asr-backlog and the run continues', async (t) => {
  const fx = await youtubeSetup({
    dQw4w9WgXcQ: { info: youtubeInfo(), vtt: { en: MANUAL_VTT } },
    aQw4w9WgXcQ: {
      info: youtubeInfo({ id: 'aQw4w9WgXcQ', subtitles: {}, automatic: {} }),
      vtt: {},
    },
  }, { ids: ['dQw4w9WgXcQ', 'aQw4w9WgXcQ'] });
  t.after(() => fx.server.close());
  const run = await fx.run();
  assert.equal(run.failed, 0, 'the subtitle-less video does not fail the run');
  assert.equal(run.done, 3, 'seed + both videos processed');
  const backlogFile = path.join(fx.snapshotsRoot, run.campaignId.slice(0, 12), 'asr-backlog.jsonl');
  const lines = fs.readFileSync(backlogFile, 'utf8').trimEnd().split('\n').map((line) => JSON.parse(line));
  assert.equal(lines.length, 1);
  assert.equal(lines[0].video_id, 'aQw4w9WgXcQ');
  assert.equal(lines[0].url, 'https://www.youtube.com/watch?v=aQw4w9WgXcQ');
  assert.match(lines[0].reason, /no subtitles/);
  const emptyStep = fx.db.prepare("SELECT status, detail FROM run_log WHERE kind = 'youtube' AND ref = 'aQw4w9WgXcQ'").get();
  assert.equal(emptyStep.status, 'done');
  assert.match(emptyStep.detail, /asr-backlog/);
  // Only the subtitle-bearing video has a snapshot.
  const snapshotRows = fx.db.prepare("SELECT snapshot_path FROM raw_records WHERE source_type = 'youtube' AND snapshot_path IS NOT NULL").all();
  assert.equal(snapshotRows.length, 1);
});

test('AC5: a missing yt-dlp binary answers with an explicit diagnostic and no partial records', async (t) => {
  const dir = makeTempDir();
  const absent = path.join(dir, 'no-such-yt-dlp');
  const fx = await youtubeSetup(
    { dQw4w9WgXcQ: { info: youtubeInfo(), vtt: { en: MANUAL_VTT } } },
    { command: [absent] }
  );
  t.after(() => fx.server.close());
  const run = await fx.run();
  assert.equal(run.done, 1, 'only the seed completes');
  assert.equal(run.failed, 1);
  const step = fx.db.prepare("SELECT error FROM run_log WHERE kind = 'youtube'").get();
  assert.match(step.error, /not found — install yt-dlp/);
  // No partial records: no snapshot, no backlog, the shell row stays empty.
  const row = fx.db.prepare("SELECT snapshot_path, content_hash FROM raw_records WHERE source_type = 'youtube'").get();
  assert.equal(row.snapshot_path, null);
  assert.equal(row.content_hash, null);
  assert.equal(fs.existsSync(path.join(fx.snapshotsRoot, run.campaignId.slice(0, 12), 'asr-backlog.jsonl')), false);
  const runDirEntries = fs.existsSync(path.join(fx.snapshotsRoot, run.campaignId.slice(0, 12)))
    ? fs.readdirSync(path.join(fx.snapshotsRoot, run.campaignId.slice(0, 12)))
    : [];
  assert.equal(runDirEntries.filter((name) => name.startsWith('.yt-')).length, 0, 'no staging dir left behind');
});

test('a failing yt-dlp run (non-zero exit) is a named diagnostic; nothing is written', async (t) => {
  const fx = await youtubeSetup({
    dQw4w9WgXcQ: { info: youtubeInfo(), vtt: { en: MANUAL_VTT } },
    absentId9Xc: null,
  }, { ids: ['dQw4w9WgXcQ', 'absentId9Xc'] });
  t.after(() => fx.server.close());
  const run = await fx.run();
  assert.equal(run.failed, 1);
  const step = fx.db.prepare("SELECT error FROM run_log WHERE kind = 'youtube' AND ref = 'absentId9Xc'").get();
  assert.match(step.error, /exited 1/);
  assert.match(step.error, /stub: no fixture/);
  const failedRow = fx.db.prepare("SELECT snapshot_path, content_hash FROM raw_records WHERE source_type = 'youtube' AND url LIKE '%absentId9Xc'").get();
  assert.equal(failedRow.snapshot_path, null, 'no snapshot for the failed video');
  assert.equal(failedRow.content_hash, null);
});

test('asr-backlog writer appends one JSONL line per deferred video', () => {
  const file = path.join(makeTempDir(), 'nested', 'asr-backlog.jsonl');
  const backlog = createBacklogWriter(file);
  backlog({ video_id: 'aQw4w9WgXcQ', url: 'https://www.youtube.com/watch?v=aQw4w9WgXcQ', reason: 'no subtitles available', collected_at: '2026-09-25T00:00:00.000Z' });
  backlog({ video_id: 'eQw4w9WgXcQ', url: 'https://www.youtube.com/watch?v=eQw4w9WgXcQ', reason: 'subtitles file is empty', collected_at: '2026-09-25T00:00:01.000Z' });
  const lines = fs.readFileSync(file, 'utf8').trimEnd().split('\n');
  assert.equal(lines.length, 2);
  assert.deepEqual(Object.keys(JSON.parse(lines[0])), ['video_id', 'url', 'reason', 'collected_at']);
});
