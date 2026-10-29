/**
 * Visual pickup cue only. It never gates drag activation or changes positions.
 * A long stationary hold is an intentional grab, not a navigation tap.
 */
export function createPickupFeedback({ schedule, unschedule, onChange, holdMs = 120 }) {
  let state = 'idle';
  let timeout = null;
  const clear = () => {
    if (timeout !== null) unschedule(timeout);
    timeout = null;
  };
  const change = (next) => {
    if (state !== next) {
      state = next;
      onChange(next);
    }
  };
  return {
    press() {
      clear();
      change('pressed');
      timeout = schedule(() => {
        timeout = null;
        if (state === 'pressed') change('lifted');
      }, holdMs);
    },
    drag() {
      clear();
      if (state !== 'idle') change('lifted');
    },
    release() {
      const grabbed = state === 'lifted';
      clear();
      change('idle');
      return grabbed;
    },
    cancel() {
      clear();
      change('idle');
    },
    getState: () => state,
  };
}
