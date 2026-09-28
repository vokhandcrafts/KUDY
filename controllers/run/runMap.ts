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
  readonly back: string;
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
}

// The refusal's rendered word: the known map, else the raw reason itself.
export function runMapReason(reason: string, strings: RunMapStrings): string {
  return strings.reasonText[reason as keyof RunMapStrings['reasonText']] ?? reason;
}

const STRINGS: Record<'be' | 'en', RunMapStrings> = {
  be: {
    status: {
      playing: 'гучыць',
      played: 'праслухана',
      available: 'даступна',
      pending: 'чакае',
      locked: 'зачынена',
    },
    pausedTitle: 'Прагулка прыпынена',
    resume: 'Працягнуць',
    pauseWalk: 'Прыпыніць прагулку',
    endWalk: 'Завяршыць прагулку',
    endConfirmTitle: 'Завяршыць прагулку?',
    endConfirmAccept: 'Завяршыць',
    endConfirmCancel: 'Скасаваць',
    endedTitle: 'Прагулка завершана',
    back: '← Назад',
    close: 'Зачыніць',
    loading: 'Загрузка…',
    unavailableTitle: 'Сесія недаступная',
    schematicNote: 'Схема кропак маршруту — карта горада зʼявіцца пасля рашэння пра тайлы',
    attribution: 'Дадзеныя © удзельнікі OpenStreetMap, ODbL',
    markerHint: 'Прагляд кропкі. Аўдыё не запускаецца.',
    nothingPlaying: 'Нічога не грае',
    nowPlayingLabel: 'Зараз грае',
    transcript: 'Транскрыпт',
    transcriptPending: 'Тэкст прыйдзе з кантэнтам пакета',
    readMore: 'Чытаць',
    pauseAudio: 'Паўза',
    playAudio: 'Граць',
    reasonText: {
      'package-incomplete': 'Пакет не поўны',
      'package-needs-recovery': 'Пакет патрабуе аднаўлення',
      'package-access-locked': 'Доступ да пакета яшчэ не адкрыты',
      'live-session-exists': 'Ужо ёсць жывая прагулка',
      'switch-no-live-session': 'Жывой прагулкі ўжо няма — пачніце нанова',
      'run#package-not-downloaded': 'Пакет не спампаваны',
      'run#package-ambiguous': 'На дыску некалькі версій пакета',
      'run#unsafe-route-id': 'Няверны ідэнтыфікатар маршруту',
      'run#locale-missing': 'Мова пакета не знойдзена',
      'run#package-read-failed': 'Пакет не чытаецца',
      'run#recovery-failed': 'Збой чытання жывой сесіі',
      fallback: 'Збой',
    },
    poiKind: {
      sight: 'Славутасць',
    },
  },
  en: {
    status: {
      playing: 'playing',
      played: 'played',
      available: 'available',
      pending: 'pending',
      locked: 'locked',
    },
    pausedTitle: 'Walk paused',
    resume: 'Resume',
    pauseWalk: 'Pause the walk',
    endWalk: 'Finish the walk',
    endConfirmTitle: 'Finish the walk?',
    endConfirmAccept: 'Finish',
    endConfirmCancel: 'Cancel',
    endedTitle: 'Walk finished',
    back: '← Back',
    close: 'Close',
    loading: 'Loading…',
    unavailableTitle: 'Session unavailable',
    schematicNote: 'Route points schematic — the city map arrives after the tiles decision',
    attribution: 'Data © OpenStreetMap contributors, ODbL',
    markerHint: 'Point preview. Audio does not start.',
    nothingPlaying: 'Nothing is playing',
    nowPlayingLabel: 'Now playing',
    transcript: 'Transcript',
    transcriptPending: 'Text arrives with the content package',
    readMore: 'Read',
    pauseAudio: 'Pause',
    playAudio: 'Play',
    reasonText: {
      'package-incomplete': 'Package incomplete',
      'package-needs-recovery': 'Package needs recovery',
      'package-access-locked': 'Package access locked',
      'live-session-exists': 'A live walk already exists',
      'switch-no-live-session': 'No live walk anymore — start again',
      'run#package-not-downloaded': 'Package not downloaded',
      'run#package-ambiguous': 'Several package versions on disk',
      'run#unsafe-route-id': 'Invalid route id',
      'run#locale-missing': 'Package locale missing',
      'run#package-read-failed': 'Package unreadable',
      'run#recovery-failed': 'Live session read failed',
      fallback: 'Failure',
    },
    poiKind: {
      sight: 'Sight',
    },
  },
};

export function runMapStrings(locale: string): RunMapStrings {
  return locale === 'en' ? STRINGS.en : STRINGS.be;
}
