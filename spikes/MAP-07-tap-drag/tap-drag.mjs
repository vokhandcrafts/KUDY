/**
 * Renderer-independent, single-fragment gesture prototype (MAP-07).
 * Coordinates, size, bounds and threshold share the adapter's logical units.
 * Bounds are the safe area, including any screen-edge/navigation gutter.
 * Callbacks run synchronously; adapters should coalesce paint work per frame.
 */
export function createTapDrag({ position, size, bounds, threshold = 8, disabled = false, onTap, onMove }) {
  // Missing bounds is an invalid configuration too: destructure into empties so the
  // finite check below diagnoses it with the same documented RangeError.
  const { left, top, right, bottom } = bounds ?? {};
  const maxX = right - size.width;
  const maxY = bottom - size.height;
  if (![position.x, position.y, size.width, size.height, left, top, right, bottom, threshold].every(Number.isFinite)
      || size.width <= 0 || size.height <= 0 || threshold <= 0 || maxX < left || maxY < top) {
    throw new RangeError('A fragment must fit inside finite safe bounds with a positive drag threshold');
  }
  const clamp = ({ x, y }) => ({ x: Math.max(left, Math.min(maxX, x)), y: Math.max(top, Math.min(maxY, y)) });
  let current = clamp(position);
  let gesture = null;
  const contacts = new Set();
  const valid = (point) => point && Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.pointerId);
  const move = (point) => {
    if (!valid(point) || gesture?.pointerId !== point.pointerId) return;
    const dx = point.x - gesture.x;
    const dy = point.y - gesture.y;
    gesture.dragging ||= Math.hypot(dx, dy) >= threshold;
    if (!gesture.dragging) return;
    const next = clamp({ x: gesture.origin.x + dx, y: gesture.origin.y + dy });
    if (next.x === current.x && next.y === current.y) return;
    current = next;
    onMove({ ...current });
  };
  const cancel = (pointerId) => {
    contacts.delete(pointerId);
    if (gesture?.pointerId === pointerId) gesture = null;
  };
  return {
    down(point) {
      if (!valid(point) || contacts.has(point.pointerId)) return;
      contacts.add(point.pointerId);
      if (contacts.size > 1) { gesture = null; return; }
      gesture = { ...point, origin: { ...current }, dragging: false };
    },
    move,
    up(point) {
      if (!point) return;
      // Account for the final sample even when the platform coalesced movement.
      move(point);
      const tap = valid(point) && gesture?.pointerId === point.pointerId && !gesture.dragging;
      cancel(point.pointerId);
      if (tap && !disabled) onTap();
    },
    cancel,
    lostPointer: cancel,
    getPosition: () => ({ ...current }),
  };
}
