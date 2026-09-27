// G06.04 (issue #63) — the db-backed RunSessionStore port both run suites
// share (the duplication the copy-paste gate caught): the wiring the
// composition root of the app build implements over services/db's public
// API (issue #209 AC1). The switch-guide transaction resolves the app-wide
// live row itself (ADR G01.03 §3.1) and reports the finished session id
// back, so the composition root can retire the surface that owned it.
// Lives in test/ beside the render helpers: it is test-only wiring, and the
// controllers zone keeps its services imports type-only (19 §2.2).
import {
  DbError,
  checkpointProgress,
  finishSession,
  getLiveSession,
  pauseSession,
  resumeSession,
  startSession,
  switchSession,
} from '../services/db/db.ts';
import type { SqlDriver } from '../services/db/types.ts';
import type { RunSessionStore } from '../controllers/useRunController.ts';

export function sessionStoreOver(driver: SqlDriver): RunSessionStore {
  return {
    start(input) {
      try {
        startSession(driver, input);
        return { ok: true };
      } catch (error) {
        if (error instanceof DbError && error.rule === 'live-session-exists') {
          return { ok: false, reason: 'live-session-exists' };
        }
        throw error;
      }
    },
    startSwitch(input, meta) {
      // The app-wide live row is resolved by the implementation (G06.04):
      // the switch-guide transaction finishes it and inserts the next row.
      const live = getLiveSession(driver);
      if (!live) return { ok: false, reason: 'no-live-session' };
      try {
        switchSession(driver, live.sessionId, input, { finishedAt: meta.finishedAt });
        return { ok: true, finishedSessionId: live.sessionId };
      } catch (error) {
        if (error instanceof DbError && error.rule === 'session-not-live') {
          return { ok: false, reason: 'no-live-session' };
        }
        throw error;
      }
    },
    checkpoint: (sessionId, progress) => checkpointProgress(driver, sessionId, progress),
    pause: (sessionId, progress) => pauseSession(driver, sessionId, progress),
    resume: (sessionId) => resumeSession(driver, sessionId),
    finish: (sessionId, input) => finishSession(driver, sessionId, input),
  };
}
