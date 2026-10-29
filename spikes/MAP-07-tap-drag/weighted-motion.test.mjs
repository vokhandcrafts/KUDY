import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTapDrag } from './tap-drag.mjs';
import { createWeightedMotion } from './weighted-motion.mjs';

// Owner, 2026-10-29: «больш павольна ... адчуванне ... важкаватае, з латуні ці дарагое».
// Coefficients and easing remain unpinned; simulation uses elapsed time, never real timers.
test('owner motion request: the visual follows progressively while the gesture stays immediate, then settles after release', () => {
  const position = { x: 40, y: 60 };
  const motion = createWeightedMotion({ position, reducedMotion: false });
  let taps = 0;
  const gesture = createTapDrag({
    position, size: { width: 50, height: 70 },
    bounds: { left: 10, top: 20, right: 320, bottom: 400 },
    threshold: 8, disabled: false,
    onTap: () => { taps += 1; }, onMove: (target) => motion.setTarget(target),
  });
  gesture.down({ pointerId: 1, x: 100, y: 100 });
  gesture.move({ pointerId: 1, x: 200, y: 180 });
  const target = { x: 140, y: 140 };
  assert.deepEqual(gesture.getPosition(), target);
  assert.deepEqual(motion.getPosition(), position);
  const first = motion.advance(16);
  const second = motion.advance(16);
  for (const axis of ['x', 'y']) {
    assert.ok(first[axis] > position[axis] && first[axis] < target[axis]);
    assert.ok(second[axis] > first[axis] && second[axis] < target[axis]);
  }
  assert.equal(motion.isSettled(), false);
  gesture.up({ pointerId: 1, x: 200, y: 180 });
  // No more pointer events: settling must continue after release.
  for (let frame = 0; frame < 180; frame += 1) motion.advance(16);
  assert.deepEqual(motion.getPosition(), target);
  assert.equal(motion.isSettled(), true);
  assert.equal(taps, 0);
});

test('owner motion request: a moving target does not teleport the visible fragment', () => {
  const motion = createWeightedMotion({ position: { x: 0, y: 0 }, reducedMotion: false });
  motion.setTarget({ x: 100, y: 80 });
  const visible = motion.advance(32);
  motion.setTarget({ x: 140, y: 120 });
  assert.deepEqual(motion.getPosition(), visible);
  assert.deepEqual(motion.advance(0), visible);
  const next = motion.advance(16);
  assert.ok(next.x > visible.x && next.x < 140);
  assert.ok(next.y > visible.y && next.y < 120);
});

test('AC2 safe bounds also hold while the visual settles at opposite edges', () => {
  const motion = createWeightedMotion({ position: { x: 10, y: 20 }, reducedMotion: false });
  for (const target of [{ x: 270, y: 330 }, { x: 10, y: 20 }]) {
    motion.setTarget(target);
    for (let frame = 0; frame < 180; frame += 1) {
      const { x, y } = motion.advance(16);
      assert.ok(x >= 10 && x <= 270);
      assert.ok(y >= 20 && y <= 330);
    }
    assert.deepEqual(motion.getPosition(), target);
  }
});

// docs/design/visual-language.md §9: «reduced-motion без пераходаў і аўтапанавання».
test('reduced-motion canon: target changes land instantly without transition frames', () => {
  const motion = createWeightedMotion({ position: { x: 40, y: 60 }, reducedMotion: true });
  for (const target of [{ x: 140, y: 140 }, { x: 20, y: 30 }]) {
    motion.setTarget(target);
    assert.deepEqual(motion.getPosition(), target);
    assert.deepEqual(motion.advance(16), target);
    assert.equal(motion.isSettled(), true);
  }
});
