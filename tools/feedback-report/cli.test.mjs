// G16.04 — the CLI end-to-end over a temp scratch dir: CSV in, export
// saved, listed, removed. The store must refuse a path-shaped name, and the
// scratch location must stay git-ignored — a saved private report is never
// a committable artifact (implementation-rules 5).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { run } from './cli.mjs';

const FIXED_AT = '2026-10-04T19:00:00.000Z';

const CSV = [
  'target_kind,target_id,target_version,locale,rating_count,mean_score,hist_1,hist_2,hist_3,hist_4,hist_5,first_rated_at,last_rated_at,reason_counts',
  'guide,guide-route-a1,1,be,3,4.33,0,0,1,0,2,2026-09-01T10:00:00Z,2026-09-20T10:00:00Z,"{""clear_delivery"": 2}"',
].join('\n');

function capture(runner) {
  const originalOut = process.stdout.write.bind(process.stdout);
  const originalErr = process.stderr.write.bind(process.stderr);
  const out = [];
  const err = [];
  const previousExit = process.exitCode;
  process.exitCode = undefined;
  process.stdout.write = (chunk) => {
    out.push(String(chunk));
    return true;
  };
  process.stderr.write = (chunk) => {
    err.push(String(chunk));
    return true;
  };
  try {
    runner();
  } finally {
    process.stdout.write = originalOut;
    process.stderr.write = originalErr;
  }
  return { out: out.join(''), err: err.join(''), exitCode: process.exitCode, restoreExit: () => (process.exitCode = previousExit) };
}

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'feedback-report-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('guard: the export directory stays git-ignored', () => {
  const gitignore = fs.readFileSync(path.resolve(import.meta.dirname, '..', '..', '.gitignore'), 'utf8');
  assert.match(gitignore, /^\.scratch\/$/m, '.scratch/ must stay ignored — saved reports are never committed');
});

test('CSV in -> export saved -> listed -> removed', (t) => {
  const dir = tempDir(t);
  const csvFile = path.join(dir, 'raw.csv');
  fs.writeFileSync(csvFile, CSV, 'utf8');

  const saved = capture(() => run(['--from-csv', csvFile, '--out-dir', path.join(dir, 'exports'), '--computed-at', FIXED_AT]));
  saved.restoreExit();
  assert.equal(saved.exitCode, undefined);
  assert.match(saved.out, /^saved: feedback-report-2026-10-04T19-00-00\.000Z\.json\naggregates: 1\n$/);

  const listed = capture(() => run(['--list-saved', '--out-dir', path.join(dir, 'exports')]));
  listed.restoreExit();
  assert.match(listed.out, /feedback-report-2026-10-04T19-00-00\.000Z\.json\tcomputed 2026-10-04T19:00:00\.000Z\tperiod 2026-09-01T10:00:00\.000Z \.\. 2026-09-20T10:00:00\.000Z\t1 aggregates\n$/);

  const doc = JSON.parse(fs.readFileSync(path.join(dir, 'exports', 'feedback-report-2026-10-04T19-00-00.000Z.json'), 'utf8'));
  assert.equal(doc.kind, 'feedback-report');
  assert.equal(doc.aggregates[0].rating_count, 3);

  const removed = capture(() => run(['--remove-saved', '--all', '--out-dir', path.join(dir, 'exports')]));
  removed.restoreExit();
  assert.equal(removed.exitCode, undefined);
  assert.match(removed.out, /^removed: feedback-report-2026-10-04T19-00-00\.000Z\.json\n$/);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'exports')), []);
});

test('a broken CSV file exits 1 with named diagnostics on stderr', (t) => {
  const dir = tempDir(t);
  const csvFile = path.join(dir, 'broken.csv');
  fs.writeFileSync(csvFile, 'a,b\n1,2', 'utf8');
  const result = capture(() => run(['--from-csv', csvFile, '--out-dir', path.join(dir, 'exports')]));
  result.restoreExit();
  assert.equal(result.exitCode, 1);
  assert.match(result.err, /diagnostic: csv-header-mismatch/);
  assert.deepEqual(fs.readdirSync(dir).filter((name) => name.endsWith('.json')), []);
});

test('a path-shaped saved name is refused, never resolved', (t) => {
  const dir = tempDir(t);
  fs.mkdirSync(path.join(dir, 'exports'), { recursive: true });
  const result = capture(() => run(['--remove-saved', path.join('..', 'secrets.json'), '--out-dir', path.join(dir, 'exports')]));
  result.restoreExit();
  assert.equal(result.exitCode, 1);
  assert.match(result.err, /diagnostic: store-name-unsafe/);
});

test('an unknown flag exits 1 with a diagnostic', () => {
  const result = capture(() => run(['--destroy']));
  result.restoreExit();
  assert.equal(result.exitCode, 1);
  assert.match(result.err, /diagnostic: cli-unknown-argument/);
});

test('a value-taking flag without a value exits 1 with a diagnostic', () => {
  const result = capture(() => run(['--from-csv']));
  result.restoreExit();
  assert.equal(result.exitCode, 1);
  assert.match(result.err, /diagnostic: cli-missing-value/);
});

test('no command exits 1 with a hint', () => {
  const result = capture(() => run([]));
  result.restoreExit();
  assert.equal(result.exitCode, 1);
  assert.match(result.err, /diagnostic: cli-no-command/);
});
