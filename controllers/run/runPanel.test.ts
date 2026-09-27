// G06.03 (issue #279) — the panel's transition model: the ladder rules of
// 11 §2/§6 as unit facts. The controller's actions adapt onto these
// functions, so a regression here is a regression on the screen's ✕, Back
// and expand affordances.
import test from 'node:test';
import assert from 'node:assert/strict';

import { initialPanelState, panelClosed, panelOpened, panelRaised } from './runPanel.ts';

test('a marker tap lands Peek on Half and keeps the position above Peek', () => {
  assert.deepEqual(panelOpened(initialPanelState, 'stop-1'), { position: 'half', inspected: 'stop-1' });
  assert.deepEqual(panelOpened({ position: 'half', inspected: 'stop-7' }, 'stop-9'), {
    position: 'half',
    inspected: 'stop-9',
  });
  assert.deepEqual(panelOpened({ position: 'full', inspected: 'stop-7' }, 'stop-9'), {
    position: 'full',
    inspected: 'stop-9',
  });
});

test('re-opening the open card changes nothing; the expand raises one position up', () => {
  const half = { position: 'half', inspected: 'stop-1' } as const;
  assert.strictEqual(panelOpened(half, 'stop-1'), half);
  const full = { position: 'full', inspected: 'stop-1' } as const;
  assert.strictEqual(panelRaised(full), full);
  assert.deepEqual(panelRaised({ position: 'half', inspected: 'stop-1' }), {
    position: 'full',
    inspected: 'stop-1',
  });
  assert.deepEqual(panelRaised(initialPanelState), { position: 'half', inspected: null });
});

test('the close step is one position down and keeps the last inspected card', () => {
  assert.deepEqual(panelClosed({ position: 'full', inspected: 'stop-1' }), {
    position: 'half',
    inspected: 'stop-1',
  });
  assert.deepEqual(panelClosed({ position: 'half', inspected: 'stop-1' }), {
    position: 'peek',
    inspected: 'stop-1',
  });
  // At Peek the panel is already closed — the same object, no churn.
  const peek = { position: 'peek', inspected: 'stop-1' } as const;
  assert.strictEqual(panelClosed(peek), peek);
});
