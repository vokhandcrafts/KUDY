// G19.01/G19.02/G19.03 — CLI behavioral checks (issues #458/#459/#460).
// validation_exit_codes and import_backup_restore walk the real CLI
// (spawnSync, the production entry point) over committed synthetic fixtures
// and temp trees; corpus_suite_is_wired guards the runner wiring itself
// (implementation-rules 1 and 7: removing the corpus glob from npm test must
// turn this suite red).

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { EXTRACTOR, makeSyntheticLibrary } from './fixtures/packages.mjs';

const cliPath = fileURLToPath(new URL('./cli.mjs', import.meta.url));
const fixtureManifest = fileURLToPath(new URL('./fixtures/manifests/valid-input-v1.json', import.meta.url));
const fixtureRunConfig = fileURLToPath(new URL('./fixtures/run-config/valid-dry-run-v1.json', import.meta.url));

function runCli(args) {
  return spawnSync(process.execPath, [cliPath, ...args], { encoding: 'utf8' });
}

function writeTempJson(value) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-cli-'));
  const file = path.join(dir, 'doc.json');
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2), 'utf8');
  return file;
}

function validManifest() {
  return JSON.parse(fs.readFileSync(fixtureManifest, 'utf8'));
}

function validRunConfig() {
  return JSON.parse(fs.readFileSync(fixtureRunConfig, 'utf8'));
}

test('validation_exit_codes: the committed synthetic manifest validates with exit 0', () => {
  const result = runCli(['validate-input', '--manifest', fixtureManifest]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /corpus: manifest ok — 4 record\(s\), 2 media file\(s\)/);
});

test('validation_exit_codes: null, wrong types, unknown rights, duplicates and limit violations exit 1', () => {
  const cases = [
    {
      name: 'null manifest',
      doc: 'null',
      rule: /type at \$/,
    },
    {
      name: 'wrong records type',
      doc: { ...validManifest(), records: 'nope' },
      rule: /type at \$\.records/,
    },
    {
      name: 'unknown rights',
      doc: (() => {
        const manifest = validManifest();
        manifest.records[0].rights = 'gfdl-1.2';
        return manifest;
      })(),
      rule: /enum at \$\.records\[0\]\.rights/,
    },
    {
      name: 'duplicate source key',
      doc: (() => {
        const manifest = validManifest();
        manifest.records[1].source_record_key = 'example-0001';
        return manifest;
      })(),
      rule: /duplicate-source-key at \$\.records\[1\]\.source_record_key/,
    },
    {
      name: 'record limit violation',
      doc: {
        source_namespace: 'fixture-wiki',
        records: Array.from({ length: 10001 }, (_, i) => ({
          source_record_key: `example-${i}`,
          html_path: `pages/example-${i}.html`,
          language: 'be',
          rights: 'research_only',
        })),
      },
      rule: /maxItems at \$\.records/,
    },
    {
      name: 'media limit violation',
      doc: (() => {
        const manifest = validManifest();
        manifest.records[0].media = Array.from({ length: 201 }, (_, i) => ({
          media_key: `example-0001-${i}`,
          local_path: `images/example-0001-${i}.png`,
          rights: 'research_only',
        }));
        return manifest;
      })(),
      rule: /maxItems at \$\.records\[0\]\.media/,
    },
  ];

  for (const { name, doc, rule } of cases) {
    const result = runCli(['validate-input', '--manifest', writeTempJson(doc)]);
    assert.equal(result.status, 1, `${name}: ${result.stderr}`);
    assert.match(result.stderr, /corpus: manifest invalid \(\d+ diagnostic/, `${name}: ${result.stderr}`);
    assert.match(result.stderr, rule, `${name}: ${result.stderr}`);
  }
});

test('validation_exit_codes: file errors and usage answer with exit 2', () => {
  const missing = runCli(['validate-input', '--manifest', path.join(os.tmpdir(), 'corpus-absent-manifest.json')]);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /corpus: cannot read manifest file/);

  const broken = runCli(['validate-input', '--manifest', writeTempJson('{not json')]);
  assert.equal(broken.status, 2);
  assert.match(broken.stderr, /corpus: manifest file is not valid JSON/);

  const noFlag = runCli(['validate-input']);
  assert.equal(noFlag.status, 2);
  assert.match(noFlag.stderr, /validate-input requires --manifest/);

  const unknown = runCli(['validate-everything']);
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /usage: node tools\/corpus\/cli\.mjs/);
});

test('validation_exit_codes: validate-run accepts the dry-run fixture and rejects broken configs', () => {
  const ok = runCli(['validate-run', '--config', fixtureRunConfig]);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /corpus: run config ok — level 1, dry-run/);

  const live = validRunConfig();
  live.mode = 'live';
  const noConsent = runCli(['validate-run', '--config', writeTempJson(live)]);
  assert.equal(noConsent.status, 1, noConsent.stderr);
  assert.match(noConsent.stderr, /required at \$\.data_transfer_consent/);

  const attempts = validRunConfig();
  attempts.max_attempts = 4;
  const tooMany = runCli(['validate-run', '--config', writeTempJson(attempts)]);
  assert.equal(tooMany.status, 1, tooMany.stderr);
  assert.match(tooMany.stderr, /maximum at \$\.max_attempts/);

  const vocabulary = validRunConfig();
  vocabulary.vocabulary_version = 'nowhere-v9';
  const unknownVocabulary = runCli(['validate-run', '--config', writeTempJson(vocabulary)]);
  assert.equal(unknownVocabulary.status, 1, unknownVocabulary.stderr);
  assert.match(unknownVocabulary.stderr, /unknown-vocabulary-version at \$\.vocabulary_version/);

  const missing = runCli(['validate-run', '--config', path.join(os.tmpdir(), 'corpus-absent-config.json')]);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /corpus: cannot read run config file/);
});

test('validate-input answers without probing referenced files (existence is unpack G19.02)', () => {
  // The committed fixture names pages/… and images/… relative to an input
  // root that is never passed here; those paths do not exist anywhere under
  // the checkout, and validation still succeeds — no filesystem call happens.
  for (const relative of ['pages/example-0001-navigation.html', 'images/example-0003-01.png']) {
    assert.equal(fs.existsSync(path.join(path.dirname(fixtureManifest), relative)), false, relative);
  }
  const result = runCli(['validate-input', '--manifest', fixtureManifest]);
  assert.equal(result.status, 0, result.stderr);
});

test('corpus_suite_is_wired: the corpus suite runs inside npm test (implementation-rules 7)', () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.match(
    pkg.scripts.test,
    /"tools\/corpus\/\*\.test\.mjs"/,
    'npm test must enumerate the tools/corpus glob — reverting it would silently drop every corpus suite from the default run'
  );
});

// G19.03 — the database commands walk the real CLI: import registers what
// unpack-style files hold, backup writes the verified snapshot, restore
// materializes a fresh library that the store reopens (issue #460).
test('import_backup_restore: the library registers idempotently and round-trips through a backup', (t) => {
  const library = makeSyntheticLibrary(t, { seed: 'cli-roundtrip' });

  const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-cli-db-'));
  t.after(() => fs.rmSync(dbDir, { recursive: true, force: true }));
  const dbPath = path.join(dbDir, 'corpus.db');
  const backupDir = path.join(dbDir, 'backup');
  const restoredRoot = path.join(dbDir, 'restored');

  const first = runCli(['import', '--db', dbPath, '--library-root', library.root]);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /package\[0\] registered — article [0-9a-f]{12} revision [0-9a-f]{12}/);
  assert.match(first.stdout, /import finished — 1 ok, 0 failed/);

  const second = runCli(['import', '--db', dbPath, '--library-root', library.root]);
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /package\[0\] already-registered/, 're-import must not duplicate the package');

  const backup = runCli(['backup', '--db', dbPath, '--library-root', library.root, '--out', backupDir]);
  assert.equal(backup.status, 0, backup.stderr);
  assert.match(backup.stdout, /backup written — [0-9]+ file\(s\)/);
  assert.ok(fs.existsSync(path.join(backupDir, 'manifest.json')));

  const restore = runCli(['restore', '--backup', backupDir, '--library-root', restoredRoot]);
  assert.equal(restore.status, 0, restore.stderr);
  assert.match(restore.stdout, /restored into .* — database corpus\.db/);
  assert.ok(fs.existsSync(path.join(restoredRoot, 'articles')));

  // The restored library registers as already-present against its own DB.
  const reopen = runCli(['import', '--db', path.join(restoredRoot, 'corpus.db'), '--library-root', restoredRoot]);
  assert.equal(reopen.status, 0, reopen.stderr);
  assert.match(reopen.stdout, /package\[0\] already-registered/);

  // A corrupt backup never materializes a library: the CLI answers exit 1
  // with the named rule, not a crash.
  const corruptDir = path.join(dbDir, 'corrupt');
  fs.cpSync(backupDir, corruptDir, { recursive: true });
  const documentFile = path.join(corruptDir, `articles/${library.articleId}/revisions/${library.revisionId}/extractions/${EXTRACTOR}/article.json`);
  fs.writeFileSync(documentFile, fs.readFileSync(documentFile).toString().replace('"title"', '"title '));
  const failed = runCli(['restore', '--backup', corruptDir, '--library-root', path.join(dbDir, 'never')]);
  assert.equal(failed.status, 1, failed.stderr);
  assert.match(failed.stderr, /corpus: restore: backup-checksum-mismatch/);
  assert.equal(fs.existsSync(path.join(dbDir, 'never')), false);
});
