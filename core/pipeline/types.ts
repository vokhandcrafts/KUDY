// G05.02.a — contract types of the location pipeline (19 §3.3, 09 §6.2).
// Canon anchors: FixInput and AcceptedFix are copied verbatim (19 §3.3 /
// core/engine/state.ts — one spelling, the engine's); the pipeline emits the
// engine's LocationAccepted/DwellCompleted forms only.
//
// Two deliberate extensions of the 19 §3.3 sketch, recorded here once
// (implementation-rules 2/6):
// 1. The sketch shows `candidates: ReadonlyMap<StopId, number>` — a bare
//    number cannot evaluate candidates on the smoothed point (09 §6.2 stage
//    4) nor order simultaneous candidates by distance (AC 5), so the value
//    carries the stop's coordinates and its trigger radius.
// 2. The state the pipeline owns (19 §2.1: the smoothing window and the dwell
//    accumulators — nothing else) is threaded explicitly, like the engine's
//    step(previous, …) (19 §3.1), so a rejected fix is deep-equal testable
//    (AC 1); `now` rides along because the future-timestamp check (AC 6,
//    19 §3.3 FixInput: «будучыя … значэнні не прымаюцца») has no other source
//    — the pipeline reads no clock.

import type { AcceptedFix, StopId } from '../engine/state.ts';
import type { RunEvent } from '../engine/events.ts';

// 19 §3.3 FixInput: «недаступныя/будучыя/адмоўныя значэнні не прымаюцца» —
// enforced by corruptReason() with named reasons, never thrown.
export interface FixInput {
  lat: number;
  lng: number;
  accuracy: number;
  at: number;
}

// The caller's candidate set (09 §6.2: the pipeline receives the candidates
// from outside and knows nothing about heard/auto_fired — AR-5, 19 §1.3).
// `radius` is the stop's trigger radius in meters; dwell accumulates while
// the smoothed point stays within it.
export interface PipelineCandidate {
  lat: number;
  lng: number;
  radius: number;
}

// AR-5 (19 §1.3): services/config is the single provider of the calibrated
// numbers (dwell among them, G11.02); the gates' constants (40 m, 12 km/h,
// 5 m, window 3) are 09 §6.2 canon, not configuration.
export interface PipelineConfig {
  dwellMs: number;
}

// One stop's dwell accumulator: exists in the state only while the smoothed
// point keeps the stop inside its radius; leaving resets it (removal), so
// `emitted` is per continuous dwell (AC 4).
export interface DwellAccumulator {
  accumulatedMs: number;
  emitted: boolean;
}

export interface PipelineState {
  // The last ≤ 3 accepted fixes, oldest first, RAW coordinates — the spike
  // stage compares consecutive accepted fixes, smoothing averages them after.
  window: FixInput[];
  dwell: Map<StopId, DwellAccumulator>;
}

export const initialPipelineState: PipelineState = { window: [], dwell: new Map() };

// The events the pipeline hands the controller (19 §3.3: the controller
// replays them through engine step()). DwellCompleted carries the trigger
// radius of the confirmed dwell (engine events.ts, G05.01.b payload).
export type PipelineEvent = Extract<
  RunEvent,
  { type: 'LocationAccepted' } | { type: 'DwellCompleted'; stopId: StopId }
>;

// Named rejection reasons (AC 6: named, never thrown, never accepted). One
// reason per failed check — negative tests isolate exactly one violation
// (implementation-rules 14).
export type FixRejectionReason =
  | 'non-finite-coordinate' // NaN/Infinity lat or lng
  | 'latitude-out-of-range' // |lat| > 90
  | 'missing-accuracy' // accuracy absent or not a finite number
  | 'negative-accuracy' // accuracy < 0
  | 'non-finite-timestamp' // at absent or not a finite number
  | 'future-timestamp' // at > now
  | 'accuracy' // 09 §6.2 stage 1: claimed precision worse than 40 m
  | 'spike-speed' // increasing time, implied speed > 12 km/h
  | 'spike-displacement'; // non-increasing time, displacement > 5 m

export type AcceptResult =
  | { accepted: false; reason: FixRejectionReason; state: PipelineState }
  | { accepted: true; fix: AcceptedFix; events: PipelineEvent[]; state: PipelineState };
