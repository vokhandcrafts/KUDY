import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runCampaign } from './runloop.mjs';
import { countRows, enqueueStep, ensureCampaign, openStore, sha256Hex, stepStatusCounts } from './store.mjs';
import { parseCampaign } from './campaign.mjs';
import { articleHtml, campaignYaml, makeTempDir, writeCampaignFile } from './testkit.mjs';

// The seed is a file:// fixture page: G17.02 made https seeds live crawls, so
// these loop-mechanics tests pin the offline snapshot path instead.
function setup(overrides = {}) {
  const dir = makeTempDir();
  const page = path.join(dir, 'seed-page.html');
  fs.writeFileSync(page, articleHtml(), 'utf8');
  const file = writeCampaignFile(
    dir,
    campaignYaml({ seeds: `seeds:\n  - ${pathToFileURL(page).href}`, ...overrides })
  );
  const source = fs.readFileSync(file, 'utf8');
  const parsed = parseCampaign(source);
  assert.ok(parsed.ok, parsed.diagnostics?.join('\n'));
  const db = openStore(path.join(dir, 'db.sqlite'));
  return { db, file, source, campaign: parsed.campaign };
}

test('AC2: first run registers campaign and records; second run inserts nothing new', async () => {
  const { db, file, source, campaign } = setup();
  const first = await runCampaign(db, campaign, { sourcePath: file, contentHash: sha256Hex(source) });
  assert.equal(first.done, 2, 'one seed + one youtube step');
  assert.equal(countRows(db, 'campaigns'), 1);
  assert.equal(countRows(db, 'raw_records'), 2);
  assert.equal(countRows(db, 'run_log'), 2);

  const recordIds = db.prepare('SELECT id FROM raw_records ORDER BY id').all().map((row) => row.id);
  await runCampaign(db, campaign, { sourcePath: file, contentHash: sha256Hex(source) });
  assert.equal(countRows(db, 'campaigns'), 1, 'campaign row not duplicated');
  assert.equal(countRows(db, 'raw_records'), 2, 'raw_records not duplicated');
  assert.equal(countRows(db, 'run_log'), 2, 'steps not duplicated');
  assert.deepEqual(
    db.prepare('SELECT id FROM raw_records ORDER BY id').all().map((row) => row.id),
    recordIds
  );
});

test('AC3: a step left running by an interrupted run is resumed, not duplicated', async () => {
  const { db, file, source, campaign } = setup();
  await runCampaign(db, campaign, { sourcePath: file, contentHash: sha256Hex(source) });

  // Simulate a process killed between claim and completion: the row stays
  // 'running' on disk, exactly as the first run would have left it.
  db.prepare("UPDATE run_log SET status = 'running', finished_at = NULL WHERE kind = 'youtube'").run();

  const second = await runCampaign(db, campaign, { sourcePath: file, contentHash: sha256Hex(source) });
  assert.equal(second.done, 1, 'only the interrupted step is re-claimed');
  assert.equal(countRows(db, 'raw_records'), 2);
  const youtube = db.prepare("SELECT status, attempts FROM run_log WHERE kind = 'youtube'").get();
  assert.equal(youtube.status, 'done');
  assert.equal(youtube.attempts, 2, 'resumed step counts its second attempt');
  const seed = db.prepare("SELECT attempts FROM run_log WHERE kind = 'seed'").get();
  assert.equal(seed.attempts, 1, 'completed steps are not re-executed (resume, not restart)');
});

test('AC3: a run interrupted after enqueue resumes on the next invocation', async () => {
  const { db, file, source, campaign } = setup();
  // State of a run killed right after enqueue: campaign registered, steps
  // pending, no processing yet.
  const { campaignId } = ensureCampaign(db, { campaign, sourcePath: file, contentHash: sha256Hex(source) });
  enqueueStep(db, campaignId, 'youtube', campaign.youtube[0], new Date().toISOString());
  enqueueStep(db, campaignId, 'seed', campaign.seeds[0], new Date().toISOString());
  assert.deepEqual(stepStatusCounts(db, campaignId), { pending: 2 });

  const run = await runCampaign(db, campaign, { sourcePath: file, contentHash: sha256Hex(source) });
  assert.equal(run.done, 2);
  assert.deepEqual(stepStatusCounts(db, campaignId), { done: 2 });
  assert.equal(countRows(db, 'raw_records'), 2);
  assert.equal(countRows(db, 'run_log'), 2, 'no duplicate step rows after resume');
});

test('a handler failure marks the step failed with the error and is not re-run', async () => {
  const { db, file, source, campaign } = setup();
  let calls = 0;
  const throwing = {
    seed() {},
    youtube() {
      calls += 1;
      throw new Error('boom');
    },
  };
  const first = await runCampaign(db, campaign, { sourcePath: file, contentHash: sha256Hex(source), handlers: throwing });
  assert.equal(first.done, 1);
  assert.equal(first.failed, 1);
  assert.equal(calls, 1);
  const youtube = db.prepare("SELECT status, error, attempts FROM run_log WHERE kind = 'youtube'").get();
  assert.equal(youtube.status, 'failed');
  assert.equal(youtube.error, 'boom');

  await runCampaign(db, campaign, { sourcePath: file, contentHash: sha256Hex(source), handlers: throwing });
  assert.equal(calls, 1, 'failed steps are not re-claimed on the next run');
  assert.equal(countRows(db, 'raw_records'), 0);
});

test('a step kind without a handler fails with a diagnostic, not a crash', async () => {
  const { db, file, source, campaign } = setup();
  const run = await runCampaign(db, campaign, { sourcePath: file, contentHash: sha256Hex(source), handlers: {} });
  assert.equal(run.failed, 2);
  const errors = db.prepare("SELECT error FROM run_log WHERE status = 'failed'").all().map((row) => row.error);
  assert.deepEqual(errors.sort(), ["no handler for step kind 'seed'", "no handler for step kind 'youtube'"]);
});
