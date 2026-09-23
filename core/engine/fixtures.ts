// Shared reducer-test fixtures for the G05.01.a/b acceptance suites: one
// pinned package — stop-crane with base+extended, stop-plain base-only,
// stop-gate paid-only (ADR G01.01 §4.4, primary = extended) — plus the
// Start/AccessReady event builders and the small state helpers both suites
// use. Single source: no test file keeps a sibling copy. No node:* imports —
// the core zone is closed for non-test files, so the guards throw plain
// Errors that still name the broken expectation.
import { defaultEngineConfig, step } from './reducer.ts';
import { initialRunState, type RunSessionState, type RunState } from './state.ts';
import type { RunEvent } from './events.ts';

export const CONFIG = defaultEngineConfig;
export const NOW = 1_000_000;

export const STOPS = [
  { stopId: 'stop-crane', storyBaseId: 'story-crane-base', storyExtendedId: 'story-crane-ext' },
  { stopId: 'stop-plain', storyBaseId: 'story-plain-base' },
  { stopId: 'stop-gate', storyExtendedId: 'story-gate-ext' },
];

export const startEvent = (overrides: Partial<Extract<RunEvent, { type: 'Start' }>> = {}): RunEvent => ({
  type: 'Start',
  sessionId: 'session-1',
  routeId: 'route-1',
  version: 'v3',
  locale: 'be',
  tier: ['base'],
  accessibleStopIds: ['stop-crane', 'stop-plain'],
  stops: STOPS,
  ...overrides,
});

export const accessReady = (
  overrides: Partial<Extract<RunEvent, { type: 'AccessReady' }>> = {},
): RunEvent => ({
  type: 'AccessReady',
  routeId: 'route-1',
  version: 'v3',
  locale: 'be',
  tier: 'extended',
  stopIds: ['stop-crane', 'stop-gate'],
  issuer: 'services/download',
  ...overrides,
});

export const sessionOf = (result: { state: RunState }): RunSessionState => {
  if (result.state.phase === 'Idle') {
    throw new Error('a session must exist after Start');
  }
  return result.state;
};

export const started = (): RunSessionState => {
  const result = step(initialRunState, startEvent(), NOW, CONFIG);
  if (result.commands.length > 0) throw new Error('Start itself emits no effect commands');
  return sessionOf(result);
};

export const withQueued = (state: RunSessionState): RunSessionState => ({
  ...state,
  queued: { stopId: 'stop-plain', radius: 30, at: NOW },
});
