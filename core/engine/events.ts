// G05.01.a — engine event union. Event names are copied verbatim from
// 09 §6.1 (implementation-rules 2); field shapes follow 19 §3.1 with the
// moment-variant events 09 §6.1 carries after the G01.02 synchronization.
// Field spelling is the camelCase mapping declared in state.ts.

import type {
  AcceptedFix,
  Locale,
  MomentId,
  PackageStop,
  PlayToken,
  RouteId,
  SessionId,
  StoryId,
  StopId,
  Tier,
  VersionId,
} from './state.ts';

export type RunEvent =
  // 09 §6.1 names Start without fields; this reducer form (19 §3.1) carries
  // what Start needs: readiness is verified before the Start transaction
  // (ADR G01.03 §3.3), so `tier` lists the verified layers, and the pinned
  // package rides along because pin checks and derived status read it —
  // the reducer counterpart of run-model start(sessionId, routeStops, …).
  | {
      type: 'Start';
      sessionId: SessionId;
      routeId: RouteId;
      version: VersionId;
      locale: Locale;
      tier: Tier[];
      accessibleStopIds: StopId[];
      stops: PackageStop[];
    }
  | { type: 'Pause' }
  | { type: 'Resume' }
  | { type: 'End' }
  | { type: 'LocationAccepted'; fix: AcceptedFix }
  | { type: 'DwellCompleted'; stopId: StopId }
  | { type: 'AudioFinished'; sessionId: SessionId; playId: number; storyId?: StoryId }
  | { type: 'MomentFinished'; token: PlayToken; momentId: MomentId; storyId: StoryId }
  | { type: 'AudioFailed'; token: PlayToken; reason: string }
  | { type: 'UserSelectedStop'; stopId: StopId }
  | { type: 'UserSelectedStory'; stopId: StopId; storyId: StoryId }
  | { type: 'PlayMoment'; momentId: MomentId; storyId: StoryId; token: PlayToken }
  | { type: 'UserPausedAudio' }
  | { type: 'UserStoppedAudio' }
  | { type: 'FocusLoss' }
  | { type: 'FocusRegain' }
  | { type: 'ResumeAudio'; token: PlayToken }
  // «Працягнуць гід» — the single way back to guide automation (ADR G01.02 §3.6.4).
  | { type: 'GuideResume' }
  | { type: 'Timer'; id: string }
  // Full launch identity (ADR G01.03 §3.5): trusted only through the typed
  // capability channel of services/download; `issuer` is the descriptive
  // marker of that channel, not the trust check itself.
  | {
      type: 'AccessReady';
      routeId: RouteId;
      version: VersionId;
      locale: Locale;
      tier: Tier;
      stopIds: StopId[];
      issuer: 'services/download';
    };
