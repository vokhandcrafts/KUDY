// G06.02 (issue #278) — the run map's marker model, framework-free: the
// five marker states come verbatim from the engine's computed stopStatus
// (ADR G01.01 §4.5 — one spelling, no second contract), the geometry from
// the pinned package's places, and the projection is a plain equirectangular
// fit over the shown points. There is no tile engine and no line: the map
// decision (ADR G00.02) is not accepted, so the surface renders an honest
// schematic — markers at their relative positions, the ODbL attribution
// visible (11 §6), and no mandatory next/deviated line (the route line is
// optional and the bundle carries no line geometry).
import { stopStatus, type RunState, type StopStatus } from '../../core/engine/state.ts';
import type { RunPlaceFact, RunStopFact } from '../../services/contentRepo/runMapFacts.ts';
import type { RunStop } from './runOrchestrator.ts';
import { RUN_MAP_STRINGS_DATA } from './runMap-strings.generated.ts';

export interface RunMapMarker {
  readonly stopId: string;
  readonly name: string;
  readonly status: StopStatus;
  // Equirectangular projection over the combined stop+POI bounding box,
  // normalized to 0..1 (the screen renders percentages — no pixel math here).
  readonly nx: number;
  readonly ny: number;
}

export interface RunMapPoi {
  readonly placeId: string;
  readonly kind: string;
  // A POI is a place no route stop references (11 §6: the point that just is
  // — coffee, toilet, transport). It has no story, no status and no preview.
  readonly nx: number;
  readonly ny: number;
}

export interface RunMapView {
  readonly markers: ReadonlyArray<RunMapMarker>;
  readonly pois: ReadonlyArray<RunMapPoi>;
}

// The localized label of a stop: the first locale of the walk's preference
// the package names the stop in, else the stop id (a stop without a preview
// name stays identifiable — no invented label).
export function stopLabel(
  name: Readonly<Record<string, string>>,
  localePreference: readonly string[],
  stopId: string,
): string {
  for (const locale of localePreference) {
    const label = name[locale];
    if (label !== undefined) return label;
  }
  return stopId;
}

interface Point {
  readonly lat: number;
  readonly lng: number;
}

// The lng axis is compressed by cos(mid-lat) so east-west distances keep
// their proportion to north-south ones at the route's latitude. A single
// point (or a zero span on an axis) sits at that axis's center.
function project(points: ReadonlyArray<Point>): ReadonlyArray<{ nx: number; ny: number }> {
  if (points.length === 0) return [];
  const lats = points.map((point) => point.lat);
  const lngs = points.map((point) => point.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const midLat = (minLat + maxLat) / 2;
  const spanLat = maxLat - minLat;
  const spanLng = (maxLng - minLng) * Math.max(0.01, Math.cos((midLat * Math.PI) / 180));
  const MARGIN = 0.08;
  const fit = (value: number, low: number, span: number): number =>
    span <= 0 ? 0.5 : MARGIN + ((value - low) / span) * (1 - 2 * MARGIN);
  return points.map((point) => ({
    nx: fit(point.lng, minLng, spanLng),
    ny: 1 - fit(point.lat, minLat, spanLat),
  }));
}

// The map view of the live session: stop markers from the engine's own stop
// list (the session truth) with the pinned package's geometry and names, and
// the POI points beside them. A session stop the pinned facts miss (a state
// restored against a changed package) renders at the map's center with its
// computed status — honest absence, no invented geometry.
export function runMapView(
  run: RunState,
  stops: ReadonlyArray<RunStop>,
  facts: ReadonlyArray<RunStopFact>,
  places: ReadonlyArray<RunPlaceFact>,
  localePreference: readonly string[],
): RunMapView {
  if (run.phase === 'Idle') return { markers: [], pois: [] };
  const geometryByStop = new Map(stops.map((stop) => [stop.stopId, stop]));
  const nameByStop = new Map(facts.map((fact) => [fact.stopId, fact.name]));
  const stopPlaces = new Set(facts.map((fact) => fact.placeId));
  const poiPlaces = places.filter((place) => !stopPlaces.has(place.placeId));
  const fitted = project([
    ...stops.map((stop) => ({ lat: stop.lat, lng: stop.lng })),
    ...poiPlaces.map((place) => ({ lat: place.lat, lng: place.lng })),
  ]);
  const markers = run.stops.map((sessionStop) => {
    const geometry = geometryByStop.get(sessionStop.stopId);
    const fit = geometry ? fitted[stops.indexOf(geometry)] : undefined;
    return {
      stopId: sessionStop.stopId,
      name: stopLabel(nameByStop.get(sessionStop.stopId) ?? {}, localePreference, sessionStop.stopId),
      status: stopStatus(run, sessionStop.stopId),
      nx: fit?.nx ?? 0.5,
      ny: fit?.ny ?? 0.5,
    };
  });
  const pois = poiPlaces.map((place, index) => {
    const fit = fitted[stops.length + index];
    return { placeId: place.placeId, kind: place.kind, nx: fit?.nx ?? 0.5, ny: fit?.ny ?? 0.5 };
  });
  return { markers, pois };
}

// The surface's words, per the walk's pinned locale (BE/EN; the language
// canon is 09 §0 — be + en — and an unknown locale falls back to Belarusian,
// the app's first preference).
export interface RunMapStrings {
  readonly status: Record<StopStatus, string>;
  // G08.05 (AC5, 11 §16.4): the locked card's honest next step — available
  // after purchase, no content revealed.
  readonly lockedHint: string;
  readonly pausedTitle: string;
  readonly resume: string;
  // The session menu of 11 §4.2/§4.3 (G06.04): the whole-walk pause and the
  // finish — both legal at any moment of a live walk.
  readonly pauseWalk: string;
  readonly endWalk: string;
  // UX 06 (issue #352): the destructive finish asks first — the dialog's
  // title and the two actions sit with the other surface words.
  readonly endConfirmTitle: string;
  readonly endConfirmAccept: string;
  readonly endConfirmCancel: string;
  readonly endedTitle: string;
  readonly close: string;
  readonly loading: string;
  readonly unavailableTitle: string;
  readonly schematicNote: string;
  readonly attribution: string;
  readonly markerHint: string;
  // The history panel's words (G06.03, 11 §2/§3.2): the Peek bar's idle
  // line, the «Зараз грае» return row, the Full transcript heading with its
  // honest pending note (no story text exists in the package facts yet),
  // the Half→Full affordance and the bar's playback control labels.
  readonly nothingPlaying: string;
  readonly nowPlayingLabel: string;
  readonly transcript: string;
  readonly transcriptPending: string;
  readonly readMore: string;
  readonly pauseAudio: string;
  readonly playAudio: string;
  // The named refusals the surface states carry: the run controller's start
  // refusals (verbatim enums) and the pinned-package port's own refusals.
  // A diagnostic outside the map shows as-is — honest, never invented.
  readonly reasonText: Record<
    | 'package-incomplete'
    | 'package-needs-recovery'
    | 'package-access-locked'
    | 'live-session-exists'
    | 'switch-no-live-session'
    | 'run#package-not-downloaded'
    | 'run#package-ambiguous'
    | 'run#unsafe-route-id'
    | 'run#locale-missing'
    | 'run#package-read-failed'
    | 'run#recovery-failed'
    | 'fallback',
    string
  >;
  // UX 05 (issue #351): the POI labels — the package's places.json kind
  // string (place.schema.json keeps it a free ≤32-char value) mapped through
  // this per-locale dictionary. A kind without an entry renders no label at
  // all — the raw value never shows, nothing is invented.
  readonly poiKind: Record<string, string>;
  // G06.05 (issue #280): the honest degradation banners of 11 §7 — the
  // denied/stalled GPS lines (the denied wording is the contract's own), the
  // manual-play hint (the manual mode is a full path, not an emergency), the
  // suspended-automation note, the restored-session note with its tier loss,
  // and the card's story-layer words for the transcript switch.
  readonly deniedGps: string;
  readonly gpsStalled: string;
  readonly gpsStalledDetail: string;
  readonly manualPlayHint: string;
  readonly autoplaySuspendedTitle: string;
  readonly restoredTitle: string;
  readonly tierUnavailable: string;
  readonly storyBase: string;
  readonly storyExtended: string;
  readonly playStoryHint: string;
}

// The refusal's rendered word: the known map, else the raw reason itself.
export function runMapReason(reason: string, strings: RunMapStrings): string {
  return strings.reasonText[reason as keyof RunMapStrings['reasonText']] ?? reason;
}

const STRINGS = RUN_MAP_STRINGS_DATA;

export function runMapStrings(locale: string): RunMapStrings {
  return locale === 'en' ? STRINGS.en : locale === 'uk' ? STRINGS.uk : STRINGS.be;
}
