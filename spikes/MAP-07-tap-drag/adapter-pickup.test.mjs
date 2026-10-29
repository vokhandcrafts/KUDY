import assert from 'node:assert/strict';
import { test } from 'node:test';

class Target {
  constructor() { this.events = new Map(); }
  addEventListener(type, fn) {
    if (!this.events.has(type)) this.events.set(type, []);
    this.events.get(type).push(fn);
  }
  fire(type, event = {}) {
    for (const fn of this.events.get(type) ?? []) fn(event);
  }
}

test('real demo adapter: quick tap, stationary pickup, immediate drag, cancellation and keyboard', async () => {
  const original = Object.fromEntries(
    ['window', 'document', 'matchMedia', 'ResizeObserver', 'requestAnimationFrame', 'cancelAnimationFrame']
      .map((name) => [name, globalThis[name]]),
  );
  const window = new Target();
  const document = new Target();
  const media = new Target();
  media.matches = false;
  document.hidden = false;
  const board = new Target();
  board.clientWidth = 420;
  board.clientHeight = 370;
  const status = { textContent: 'Дзеянняў: 0' };
  const piece = new Target();
  piece.dataset = {};
  piece.style = {};
  piece.offsetWidth = 104;
  piece.offsetHeight = 76;
  piece.getAttribute = () => null;
  piece.capture = null;
  piece.setPointerCapture = (id) => { piece.capture = id; };
  piece.hasPointerCapture = (id) => piece.capture === id;
  piece.releasePointerCapture = (id) => { if (id === piece.capture) piece.capture = null; };
  board.querySelectorAll = () => [piece];
  document.querySelector = (selector) => ({ '#board': board, '#status': status })[selector];
  let nextFrame = 0;
  const frames = new Map();
  let time = 0;
  const runFrame = () => {
    const next = [...frames];
    frames.clear();
    time += 16;
    for (const [, callback] of next) callback(time);
  };
  const pointer = (pointerId, x, y) => ({ pointerId, clientX: x, clientY: y, buttons: 1, button: 0 });
  const down = (event) => {
    window.fire('pointerdown', event); // Capture phase before element pointerdown
    piece.fire('pointerdown', event);
  };
  const up = (event) => window.fire('pointerup', event);
  const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

  Object.assign(globalThis, {
    window, document, matchMedia: () => media,
    ResizeObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: (fn) => { frames.set(++nextFrame, fn); return nextFrame; },
    cancelAnimationFrame: (id) => frames.delete(id),
  });
  try {
    await import('./demo.mjs');
    down(pointer(1, 70, 80));
    assert.equal(piece.dataset.pressed, '');
    up(pointer(1, 70, 80));
    assert.equal(status.textContent, 'Дзеянняў: 1');
    assert.equal(piece.dataset.picked, undefined);

    down(pointer(2, 70, 80));
    assert.equal(piece.dataset.pressed, '');
    await sleep(145);
    assert.equal(piece.dataset.picked, '');
    assert.equal(piece.dataset.dragging, undefined);
    up(pointer(2, 70, 80));
    assert.equal(status.textContent, 'Дзеянняў: 1', 'stationary long press cannot navigate');
    assert.equal(piece.dataset.picked, undefined);

    down(pointer(3, 70, 80));
    window.fire('pointermove', pointer(3, 110, 110));
    assert.equal(piece.dataset.picked, '', 'drag starts without waiting for hold timer');
    assert.equal(piece.dataset.dragging, '');
    runFrame();
    assert.notEqual(piece.style.transform, 'translate(56px, 50px)', 'weight follows instead of teleporting');
    up(pointer(3, 110, 110));
    for (let i = 0; i < 160; i += 1) runFrame();
    assert.equal(piece.style.transform, 'translate(56px, 50px)');
    assert.equal(status.textContent, 'Дзеянняў: 1');

    down(pointer(4, 80, 80));
    window.fire('pointerdown', pointer(5, 350, 300));
    await sleep(145);
    assert.equal(piece.dataset.picked, undefined, 'cancelled hold cannot fire late');
    up(pointer(4, 80, 80));
    up(pointer(5, 350, 300));
    assert.equal(status.textContent, 'Дзеянняў: 1');
    piece.fire('click', { detail: 0 });
    assert.equal(status.textContent, 'Дзеянняў: 2', 'keyboard access remains available');
  } finally {
    window.fire('pagehide');
    for (const [name, value] of Object.entries(original)) {
      if (value === undefined) delete globalThis[name];
      else globalThis[name] = value;
    }
  }
});
