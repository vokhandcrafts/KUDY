// DQ-03 (issue #913) — the fast npm-test check (criterion 4, spec §8.1):
// every guide-card story of the V1 matrix must have a baseline under
// docs/design-qa/baselines/. The story list comes from the real single
// source (parseStoryNames reads components/guide-card.stories.tsx and is
// fail-closed), so a new story turns this red until its baseline lands;
// removing the baselines directory turns the whole suite red. The Explore
// screen surfaces are captured and compared by visual:check as well, but
// the enforced V1 baseline matrix of this check is the stories matrix —
// approving the baselines themselves is DQ-04.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { DEFAULT_BASELINES_DIR, allSlots, loadMatrix } from './visual-check.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('every guide-card story of the V1 matrix has a baseline (DQ-03 criterion 4)', () => {
  const matrix = loadMatrix();
  const storySlots = allSlots(matrix).filter((slot) => slot.story);
  assert.ok(storySlots.length > 0, 'the matrix must contain story slots — parseStoryNames is fail-closed');
  const missing = storySlots.filter((slot) => !fs.existsSync(path.join(DEFAULT_BASELINES_DIR, `${slot.slot}.png`)));
  assert.deepEqual(
    missing.map((slot) => slot.slot),
    [],
    `missing baselines for: ${missing.map((slot) => slot.slot).join(', ')}`,
  );
});
