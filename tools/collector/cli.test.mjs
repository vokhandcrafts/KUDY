import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { campaignYaml, makeTempDir, writeCampaignFile } from './testkit.mjs';

const cliPath = fileURLToPath(new URL('./collector.mjs', import.meta.url));

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
  const file = writeCampaignFile(
    dir,
    campaignYaml({ youtube: 'youtube:\n  - dQw4w9WgXcQ\n  - aQw4w9WgXcQ' })
  );

  const first = runCli(['run', '--campaign', file, '--db', dbPath]);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /steps done 3, failed 0, running 0, pending 0/);
  assert.match(first.stdout, /raw_records total 2/);

  const second = runCli(['run', '--campaign', file, '--db', dbPath]);
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /steps done 0, failed 0, running 0, pending 0/);
  assert.match(second.stdout, /raw_records total 2/);

  const status = runCli(['status', '--db', dbPath]);
  assert.match(status.stdout, /campaigns: 1/);
  assert.match(status.stdout, /raw_records: 2/);
  assert.match(status.stdout, /run_log: done 3, running 0, pending 0, failed 0/);
});

test('unknown command and missing --campaign answer with usage, exit 2', () => {
  const unknown = runCli(['crawl']);
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /usage:/);

  const noCampaign = runCli(['run', '--db', path.join(makeTempDir(), 'db.sqlite')]);
  assert.equal(noCampaign.status, 2);
  assert.match(noCampaign.stderr, /run requires --campaign/);
});
