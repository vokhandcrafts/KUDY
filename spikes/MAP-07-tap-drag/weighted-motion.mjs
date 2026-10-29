/**
 * Presentation-only follower: gesture coordinates stay authoritative and immediate.
 * A critically damped response gives the fragment weight without overshoot.
 */
export function createWeightedMotion({ position, reducedMotion = false }) {
  let current = { ...position };
  let target = { ...position };
  let velocity = { x: 0, y: 0 };
  let settled = true;
  const frequency = 18;

  return {
    setTarget(point) {
      target = { ...point };
      if (reducedMotion) {
        current = { ...target };
        velocity = { x: 0, y: 0 };
      }
      settled = current.x === target.x && current.y === target.y;
    },
    advance(deltaMs) {
      if (settled || !Number.isFinite(deltaMs) || deltaMs <= 0) return { ...current };
      const dt = Math.min(deltaMs, 64) / 1000;
      const decay = Math.exp(-frequency * dt);
      for (const axis of ['x', 'y']) {
        const previous = current[axis];
        const offset = previous - target[axis];
        const impulse = velocity[axis] + frequency * offset;
        const next = target[axis] + (offset + impulse * dt) * decay;
        // No overshoot: the entire rendered bounding box stays inside its safe rectangle.
        current[axis] = Math.max(
          Math.min(previous, target[axis]),
          Math.min(Math.max(previous, target[axis]), next),
        );
        velocity[axis] = current[axis] === next
          ? (velocity[axis] - frequency * impulse * dt) * decay : 0;
        if (Math.abs(current[axis] - target[axis]) < 0.05 && Math.abs(velocity[axis]) < 1) {
          current[axis] = target[axis];
          velocity[axis] = 0;
        }
      }
      settled = current.x === target.x && current.y === target.y;
      return { ...current };
    },
    getPosition: () => ({ ...current }),
    isSettled: () => settled,
  };
}
