import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ERROR_SERIES_LIMIT } from './crawler.mjs';
import {
  articleHtml,
  campaignYaml,
  collectAndClean,
  makeTempDir,
  rawRecord,
  seedCampaign,
  writeCampaignFile,
} from './testkit.mjs';
import { getRawRecord, openStore, upsertRawRecord } from './store.mjs';

const cliPath = fileURLToPath(new URL('./collector.mjs', import.meta.url));

// Host-capability probe (the tools/corpus/import.test.mjs pattern, G21.07):
// the read-only-directory rejection case asserts a deny that only exists on a
// host enforcing directory mode bits. Where chmod cannot restrict a directory
// (Windows; a root user) the case is skipped with the reason named — never
// silently — and stays mandatory on capable hosts.
let readonlyDirProblem = null;
{
  const probeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'collector-readonly-dir-probe-'));
  fs.chmodSync(probeRoot, 0o555);
  try {
    fs.writeFileSync(path.join(probeRoot, 'probe.txt'), 'probe');
    readonlyDirProblem =
      'directory mode bits are not enforced on this host — a write into the chmod 0o555 probe directory succeeded ' +
      '(Windows: chmod cannot make a directory read-only), so the read-only-directory rejection case has ' +
      'no deny to assert; it stays mandatory on capable platforms';
  } catch {
    // expected on a capable host: the probe write was denied
  } finally {
    fs.chmodSync(probeRoot, 0o755);
    fs.rmSync(probeRoot, { recursive: true, force: true });
  }
}

function runCli(args) {
  return spawnSync(process.execPath, [cliPath, ...args], { encoding: 'utf8' });
}

test('init creates the schema and reports the database path', () => {
  const dbPath = path.join(makeTempDir(), 'db.sqlite');
  const result = runCli(['init', '--db', dbPath]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /schema ready at /);
  assert.ok(fs.existsSync(dbPath));
});

test('status on an initialised empty database reports zeros and exits 0', () => {
  const dbPath = path.join(makeTempDir(), 'db.sqlite');
  assert.equal(runCli(['init', '--db', dbPath]).status, 0);
  const result = runCli(['status', '--db', dbPath]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /campaigns: 0/);
  assert.match(result.stdout, /raw_records: 0/);
  assert.match(result.stdout, /run_log: done 0, running 0, pending 0, failed 0/);
});

test('status on a missing database file answers with a diagnostic, exit 2', () => {
  const dir = makeTempDir();
  const result = runCli(['status', '--db', path.join(dir, 'absent.sqlite')]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /database file does not exist/);
});

test('an unusable --db path answers with a diagnostic, exit 2, for every command', () => {
  const dir = makeTempDir();
  const file = writeCampaignFile(dir, campaignYaml());
  for (const args of [['init'], ['status'], ['run', '--campaign', file]]) {
    const result = runCli([...args, '--db', dir]);
    assert.equal(result.status, 2, `${args[0]}: ${result.stderr}`);
    assert.match(result.stderr, /cannot open database/, `${args[0]}: ${result.stderr}`);
  }
});

test('run rejects a campaign missing city with a diagnostic naming the field', () => {
  const dir = makeTempDir();
  const file = writeCampaignFile(dir, campaignYaml({ city: null }), 'bad.yaml');
  const result = runCli(['run', '--campaign', file, '--db', path.join(dir, 'db.sqlite')]);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /collector: campaign\.city:/);
});

test('run reports a missing campaign file as a file error, not a crash', () => {
  const dir = makeTempDir();
  const result = runCli(['run', '--campaign', path.join(dir, 'nope.yaml'), '--db', path.join(dir, 'db.sqlite')]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /cannot read campaign file/);
});

test('run is idempotent end-to-end: two invocations, no duplicate records', () => {
  const dir = makeTempDir();
  const dbPath = path.join(dir, 'db.sqlite');
  // A file:// seed: G17.02 made https seeds live network crawls, and this test
  // pins the offline CLI path (the crawler suites cover the network side).
  const fixturePath = path.join(dir, 'seed-page.html');
  fs.writeFileSync(fixturePath, articleHtml(), 'utf8');
  const file = writeCampaignFile(
    dir,
    campaignYaml({
      youtube: 'youtube: []',
      seeds: `seeds:\n  - ${pathToFileURL(fixturePath).href}`,
    })
  );

  const first = runCli(['run', '--campaign', file, '--db', dbPath]);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /steps done 1, failed 0, running 0, pending 0/);
  assert.match(first.stdout, /raw_records total 1/);

  const second = runCli(['run', '--campaign', file, '--db', dbPath]);
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /steps done 0, failed 0, running 0, pending 0/);
  assert.match(second.stdout, /raw_records total 1/);

  const status = runCli(['status', '--db', dbPath]);
  assert.match(status.stdout, /campaigns: 1/);
  assert.match(status.stdout, /raw_records: 1/);
  assert.match(status.stdout, /run_log: done 1, running 0, pending 0, failed 0/);
});

test('run with a file:// seed writes the snapshot; status counts it', () => {
  const dir = makeTempDir();
  const fixturePath = path.join(dir, 'article.html');
  fs.writeFileSync(fixturePath, articleHtml(), 'utf8');
  const file = writeCampaignFile(
    dir,
    campaignYaml({ youtube: null, seeds: `seeds:\n  - ${pathToFileURL(fixturePath).href}` })
  );
  const dbPath = path.join(dir, 'db.sqlite');

  const result = runCli(['run', '--campaign', file, '--db', dbPath]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /steps done 1, failed 0, running 0, pending 0/);
  assert.match(result.stdout, /raw_records total 1/);
  assert.match(result.stdout, new RegExp(`snapshots root ${path.join(dir, 'snapshots').replace(/\\/g, '\\\\')}`));

  const campaignDirs = fs.readdirSync(path.join(dir, 'snapshots'));
  assert.equal(campaignDirs.length, 1, 'one campaign subdir under the snapshots root');
  const articleDirs = fs.readdirSync(path.join(dir, 'snapshots', campaignDirs[0]));
  assert.equal(articleDirs.length, 1);
  const files = fs.readdirSync(path.join(dir, 'snapshots', campaignDirs[0], articleDirs[0])).sort();
  assert.deepEqual(files, ['media', 'metadata.json', 'snapshot.html', 'text.md']);

  const status = runCli(['status', '--db', dbPath]);
  assert.equal(status.status, 0, status.stderr);
  assert.match(status.stdout, /snapshots: 1/);
});

test('a rejected run converts to the exit-2 diagnostic path (the main().catch guard)', { skip: readonlyDirProblem ?? undefined }, () => {
  // A read-only db *directory* passes openStore (the file opens) but fails the
  // first INSERT mid-run — runCampaign rejects, and the CLI guard must turn
  // the rejection into `collector: <reason>` with exit 2. Reverting the guard
  // ends the process on an unhandled rejection (exit 1, no prefix) instead.
  const dir = makeTempDir();
  const dbPath = path.join(dir, 'db.sqlite');
  assert.equal(runCli(['init', '--db', dbPath]).status, 0);
  const file = writeCampaignFile(dir, campaignYaml({ youtube: null }));
  const dbDir = path.dirname(dbPath);
  fs.chmodSync(dbDir, 0o555);
  try {
    const result = runCli(['run', '--campaign', file, '--db', dbPath]);
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /collector: /);
    assert.doesNotMatch(result.stderr, /cannot open database/, 'open succeeded — the failure is the mid-run rejection');
  } finally {
    fs.chmodSync(dbDir, 0o755);
  }
});

test('run on an error series prints the stopped diagnostic on stderr and still exits 0', () => {
  // The net guard (G17.16) refuses loopback seeds before any request — here
  // the series is driven by those refusals through the unmodified production
  // path. Three consecutive failures stop the run inside runCampaign while the
  // fourth seed stays queued (pending, not drained).
  const dir = makeTempDir();
  const seeds = ['http://127.0.0.1/a', 'http://127.0.0.1/b', 'http://127.0.0.1/c', 'http://127.0.0.1/d'];
  const file = writeCampaignFile(
    dir,
    campaignYaml({
      seeds: `seeds:\n${seeds.map((url) => `  - ${url}`).join('\n')}`,
      delay_s: 'delay_s: [0.05, 0.1]',
    })
  );
  const result = runCli(['run', '--campaign', file, '--db', path.join(dir, 'db.sqlite')]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stderr,
    new RegExp(
      `collector: run stopped — error series: ${ERROR_SERIES_LIMIT} consecutive crawl failures, ` +
        `last at http://127\\.0\\.0\\.1/c \\(net guard: 127\\.0\\.0\\.1 is a loopback address — request not made\\)`
    )
  );
  assert.match(result.stdout, /steps done 0, failed 3, running 0, pending 1/);
});

test('unknown command and missing --campaign answer with usage, exit 2', () => {
  const unknown = runCli(['crawl']);
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /usage:/);

  const noCampaign = runCli(['run', '--db', path.join(makeTempDir(), 'db.sqlite')]);
  assert.equal(noCampaign.status, 2);
  assert.match(noCampaign.stderr, /run requires --campaign/);
});

test('search, basket and export-draft drive the draft handoff through the real CLI (criteria 1-3)', () => {
  const dir = makeTempDir();
  const { dbPath } = collectAndClean(dir);
  const db = openStore(dbPath);
  const record = db.prepare('SELECT id, url, collected_at FROM raw_records').get();
  db.close();

  const hit = runCli(['search', '--query', 'shipyard history', '--db', dbPath]);
  assert.equal(hit.status, 0, hit.stderr);
  assert.match(hit.stdout, new RegExp(`${record.id}  gdansk  web  cleaned  Gdansk shipyard turns into a museum — ${record.url}`));
  assert.match(hit.stdout, /collector: 1 record\(s\)/);

  // Filter correctness through the CLI: wrong type and wrong city find nothing.
  const noType = runCli(['search', '--city', 'gdansk', '--type', 'news', '--db', dbPath]);
  assert.equal(noType.status, 0, noType.stderr);
  assert.match(noType.stdout, /collector: 0 record\(s\)/);
  const noCity = runCli(['search', '--city', 'krakow', '--query', 'shipyard', '--db', dbPath]);
  assert.match(noCity.stdout, /collector: 0 record\(s\)/);

  const add = runCli(['basket', 'add', '--record', record.id, '--db', dbPath]);
  assert.equal(add.status, 0, add.stderr);
  assert.match(add.stdout, /collector: basket — added 1, already in basket 0/);
  const again = runCli(['basket', 'add', '--record', record.id, '--db', dbPath]);
  assert.match(again.stdout, /collector: basket — added 0, already in basket 1/);

  const outPath = path.join(dir, 'draft.md');
  const draft = runCli(['export-draft', '--out', outPath, '--db', dbPath]);
  assert.equal(draft.status, 0, draft.stderr);
  assert.match(draft.stdout, new RegExp(`draft at ${outPath.replace(/([.*+?^${}()|[\]\\])/g, '\\$1')} — 1 fragment\\(s\\), 1 moved to used`));
  const body = fs.readFileSync(outPath, 'utf8');
  assert.match(body, new RegExp(`Крыніца: ${record.url}\\nЗабрана: ${record.collected_at} · Запіс: ${record.id}`));
  assert.match(body, /## Gdansk shipyard turns into a museum/);
  assert.equal(getRawRecord(openStore(dbPath), record.id).status, 'used');

  const repeat = runCli(['export-draft', '--out', outPath, '--db', dbPath]);
  assert.match(repeat.stdout, /— 1 fragment\(s\), 0 moved to used/);
  assert.equal(fs.readFileSync(outPath, 'utf8').split(`Запіс: ${record.id}`).length - 1, 1, 'a repeat export keeps one fragment');
});

test('basket and draft answer with boundary diagnostics (criterion 4)', () => {
  const dir = makeTempDir();
  const dbPath = path.join(dir, 'db.sqlite');
  const empty = runCli(['init', '--db', dbPath]);
  assert.equal(empty.status, 0, empty.stderr);

  const outPath = path.join(dir, 'draft.md');
  const noBasket = runCli(['export-draft', '--out', outPath, '--db', dbPath]);
  assert.equal(noBasket.status, 1);
  assert.match(noBasket.stderr, /basket is empty — add fragments with `basket add` first/);
  assert.equal(fs.existsSync(outPath), false, 'no empty draft file');

  const db = openStore(dbPath);
  seedCampaign(db);
  const record = rawRecord({ campaignId: 'c1' });
  upsertRawRecord(db, record);
  db.close();
  const uncleaned = runCli(['basket', 'add', '--record', record.id, '--db', dbPath]);
  assert.equal(uncleaned.status, 1);
  assert.match(uncleaned.stderr, /has no cleaned document — run clean first/);
  const unknown = runCli(['basket', 'add', '--record', 'nope', '--db', dbPath]);
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /no such record: nope/);

  const list = runCli(['basket', 'list', '--db', dbPath]);
  assert.equal(list.status, 0, list.stderr);
  assert.match(list.stdout, /collector: basket holds 0 record\(s\)/);

  const missing = runCli(['search', '--city', 'gdansk', '--db', path.join(dir, 'absent.sqlite')]);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /database file does not exist/);
});
