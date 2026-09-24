// G05.02.a — the five 09 §6.2 stages as one pure function (AR-5, 19 §1.3).
// The stage order is fixed: corrupt-input validation → accuracy gate → spike
// rejection → smoothing → dwell/candidates. Every stage rejects BEFORE any
// state mutation: a rejected fix returns the previous state object unchanged,
// so the window and every dwell accumulator stay deep-equal (AC 1).
//
// The pipeline knows nothing about heard/auto_fired (09 §6.2, AR-5) and does
// not duplicate the engine's trigger-border re-checks (ADR G01.01 §4.8:
// freshness ≤ 30 s, accuracy ≤ radius, deferred distance ≤ 2 × radius live in
// core/engine). The direction filter does not constrain a walking tour
// (09 §6.2 stage 5): every approach is legal, and simultaneous candidates are
// only ordered deterministically — by distance, then stable stop_id.
//
// Pure: same (previous, fix, candidates, now, config) → same result, no
// clock, no I/O; the input state is never mutated (acceptance builds a fresh
// window array and dwell map, copying each accumulator).

import { haversineMeters } from '../geo/haversine.ts';
import type { AcceptedFix, StopId } from '../engine/state.ts';
import type {
  AcceptResult,
  FixInput,
  FixRejectionReason,
  PipelineCandidate,
  PipelineConfig,
  PipelineEvent,
  PipelineState,
} from './types.ts';

// 09 §6.2 stage 1: the street-canyon main filter — a fix claiming worse than
// 40 m precision is rejected regardless of its other merits.
const MAX_ACCURACY_M = 40;
// 09 §6.2 stage 2: implied walking speed (12 km/h — a pedestrian, not a bus)
// and, when time does not increase (Android batches and reorders fixes, speed
// undefined), the displacement cap.
const MAX_SPEED_MPS = 12 / 3.6;
const MAX_DISPLACEMENT_M = 5;
// 09 §6.2 stage 3: the window is canon-fixed at the last 3 accepted fixes.
const SMOOTHING_WINDOW = 3;

export const defaultPipelineConfig: PipelineConfig = { dwellMs: 6000 };

// AC 6 / 19 §3.3 FixInput («недаступныя/будучыя/адмоўныя значэнні не
// прымаюцца»): every corrupt shape answers with its own named reason before
// any gate runs — the accuracy gate cannot see a NaN, and a rejected fix
// never reaches the window or the dwell accumulators.
//
// The clock-free shape half is exported: the device adapters (G05.02.c) map
// OS objects onto FixInput at the boundary and reuse exactly these checks,
// so a malformed OS fix is rejected there with the same named reason the
// pipeline would answer — one spelling, no restated validation.
export function fixShapeReason(fix: FixInput): FixRejectionReason | null {
  if (!Number.isFinite(fix.lat) || !Number.isFinite(fix.lng)) return 'non-finite-coordinate';
  if (fix.lat < -90 || fix.lat > 90) return 'latitude-out-of-range';
  if (typeof fix.accuracy !== 'number' || !Number.isFinite(fix.accuracy)) return 'missing-accuracy';
  if (fix.accuracy < 0) return 'negative-accuracy';
  if (typeof fix.at !== 'number' || !Number.isFinite(fix.at)) return 'non-finite-timestamp';
  return null;
}

function corruptReason(fix: FixInput, now: number): FixRejectionReason | null {
  const shape = fixShapeReason(fix);
  if (shape !== null) return shape;
  if (fix.at > now) return 'future-timestamp';
  return null;
}

export function acceptFix(
  previous: PipelineState,
  fix: FixInput,
  candidates: ReadonlyMap<StopId, PipelineCandidate>,
  now: number,
  config: PipelineConfig,
): AcceptResult {
  const corrupt = corruptReason(fix, now);
  if (corrupt !== null) return { accepted: false, reason: corrupt, state: previous };

  const prev = previous.window[previous.window.length - 1];

  // Stage 1 — accuracy gate (09 §6.2 stage 1).
  if (fix.accuracy > MAX_ACCURACY_M) {
    return { accepted: false, reason: 'accuracy', state: previous };
  }

  // Stage 2 — spike rejection against the previous accepted fix. Increasing
  // time gives an implied speed; non-increasing time (batched/reordered
  // fixes) leaves speed undefined, so only displacement is judged.
  if (prev !== undefined) {
    const displacement = haversineMeters(prev.lat, prev.lng, fix.lat, fix.lng);
    if (fix.at > prev.at) {
      const seconds = (fix.at - prev.at) / 1000;
      if (displacement / seconds > MAX_SPEED_MPS) {
        return { accepted: false, reason: 'spike-speed', state: previous };
      }
    } else if (displacement > MAX_DISPLACEMENT_M) {
      return { accepted: false, reason: 'spike-displacement', state: previous };
    }
  }

  // Stage 3 — smoothing: the plain mean of the last ≤ 3 accepted coordinates,
  // computed after the fix joins the window. A mean never leaves the
  // bounding box of its inputs (AC 3).
  const window = [...previous.window, fix].slice(-SMOOTHING_WINDOW);
  const smoothedLat = window.reduce((sum, f) => sum + f.lat, 0) / window.length;
  const smoothedLng = window.reduce((sum, f) => sum + f.lng, 0) / window.length;

  // Stages 4–5 — dwell on the smoothed point. Distances are computed for ALL
  // passed-in candidates (route position plays no role, AC 5) and the map is
  // keyed in stable stop_id order, so the output never depends on the
  // candidate map's insertion order.
  const byId = [...candidates].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const distances = new Map<StopId, number>();
  const dwelling: Array<{ stopId: StopId; radius: number; distance: number }> = [];
  for (const [stopId, candidate] of byId) {
    const distance = haversineMeters(smoothedLat, smoothedLng, candidate.lat, candidate.lng);
    distances.set(stopId, distance);
    if (distance <= candidate.radius) {
      dwelling.push({ stopId, radius: candidate.radius, distance });
    }
  }

  // The dwell step is the time since the previous accepted fix; batched
  // (non-increasing) time adds nothing.
  const dtMs = prev === undefined ? 0 : Math.max(0, fix.at - prev.at);

  const dwell = new Map(previous.dwell);
  const dwellers = new Set(dwelling.map((d) => d.stopId));
  for (const stopId of [...dwell.keys()]) {
    if (!dwellers.has(stopId)) dwell.delete(stopId); // reset: left the radius
  }

  const acceptedFix: AcceptedFix = {
    lat: smoothedLat,
    lng: smoothedLng,
    accuracy: fix.accuracy,
    at: fix.at,
    distances,
  };
  const events: PipelineEvent[] = [{ type: 'LocationAccepted', fix: acceptedFix }];
  const completed: Array<{ stopId: StopId; radius: number; distance: number }> = [];
  for (const { stopId, radius, distance } of dwelling) {
    // Copy-on-write: the accumulator may belong to the previous state.
    const acc = { ...(dwell.get(stopId) ?? { accumulatedMs: 0, emitted: false }) };
    // The dwell grows only while the stop STAYS a candidate (09 §6.2 stage
    // 4): a fresh accumulator — the stop just (re-)entered its radius —
    // credits none of the dt that elapsed before entry (it spans the time
    // the smoothed point spent outside, possibly seconds of Doze or
    // accuracy-rejected fixes).
    if (previous.dwell.has(stopId)) acc.accumulatedMs += dtMs;
    if (!acc.emitted && acc.accumulatedMs >= config.dwellMs) {
      acc.emitted = true;
      completed.push({ stopId, radius, distance });
    }
    dwell.set(stopId, acc);
  }

  // 09 §6.2 stage 5: simultaneous completions — by distance, then stop_id.
  completed.sort(
    (a, b) => a.distance - b.distance || (a.stopId < b.stopId ? -1 : a.stopId > b.stopId ? 1 : 0),
  );
  for (const { stopId, radius } of completed) {
    events.push({ type: 'DwellCompleted', stopId, radius });
  }

  const state: PipelineState = { window, dwell };
  return { accepted: true, fix: acceptedFix, events, state };
}
