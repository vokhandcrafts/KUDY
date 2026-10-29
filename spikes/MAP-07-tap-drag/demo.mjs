import { createTapDrag } from './tap-drag.mjs';

// This adapter owns browser events; the engine has no DOM or navigation imports.
export function mountDemo(board, status) {
  const scope = new AbortController();
  const pointers = new Set();
  const entries = [];
  let active = null;
  let actions = 0;
  const listen = (target, type, handler) => target.addEventListener(type, handler, { signal: scope.signal });
  const activate = () => { status.textContent = `Дзеянняў: ${++actions}`; };
  const point = (event) => ({ pointerId: event.pointerId, x: event.clientX, y: event.clientY });
  const flush = (entry) => {
    cancelAnimationFrame(entry.frame);
    entry.frame = 0;
    const { x, y } = entry.engine.getPosition();
    entry.element.style.transform = `translate(${x}px, ${y}px)`;
  };
  const finish = () => {
    if (!active) return;
    const entry = active;
    active = null;
    entry.engine.cancel(entry.pointerId);
    delete entry.element.dataset.dragging;
    if (entry.element.hasPointerCapture(entry.pointerId)) entry.element.releasePointerCapture(entry.pointerId);
    flush(entry);
  };
  const build = (entry, position) => {
    entry.engine = createTapDrag({
      position, size: { width: entry.element.offsetWidth, height: entry.element.offsetHeight },
      bounds: { left: 8, top: 8, right: board.clientWidth - 8, bottom: board.clientHeight - 8 },
      threshold: 8, disabled: entry.element.getAttribute('aria-disabled') === 'true', onTap: activate,
      onMove: () => {
        entry.element.dataset.dragging = '';
        if (!entry.frame) entry.frame = requestAnimationFrame(() => flush(entry));
      },
    });
    flush(entry);
  };
  for (const [index, element] of [...board.querySelectorAll('.piece')].entries()) {
    const entry = { element, frame: 0, pointerId: null, engine: null };
    build(entry, { x: 16 + index * 44, y: 20 + index * 106 });
    entries.push(entry);
    listen(element, 'pointerdown', (event) => {
      if (event.button !== 0 || pointers.size !== 1 || active) return;
      active = entry;
      entry.pointerId = event.pointerId;
      entry.engine.down(point(event));
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
    if (active?.pointerId === event.pointerId) {
      if (active.element.hasPointerCapture(event.pointerId)) active.engine.up(point(event));
      finish();
    }
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
  return () => {
    interrupt();
    resize.disconnect();
    scope.abort();
    for (const entry of entries) cancelAnimationFrame(entry.frame);
  };
}

const dispose = mountDemo(document.querySelector('#board'), document.querySelector('#status'));
window.addEventListener('pagehide', dispose, { once: true });
