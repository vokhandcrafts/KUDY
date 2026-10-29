import { createTapDrag } from './tap-drag.mjs';
import { createWeightedMotion } from './weighted-motion.mjs';
import { createPickupFeedback } from './pickup-feedback.mjs';

// This adapter owns browser events; the engine has no DOM or navigation imports.
export function mountDemo(board, status) {
  const scope = new AbortController();
  const pointers = new Set();
  const entries = [];
  const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
  let active = null;
  let actions = 0;
  const listen = (target, type, handler) => target.addEventListener(type, handler, { signal: scope.signal });
  const activate = () => { status.textContent = `Дзеянняў: ${++actions}`; };
  const point = (event) => ({ pointerId: event.pointerId, x: event.clientX, y: event.clientY });

  const paint = (entry) => {
    const { x, y } = entry.motion.getPosition();
    entry.element.style.transform = `translate(${x}px, ${y}px)`;
  };
  const animate = (entry) => {
    if (entry.frame) return;
    entry.frame = requestAnimationFrame((time) => {
      entry.frame = 0;
      entry.motion.advance(entry.lastFrame === null ? 16 : time - entry.lastFrame);
      entry.lastFrame = time;
      paint(entry);
      if (!entry.motion.isSettled()) animate(entry);
      else entry.lastFrame = null;
    });
  };
  const setPickupState = (entry, state) => {
    delete entry.element.dataset.pressed;
    delete entry.element.dataset.picked;
    if (state === 'pressed') entry.element.dataset.pressed = '';
    if (state === 'lifted') entry.element.dataset.picked = '';
  };
  const finish = (event = null) => {
    if (!active) return;
    const entry = active;
    active = null;
    const captured = entry.element.hasPointerCapture(entry.pointerId);
    if (event && captured) {
      const grabbed = entry.pickup.release();
      // Holding still is a grab, not a delayed navigation tap. Moving beyond
      // the gesture threshold remains immediate even before the pickup timer.
      if (grabbed && !entry.dragging) entry.engine.cancel(entry.pointerId);
      else entry.engine.up(point(event));
    } else {
      entry.pickup.cancel();
      entry.engine.cancel(entry.pointerId);
    }
    delete entry.element.dataset.dragging;
    if (captured) entry.element.releasePointerCapture(entry.pointerId);
    entry.pointerId = null;
    entry.dragging = false;
    // Do not jump to the target: the weighted follower settles after release.
    if (!entry.motion.isSettled()) animate(entry);
  };
  const build = (entry, position) => {
    cancelAnimationFrame(entry.frame);
    entry.frame = 0;
    entry.lastFrame = null;
    entry.motion = createWeightedMotion({ position, reducedMotion: motionPreference.matches });
    entry.engine = createTapDrag({
      position, size: { width: entry.element.offsetWidth, height: entry.element.offsetHeight },
      bounds: { left: 8, top: 8, right: board.clientWidth - 8, bottom: board.clientHeight - 8 },
      threshold: 8, disabled: entry.element.getAttribute('aria-disabled') === 'true',
      onTap: activate,
      onMove: (target) => {
        entry.dragging = true;
        entry.pickup.drag();
        entry.element.dataset.dragging = '';
        entry.motion.setTarget(target);
        animate(entry);
      },
    });
    paint(entry);
  };

  for (const [index, element] of [...board.querySelectorAll('.piece')].entries()) {
    const entry = { element, frame: 0, lastFrame: null, pointerId: null, dragging: false, engine: null, motion: null, pickup: null };
    entry.pickup = createPickupFeedback({
      schedule: (callback, delay) => setTimeout(callback, delay),
      unschedule: (timer) => clearTimeout(timer),
      onChange: (state) => setPickupState(entry, state),
    });
    build(entry, { x: 16 + index * 44, y: 20 + index * 106 });
    entries.push(entry);
    listen(element, 'pointerdown', (event) => {
      if (event.button !== 0 || pointers.size !== 1 || active) return;
      // A new grab takes the piece where it actually is, not where its old
      // animation was aiming. Never let the follower teleport on a fresh press.
      if (!entry.motion.isSettled()) build(entry, entry.motion.getPosition());
      active = entry;
      entry.pointerId = event.pointerId;
      entry.dragging = false;
      entry.engine.down(point(event));
      entry.pickup.press();
      element.setPointerCapture(event.pointerId);
    });
    listen(element, 'lostpointercapture', () => { if (active === entry) finish(); });
    // Pointer activation is exclusively handled by the engine. Keyboard/AT clicks
    // have detail=0 and remain available without dragging.
    listen(element, 'click', (event) => {
      if (event.detail === 0 && !pointers.size && element.getAttribute('aria-disabled') !== 'true') activate();
    });
  }
  // Observe contacts outside the current tile too: a second finger anywhere
  // cancels the gesture until all contacts are released.
  window.addEventListener('pointerdown', (event) => {
    pointers.add(event.pointerId);
    if (pointers.size > 1) finish();
  }, { capture: true, signal: scope.signal });
  listen(window, 'pointermove', (event) => {
    if (!active || active.pointerId !== event.pointerId) return;
    if (event.buttons === 0 || !active.element.hasPointerCapture(event.pointerId)) { finish(); return; }
    active.engine.move(point(event));
  });
  listen(window, 'pointerup', (event) => {
    pointers.delete(event.pointerId);
    if (active?.pointerId === event.pointerId) finish(event);
  });
  listen(window, 'pointercancel', (event) => { pointers.delete(event.pointerId); finish(); });
  const interrupt = () => { finish(); pointers.clear(); };
  listen(window, 'blur', interrupt);
  listen(document, 'visibilitychange', () => { if (document.hidden) interrupt(); });
  listen(window, 'keydown', (event) => { if (event.key === 'Escape') finish(); });
  const resize = new ResizeObserver(() => {
    finish();
    for (const entry of entries) build(entry, entry.engine.getPosition());
  });
  resize.observe(board);
  listen(motionPreference, 'change', () => {
    finish();
    for (const entry of entries) build(entry, entry.engine.getPosition());
  });
  return () => {
    interrupt();
    resize.disconnect();
    scope.abort();
    for (const entry of entries) {
      entry.pickup.cancel();
      cancelAnimationFrame(entry.frame);
    }
  };
}

const dispose = mountDemo(document.querySelector('#board'), document.querySelector('#status'));
window.addEventListener('pagehide', dispose, { once: true });
