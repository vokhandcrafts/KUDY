// G05.02.c — the pure OS-fix mapping (AC1): an expo LocationObject lands
// here structurally (the adapter module is the only expo importer; this file
// stays importable by node --test). The shape checks are the pipeline's own
// exported `fixShapeReason` — one spelling (implementation-rules 2/8): a
// malformed OS fix is rejected at the boundary with the same named reason
// the pipeline would answer, and a missing accuracy (Android reports it as
// null) is rejected `missing-accuracy`, never mapped to 0 — that is the
// revert experiment of the task card. Deliberately NOT checked here: the
// semantic gates (the 40 m accuracy gate, spikes, freshness) — raw fixes are
// forwarded unchanged (criterion 5 of G05.02.b) and every decision stays in
// the pipeline (G05.02.a). Longitude range is not a shape check anywhere in
// the canon; the pipeline does not gate it either.
import { fixShapeReason } from '../../../core/pipeline/pipeline.ts';
import type { FixRejectionReason } from '../../../core/pipeline/types.ts';
import type { FixInput } from '../types.ts';

// The structural slice of expo's LocationObject the mapping needs. `accuracy`
// is null whenever Android cannot report one; the other fields are typed as
// numbers by expo but the shape checks still see what the OS actually sent.
export interface OsLocationObject {
  coords: {
    latitude: number;
    longitude: number;
    accuracy: number | null;
  };
  timestamp: number;
}

export type FixMappingResult =
  | { ok: true; fix: FixInput }
  | { ok: false; reason: FixRejectionReason };

export function mapOsLocationToFix(os: OsLocationObject): FixMappingResult {
  // The input is the OS boundary and is not trusted at any depth: a batch
  // entry without readable coords is answered with a named reason, never a
  // thrown TypeError (implementation-rules 14) — a throw here would skip the
  // rest of a TaskManager batch or escape into the native watch emitter.
  if (
    os === null ||
    typeof os !== 'object' ||
    os.coords === null ||
    typeof os.coords !== 'object' ||
    typeof os.coords.latitude !== 'number' ||
    typeof os.coords.longitude !== 'number'
  ) {
    return { ok: false, reason: 'non-finite-coordinate' };
  }
  // The draft feeds the shape checks only; null/NaN fields reach them as
  // non-numbers and get their named reason.
  const draft = {
    lat: os.coords.latitude,
    lng: os.coords.longitude,
    accuracy: os.coords.accuracy,
    at: os.timestamp,
  } as FixInput;
  const reason = fixShapeReason(draft);
  if (reason !== null) return { ok: false, reason };
  return { ok: true, fix: draft };
}
