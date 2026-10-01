// G07.05 — the canonical values loader: the numbers the app reads are the
// accepted document's, validated through the contract's own checker; a
// damaged file fails with a named rule, never a silent default.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { ConfigError, loadGuideHintValues } from './config.ts';
import { fileURLToPath } from 'node:url';

test('loadGuideHintValues reads the canonical file: the accepted ADR numbers, no restatement', () => {
  const values = loadGuideHintValues();
  assert.deepEqual(values, {
    guide_hints_values_version: 1,
    proximity_radius_m: 300,
    accepted_accuracy_m: 100,
    fix_freshness_s: 30,
    dwell_s: 20,
    foreground_cooldown_s: 3600,
  });
});

test('a contract-invalid file answers with the named rule, not a default', () => {
  const broken = path.join(os.tmpdir(), `hint-values-broken-${String(process.pid)}.json`);
  // The contract's own negative fixture: one isolated violation.
  fs.copyFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'contracts', 'fixtures', 'guide-hints', 'invalid-negative-value.json'),
    broken,
  );
  try {
    assert.throws(
      () => loadGuideHintValues(broken),
      (error: unknown) => error instanceof ConfigError && error.rule === 'hint-values-invalid',
    );
  } finally {
    fs.unlinkSync(broken);
  }
});

test('an unreadable file answers with the unreadable rule', () => {
  assert.throws(
    () => loadGuideHintValues(path.join(os.tmpdir(), `hint-values-missing-${String(process.pid)}.json`)),
    (error: unknown) => error instanceof ConfigError && error.rule === 'hint-values-unreadable',
  );
});
