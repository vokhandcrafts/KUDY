import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTapDrag } from './tap-drag.mjs';

function setup(disabled = false) {
  const taps = [];
  const moves = [];
  const engine = createTapDrag({
    position: { x: 40, y: 60 }, size: { width: 50, height: 70 },
    bounds: { left: 10, top: 20, right: 320, bottom: 400 },
    threshold: 8, disabled,
    onTap: () => taps.push('navigate'), onMove: (position) => moves.push(position),
  });
  const point = (x = 100, y = 100, pointerId = 1) => ({ x, y, pointerId });
  return { engine, taps, moves, point };
}

// #884 AC1: «кароткі tap выклікае дзеянне роўна адзін раз».
test('AC1: a short tap tolerates small jitter and navigates exactly once', () => {
  const { engine, taps, moves, point } = setup();
  engine.down(point());
  engine.move(point(103, 104));
  assert.equal(taps.length, 0);
  assert.equal(moves.length, 0);
  engine.up(point(103, 104));
  engine.up(point(103, 104));
  assert.deepEqual(taps, ['navigate']);
  assert.deepEqual(engine.getPosition(), { x: 40, y: 60 });
});

// #884 AC1: «drag пасля мінімальнага зруху перамяшчае элемент і не запускае навігацыю; long-press не абавязковы».
test('AC1: crossing the threshold moves immediately and never becomes a tap again', () => {
  const { engine, taps, moves, point } = setup();
  engine.down(point());
  engine.move(point(103, 104));
  assert.equal(moves.length, 0);
  engine.move(point(112, 110));
  assert.deepEqual(engine.getPosition(), { x: 52, y: 70 });
  assert.deepEqual(moves.at(-1), { x: 52, y: 70 });
  engine.move(point());
  engine.up(point());
  assert.deepEqual(taps, []);
});

// #884 AC2: «multi-touch/адмену жэста, страчаны pointer».
test('AC2: cancellation, lost capture and multi-touch suppress navigation and allow a fresh tap', async (t) => {
  for (const reason of ['cancel', 'lostPointer', 'multitouch']) {
    for (const dragging of [false, true]) {
      await t.test(`${reason}, dragging=${dragging}`, () => {
        const { engine, taps, moves, point } = setup();
        engine.down(point());
        if (dragging) engine.move(point(120, 100));
        if (reason === 'multitouch') engine.down(point(110, 100, 2));
        else engine[reason](1);
        const count = moves.length;
        engine.move(point(200, 200));
        engine.up(point());
        engine.up(point(110, 100, 2));
        assert.equal(moves.length, count);
        assert.deepEqual(taps, []);
        engine.down(point());
        engine.up(point());
        assert.deepEqual(taps, ['navigate']);
      });
    }
  }
});

// #884 AC2: «бяспечныя межы»; #881 contract 3: «усе пункты ў межах даступнай вобласці».
test('AC2: dragging keeps the whole fragment inside every safe boundary', () => {
  const { engine, moves, point } = setup();
  engine.down(point());
  for (const [x, y] of [[-1000, -1000], [1000, 1000], [-1000, 1000], [1000, -1000]]) {
    engine.move(point(x, y));
  }
  assert.equal(moves.length, 4);
  for (const { x, y } of moves) {
    assert.ok(x >= 10 && x + 50 <= 320);
    assert.ok(y >= 20 && y + 70 <= 400);
  }
  assert.notDeepEqual(moves[0], moves[1]);
  engine.up(point(1000, -1000));
});

// #884 AC3: «Падтрымліваць элемент са станам disabled як рухомы, але без навігацыі».
test('AC3: disabled fragments stay draggable while only enabled fragments navigate', () => {
  for (const disabled of [false, true]) {
    const { engine, taps, moves, point } = setup(disabled);
    engine.down(point());
    engine.up(point());
    assert.equal(taps.length, disabled ? 0 : 1);
    engine.down(point());
    engine.move(point(125, 115));
    engine.up(point(125, 115));
    assert.deepEqual(engine.getPosition(), { x: 65, y: 75 });
    assert.deepEqual(moves.at(-1), { x: 65, y: 75 });
    assert.equal(taps.length, disabled ? 0 : 1);
  }
});
