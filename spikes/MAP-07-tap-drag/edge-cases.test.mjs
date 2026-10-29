import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTapDrag } from './tap-drag.mjs';

const options = {
  position: { x: 10, y: 10 }, size: { width: 40, height: 40 },
  bounds: { left: 0, top: 0, right: 200, bottom: 200 }, threshold: 8,
};

test('Final pointer sample, foreign events and returned snapshots cannot create accidental taps', () => {
  let taps = 0;
  const engine = createTapDrag({ ...options, onTap: () => taps++, onMove: () => {} });
  const p = (x, pointerId = 1) => ({ x, y: 10, pointerId });
  engine.down(p(10));
  engine.move(p(90, 2));
  engine.up(p(90, 2));
  engine.up(p(70));
  assert.equal(taps, 0);
  assert.deepEqual(engine.getPosition(), { x: 70, y: 10 });
  engine.getPosition().x = -999;
  assert.equal(engine.getPosition().x, 70);
  engine.down(p(70));
  engine.down(p(70));
  engine.up(p(70));
  assert.equal(taps, 1);
});

test('Invalid geometry is diagnosed; non-finite movement cannot corrupt the position', () => {
  for (const change of [{ threshold: 0 }, { position: { x: NaN, y: 0 } }, { size: { width: 300, height: 40 } }]) {
    assert.throws(() => createTapDrag({ ...options, ...change }), RangeError);
  }
  const engine = createTapDrag({ ...options, onTap: () => {}, onMove: () => {} });
  engine.down({ pointerId: 1, x: 10, y: 10 });
  engine.move({ pointerId: 1, x: NaN, y: 10 });
  assert.deepEqual(engine.getPosition(), options.position);
});
