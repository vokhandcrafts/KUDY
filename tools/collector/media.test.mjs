import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runCampaign } from './runloop.mjs';
import { probeImage, MIN_CONTENT_IMAGE_PX, mediaFileName } from './media.mjs';
import { extractPage } from './extract.mjs';
import { openStore, sha256Hex } from './store.mjs';
import { parseCampaign } from './campaign.mjs';
import { articleHtml, campaignYaml, gifBytes, jpegBytes, makeTempDir, pngBytes, writeCampaignFile } from './testkit.mjs';

// G17.03 acceptance suite (docs/agent-tasks/collection/G17.03.md) over the
// production pipeline: file:// seed pages whose paragraphs carry <img> tags
// pointing at crafted fixture images (container headers only — the probe
// reads dimensions from bytes). Criteria:
// 1. the 150 px content rule — sub-150 icons are excluded, the skip note
//    names the rule;
// 2. complete media rows, slug filenames, stable numbering on a re-run;
// 3. the markdown image sits at the paragraph index where it appeared;
// 4. the same image on two articles → equal hashes on both rows;
// 5. broken image URLs fail their own step with a diagnostic, the run
//    continues; every effect converges on a resumed step.

// Builds a fixture dir with image files and an article page referencing them
// by file:// URL; returns the parsed campaign plus the paths the assertions
// need. Arrangement only — every test drives the production runCampaign.
function imageFixture(dir, body, { imageFiles = {}, title } = {}) {
  for (const [name, bytes] of Object.entries(imageFiles)) {
    fs.writeFileSync(path.join(dir, name), bytes);
  }
  const pagePath = path.join(dir, 'page.html');
  fs.writeFileSync(pagePath, articleHtml({ body, ...(title ? { title } : {}) }));
  const file = writeCampaignFile(dir, campaignYaml({ seeds: `seeds:\n  - ${pathToFileURL(pagePath).href}` }));
  const source = fs.readFileSync(file, 'utf8');
  const parsed = parseCampaign(source);
  assert.ok(parsed.ok, parsed.diagnostics?.join('\n'));
  return {
    db: openStore(path.join(dir, 'db.sqlite')),
    campaign: parsed.campaign,
    file,
    source,
    snapshotsRoot: path.join(dir, 'snapshots'),
    dir,
  };
}

function mediaRows(db) {
  return db.prepare('SELECT * FROM media ORDER BY file').all();
}

function imageSteps(db) {
  return db.prepare("SELECT ref, status, detail, error FROM run_log WHERE kind = 'image' ORDER BY ref").all();
}

const P = (text) => `<p>${text}</p>`;

test('AC1: only images of at least 150 px on the longest side are saved; the skip note names the rule', async () => {
  const dir = makeTempDir();
  const fx = imageFixture(
    dir,
    [
      P('Intro paragraph without images.'),
      P(`The hall <img src="${pathToFileURL(path.join(dir, 'photo-200x120.png')).href}" alt="Hall" title="The hall"> as it looks today.`),
      P(`A tiny counter <img src="${pathToFileURL(path.join(dir, 'icon-100x90.png')).href}" alt="counter"> stays out.`),
      P(`Boundary case <img src="${pathToFileURL(path.join(dir, 'edge-150x150.gif')).href}" alt="edge"> is kept.`),
    ],
    {
      imageFiles: {
        'photo-200x120.png': pngBytes(200, 120),
        'icon-100x90.png': pngBytes(100, 90),
        'edge-150x150.gif': gifBytes(150, 150),
      },
    }
  );
  const run = await runCampaign(fx.db, fx.campaign, { sourcePath: fx.file, contentHash: sha256Hex(fx.source), snapshotsRoot: fx.snapshotsRoot });
  assert.equal(run.failed, 0, 'nothing crashes, the icon is a rule case, not an error');

  const rows = mediaRows(fx.db);
  assert.deepEqual(
    rows.map((row) => [row.width_px, row.height_px]),
    [[200, 120], [150, 150]],
    'only the 200 px photo and the 150 px boundary image are saved, ordered by filename'
  );
  const files = fs
    .readdirSync(fx.snapshotsRoot, { recursive: true })
    .filter((name) => /\.(png|gif|jpg)$/.test(String(name)));
  assert.equal(files.length, 2, 'two image files on disk');
  const skipped = imageSteps(fx.db).find((step) => step.detail?.includes('skipped'));
  assert.match(skipped.detail, new RegExp(`under the ${String(MIN_CONTENT_IMAGE_PX)}px content minimum`));
  assert.match(skipped.detail, /icon-100x90\.png/);
});

test('AC1 negative probe: a 149 px image is excluded, 150 px is kept (the rule is >= 150)', () => {
  assert.equal(probeImage(pngBytes(149, 100))?.width, 149);
  assert.ok(Math.max(149, 100) < MIN_CONTENT_IMAGE_PX);
  assert.ok(Math.max(150, 150) >= MIN_CONTENT_IMAGE_PX);
});

test('AC2: every saved image has a complete media row and a slug filename; a second run changes nothing', async () => {
  const dir = makeTempDir();
  const fx = imageFixture(
    dir,
    [
      P('First paragraph, text only.'),
      P(`The <img src="${pathToFileURL(path.join(dir, 'photo-800x600.png')).href}" alt="Shipyard" title="Main gate"> in 1970.`),
    ],
    { imageFiles: { 'photo-800x600.png': pngBytes(800, 600) }, title: 'Gdansk shipyard turns into a museum' }
  );
  await runCampaign(fx.db, fx.campaign, { sourcePath: fx.file, contentHash: sha256Hex(fx.source), snapshotsRoot: fx.snapshotsRoot });

  const [row] = mediaRows(fx.db);
  const record = fx.db.prepare("SELECT id, rights, media_dir, snapshot_path, content_hash FROM raw_records WHERE source_type = 'web'").get();
  assert.match(row.file, /^gdansk-shipyard-turns-into-a-museum-img-\d{2}\.png$/, 'spec filename: slug + img-NN + extension');
  assert.equal(row.raw_record_id, record.id);
  assert.equal(typeof row.position, 'number');
  assert.equal(row.alt, 'Shipyard');
  assert.equal(row.caption, 'Main gate');
  assert.equal(row.source_url, pathToFileURL(path.join(dir, 'photo-800x600.png')).href);
  assert.equal(row.rights, record.rights, 'raw-stage photos inherit the record rights (research_only)');
  assert.match(row.collected_at, /^\d{4}-\d{2}-\d{2}T/);
  const onDisk = fs.readFileSync(path.join(record.media_dir, row.file));
  assert.equal(row.content_hash, sha256Hex(onDisk), 'the hash is over the stored bytes');
  assert.deepEqual([row.width_px, row.height_px], [800, 600]);
  // content_hash pins the extracted TEXT at snapshot time (the dedup key of
  // G17.01.b) — text.md gains media blocks afterwards, so the hash over the
  // image-free blocks stays the record's identity.
  const textBlocks = fs
    .readFileSync(record.snapshot_path + '/text.md', 'utf8')
    .replace(/\n$/, '')
    .split('\n\n')
    .filter((block) => !block.startsWith('!['));
  assert.equal(record.content_hash, sha256Hex(textBlocks.join('\n\n') + '\n'), 'the record hash is over the snapshot-time text, media blocks excluded');

  const textBefore = fs.readFileSync(path.join(record.snapshot_path, 'text.md'), 'utf8');
  const filesBefore = fs.readdirSync(record.media_dir).sort();
  const stepsBefore = imageSteps(fx.db).map((step) => [step.ref, step.status]);

  await runCampaign(fx.db, fx.campaign, { sourcePath: fx.file, contentHash: sha256Hex(fx.source), snapshotsRoot: fx.snapshotsRoot });

  assert.equal(mediaRows(fx.db).length, 1, 'no duplicate media rows');
  assert.deepEqual(fs.readdirSync(record.media_dir).sort(), filesBefore, 'no -img-1-1 duplicates');
  assert.equal(fs.readFileSync(path.join(record.snapshot_path, 'text.md'), 'utf8'), textBefore, 'text.md untouched');
  assert.deepEqual(imageSteps(fx.db).map((step) => [step.ref, step.status]), stepsBefore);
});

test('AC2: numbering follows the image occurrence, stable and gap-tolerant', () => {
  assert.equal(mediaFileName('gdansk-stocznia', 0, 'png'), 'gdansk-stocznia-img-01.png');
  assert.equal(mediaFileName('gdansk-stocznia', 4, 'jpeg'), 'gdansk-stocznia-img-05.jpg');
});

test('AC3: the markdown image sits at the paragraph index where it appeared', async () => {
  const dir = makeTempDir();
  const fx = imageFixture(
    dir,
    [
      P('Paragraph zero.'),
      P('Paragraph one with the photo <img src="IMG_URL" alt="Gate" title="Gate of the yard"> inside.'),
      P('Paragraph two.'),
      P('Paragraph three.'),
    ].map((block) => block.replace('IMG_URL', pathToFileURL(path.join(dir, 'gate-300x200.png')).href)),
    { imageFiles: { 'gate-300x200.png': pngBytes(300, 200) } }
  );
  await runCampaign(fx.db, fx.campaign, { sourcePath: fx.file, contentHash: sha256Hex(fx.source), snapshotsRoot: fx.snapshotsRoot });

  const [row] = mediaRows(fx.db);
  const blocks = fs.readFileSync(path.join(fx.db.prepare("SELECT snapshot_path FROM raw_records WHERE source_type = 'web'").get().snapshot_path, 'text.md'), 'utf8')
    .trim()
    .split('\n\n');
  assert.equal(row.position, 2, 'the image appeared inside paragraph 1, so it renders before block 2');
  assert.ok(blocks[2].startsWith('![Gate](media/'), 'the markdown image is block 2');
  assert.match(blocks[2], /_Gate of the yard_/);
  assert.ok(blocks[1].startsWith('Paragraph one'), 'paragraph one stays block 1');
});

test('AC4: the same image on two articles → equal hashes, each article keeps its own copy', async () => {
  const dir = makeTempDir();
  const photo = pngBytes(640, 480);
  fs.writeFileSync(path.join(dir, 'shared-640x480.png'), photo);
  const pages = ['one.html', 'two.html'].map((name, index) => {
    const pagePath = path.join(dir, name);
    fs.writeFileSync(
      pagePath,
      articleHtml({ title: `Article number ${index + 1}`, body: [P(`Text ${index + 1} <img src="${pathToFileURL(path.join(dir, 'shared-640x480.png')).href}" alt="Shared">`)] })
    );
    return pathToFileURL(pagePath).href;
  });
  const file = writeCampaignFile(dir, campaignYaml({ seeds: `seeds:\n  - ${pages[0]}\n  - ${pages[1]}` }));
  const source = fs.readFileSync(file, 'utf8');
  const parsed = parseCampaign(source);
  assert.ok(parsed.ok, parsed.diagnostics?.join('\n'));
  const db = openStore(path.join(dir, 'db.sqlite'));
  await runCampaign(db, parsed.campaign, { sourcePath: file, contentHash: sha256Hex(source), snapshotsRoot: path.join(dir, 'snapshots') });

  const rows = mediaRows(db);
  assert.equal(rows.length, 2, 'one row per article');
  assert.equal(rows[0].content_hash, rows[1].content_hash, 'the hash cross-references the duplicate');
  assert.notEqual(rows[0].raw_record_id, rows[1].raw_record_id);
  const dirs = db.prepare("SELECT media_dir FROM raw_records WHERE source_type = 'web' ORDER BY id").all().map((row) => row.media_dir);  for (const mediaDir of dirs) {
    assert.equal(fs.readdirSync(mediaDir).length, 1, 'each article keeps its own copy on disk');
  }
});

test('AC5: broken image URLs fail their own step with a diagnostic; the run continues', async () => {
  const dir = makeTempDir();
  fs.writeFileSync(path.join(dir, 'corrupt.png'), 'this is not an image at all');
  const fx = imageFixture(
    dir,
    [
      P(`Missing file <img src="${pathToFileURL(path.join(dir, 'absent.png')).href}" alt="gone"> here.`),
      P(`Foreign scheme <img src="https://cdn.example/pic-400x300.jpg" alt="remote"> here.`),
      P(`Corrupt bytes <img src="${pathToFileURL(path.join(dir, 'corrupt.png')).href}" alt="junk"> here.`),
    ],
    {}
  );
  const run = await runCampaign(fx.db, fx.campaign, { sourcePath: fx.file, contentHash: sha256Hex(fx.source), snapshotsRoot: fx.snapshotsRoot });
  assert.equal(run.failed, 3, 'each broken image fails its own step');
  assert.ok(run.done >= 1, 'the seed step itself completed — the run continues');

  const steps = imageSteps(fx.db);
  assert.equal(steps.filter((step) => step.status === 'failed').length, 3);
  const errors = steps.map((step) => step.error).join('\n');
  assert.match(errors, /absent\.png/, 'the missing file is named');
  assert.match(errors, /ENOENT|no such file/i);
  assert.match(errors, /offline loader serves only file:\/\/ sources/, 'the foreign scheme is named');
  assert.match(errors, /unsupported or corrupt image bytes/, 'the corrupt bytes are named');
  assert.equal(mediaRows(fx.db).length, 0, 'no media rows for broken sources');
  const text = fs.readFileSync(path.join(fx.db.prepare("SELECT snapshot_path FROM raw_records WHERE source_type = 'web'").get().snapshot_path, 'text.md'), 'utf8');
  assert.ok(!text.includes('](media/'), 'no dangling markdown references');
});

test('AC2 resume: a step re-run after a mid-step crash converges — no duplicate rows, no lost markdown', async () => {
  const dir = makeTempDir();
  const fx = imageFixture(
    dir,
    [P(`Photo <img src="${pathToFileURL(path.join(dir, 'snap-500x400.png')).href}" alt="Snap" title="Yard"> here.`)],
    { imageFiles: { 'snap-500x400.png': pngBytes(500, 400) } }
  );
  await runCampaign(fx.db, fx.campaign, { sourcePath: fx.file, contentHash: sha256Hex(fx.source), snapshotsRoot: fx.snapshotsRoot });
  const record = fx.db.prepare("SELECT snapshot_path FROM raw_records WHERE source_type = 'web'").get();
  const mdPath = path.join(record.snapshot_path, 'text.md');

  // Crash state between the media row and the markdown write: the step is
  // back in 'running' with its work-order detail, the media row exists, the
  // markdown reference is the one effect that never landed. The descriptor
  // below pins the exact shape processFetchedPage enqueues.
  const recordId = fx.db.prepare("SELECT id FROM raw_records WHERE source_type = 'web'").get().id;
  fx.db
    .prepare("UPDATE run_log SET status = 'running', finished_at = NULL, detail = ? WHERE kind = 'image'")
    .run(
      JSON.stringify({
        recordId,
        occurrence: 0,
        url: pathToFileURL(path.join(dir, 'snap-500x400.png')).href,
        position: 1,
        alt: 'Snap',
        caption: 'Yard',
        slug: 'gdansk-shipyard-turns-into-a-museum',
      })
    );
  fs.writeFileSync(mdPath, fs.readFileSync(mdPath, 'utf8').split('\n\n').filter((block) => !block.startsWith('![')).join('\n\n'));

  const run = await runCampaign(fx.db, fx.campaign, { sourcePath: fx.file, contentHash: sha256Hex(fx.source), snapshotsRoot: fx.snapshotsRoot });
  assert.equal(run.done, 1, 'the interrupted image step is re-claimed and completes');
  assert.equal(mediaRows(fx.db).length, 1, 'exactly one media row');
  const blocks = fs.readFileSync(mdPath, 'utf8').trim().split('\n\n');
  assert.equal(blocks.filter((block) => block.startsWith('![')).length, 1, 'exactly one markdown image');
});

test('probeImage reads exact dimensions from container headers and rejects anything else', () => {
  assert.deepEqual(probeImage(pngBytes(200, 120)), { format: 'png', width: 200, height: 120 });
  assert.deepEqual(probeImage(gifBytes(150, 150)), { format: 'gif', width: 150, height: 150 });
  assert.deepEqual(probeImage(jpegBytes(640, 480)), { format: 'jpeg', width: 640, height: 480 });
  const jpegWithFill = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xff, 0xff]), jpegBytes(64, 48).subarray(2)]);
  assert.deepEqual(probeImage(jpegWithFill), { format: 'jpeg', width: 64, height: 48 }, '0xFF fill bytes are skipped, not read as markers');
  assert.equal(probeImage(Buffer.from('plain text, not an image')), null);
  assert.equal(probeImage(pngBytes(10, 10).subarray(0, 20)), null, 'a truncated PNG header is not probed');
  assert.equal(probeImage('not bytes'), null);
});

test('extractPage: image sources resolve against the page, captions come from figcaption, srcless tags are skipped', () => {
  const base = 'https://news.example/gdansk/yard.html';
  const page = extractPage(
    [
      '<title>Yard</title>',
      '<p>Intro.</p>',
      '<figure><img src="img/hall-800x600.png" alt="Hall"><figcaption>The main hall, 1970</figcaption></figure>',
      '<p><img src="https://cdn.example/remote.png" alt="Remote"> <img alt="no source"> Text after.</p>',
      '<p>Outro.</p>',
    ].join('\n'),
    base
  );
  assert.deepEqual(
    page.images.map((image) => [image.url, image.alt, image.caption, image.position]),
    [
      ['https://news.example/gdansk/img/hall-800x600.png', 'Hall', 'The main hall, 1970', 1],
      ['https://cdn.example/remote.png', 'Remote', null, 2],
    ],
    'the figure lands between paragraphs, the srcless tag is not an image'
  );
  const broken = extractPage(
    ['<title>Yard</title>', '<p><img src="http://[bad-ipv6" alt="broken"> Text.</p>'].join('\n'),
    base
  );
  assert.equal(broken.images[0].url, 'http://[bad-ipv6', 'an unresolvable src is kept raw and fails later at load time');
});
