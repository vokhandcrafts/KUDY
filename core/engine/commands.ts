// G05.01.a — engine command union. Command names are copied verbatim from
// 09 §6.1 (implementation-rules 2); effects belong to the controller and the
// services — the engine only proposes them. Field spelling is the camelCase
// mapping declared in state.ts.

import type { MomentId, PlayToken, SessionId, StoryId, StopId } from './state.ts';

// The event payload allowlist is owned by G01.05 (issue #185) — the reducer
// emits no EmitEvent command yet; the payload type stays open until that
// contract closes.
export type EventPayload = Record<string, unknown>;

export type RunCommand =
  | { type: 'PlayStory'; storyId: StoryId; path: string; sessionId: SessionId; playId: number }
  | { type: 'PlayMoment'; momentId: MomentId; path: string; token: PlayToken }
  | { type: 'StopAudio' }
  | { type: 'PauseAudio' }
  | { type: 'ResumeAudio' }
  // The window is rebuilt from the currently eligible stops; services/location
  // owns the ≤ 20-region selection (09 §6.3).
  | { type: 'SetGeofenceWindow'; stopIds: StopId[] }
  | { type: 'ClearGeofences' }
  | { type: 'ScheduleTimer'; id: string; ms: number }
  | { type: 'CancelTimer'; id: string }
  | { type: 'PersistProgress' }
  | { type: 'EmitEvent'; payload: EventPayload }
  | { type: 'ShowArrivalCard'; stopId: StopId };
