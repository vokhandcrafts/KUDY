// G07.02 (issue #282) — the place detail controller (Journey 3: «месца або
// Moment → прэв'ю»): the place offer's facts from the already-validated
// catalog projection (one reader policy — no second place_public fetch path)
// plus the place's moment teasers read from the downloaded packages' root
// manifests. The play/ownership decisions live in the moment controller
// (ADR G01.02); this surface only offers them — a card tap starts no audio
// (R04), the teaser sounds only through its explicit Play.
// One binding per open (the Nearby surface's pattern): the boot load IS the
// refresh-at-every-open policy (09 §4); the store dies with the surface. The
// screen subscribes through the shared useStoreState hook (G07.01) — no
// sibling copies.
import type { CatalogService, NearbyOfferFacts } from '../../services/catalog/types.ts';
import type { MomentFact, MomentFacts } from '../../services/contentRepo/momentFacts.ts';
import { createControllerStore, type ControllerStore } from '../createControllerStore.ts';

// The view types the screens render — re-exported here so the UI layer keeps
// importing its view types from the controllers (the nearby controller's
// re-export idiom).
export type { MomentFact };

export interface PlaceDetailDeps {
  readonly service: Pick<CatalogService, 'loadNearby'>;
  // The moment facts reader over the downloaded packages; absent without a
  // bundles store — the detail renders its facts without teasers.
  readonly moments?: () => Promise<MomentFacts>;
  readonly placeId: string;
}

export type PlaceDetailState =
  | { readonly kind: 'loading' }
  | {
      readonly kind: 'ready';
      readonly facts: NearbyOfferFacts | null;
      readonly moments: readonly MomentFact[];
      readonly degraded: 'index-unavailable' | null;
    }
  | { readonly kind: 'error'; readonly reason: string };

export interface PlaceDetailBinding {
  readonly store: ControllerStore<PlaceDetailState>;
  readonly placeId: string;
}

const NO_MOMENTS: MomentFacts = { ok: true, moments: [], diagnostics: [] };

export function createPlaceDetailController(deps: PlaceDetailDeps): PlaceDetailBinding {
  const store = createControllerStore<PlaceDetailState>(() => ({ kind: 'loading' }));
  void load(store, deps);
  return { store, placeId: deps.placeId };
}

async function load(store: ControllerStore<PlaceDetailState>, deps: PlaceDetailDeps): Promise<void> {
  try {
    const [nearby, moments] = await Promise.all([
      deps.service.loadNearby(null),
      deps.moments ? deps.moments() : Promise.resolve(NO_MOMENTS),
    ]);
    // The catalog state decides the facts line; the teasers are library
    // truth and render regardless of the catalog's fate.
    const facts =
      (nearby.kind === 'ready' || nearby.kind === 'offline')
        ? nearby.offers.find((offer) => offer.kind === 'place' && offer.place_id === deps.placeId) ?? null
        : null;
    store.setState({
      kind: 'ready',
      facts,
      moments: moments.ok ? moments.moments.filter((moment) => moment.placeId === deps.placeId) : [],
      degraded: nearby.kind === 'ready' ? nearby.degraded : null,
    });
  } catch {
    store.setState({ kind: 'error', reason: 'place#load-failed' });
  }
}

// The surface words (09 §0: BE first, EN beside — the nearbyStrings idiom).
export interface PlaceDetailStrings {
  readonly loading: string;
  readonly unavailable: string;
  readonly error: string;
  readonly noFacts: string;
  readonly empty: string;
  teaserLabel: string;
  playLabel: string;
  stopLabel: string;
  resumeLabel: string;
  nowPlaying: string;
  paused: string;
  guideLink: string;
  guideLinkHint: string;
  playHint: string;
  noAudio: string;
  durationUnit: string;
  textLabel: string;
  audioLabel: string;
  // G06.05 (issue #280, AC4/AC5): the named moment refusals and the play
  // failure's words — a refusal states the reason and the way out, a raw
  // diagnostic code never shows alone. An unknown reason renders as-is.
  readonly refusalText: Record<
    'moment#audio-unpublished' | 'moment#session-unroutable' | 'moment#session-refused',
    string
  >;
  readonly playFailed: string;
  readonly playFailedHint: string;
}

// The refusal's rendered word: the known map, else the raw reason itself
// (the runMapReason idiom).
export function placeRefusalText(refusal: string, strings: PlaceDetailStrings): string {
  return strings.refusalText[refusal as keyof PlaceDetailStrings['refusalText']] ?? refusal;
}

const STRINGS: Record<'be' | 'en', PlaceDetailStrings> = {
  be: {
    loading: 'Загрузка…',
    unavailable: 'Дэталь месца недаступная',
    error: 'Не ўдалося адкрыць месца',
    noFacts: 'Месца пакуль не апублікавана ў каталога',
    empty: 'Тэйзераў для гэтага месца няма',
    teaserLabel: 'Тэйзер',
    playLabel: 'Паслухаць тэйзер',
    stopLabel: 'Спыніць',
    resumeLabel: 'Працягнуць',
    nowPlaying: 'Зараз грае',
    paused: 'Паўза',
    guideLink: "Прэв'ю гіда",
    guideLinkHint: "Адкрывае прэв'ю гіда, не запуск прагулкі.",
    playHint: 'Яўны Play тэйзера праз адзіны плэер.',
    noAudio: 'Аўдыё тэйзера не апублікавана',
    durationUnit: 'хв',
    textLabel: 'Тэкст',
    audioLabel: 'аўдыё',
    refusalText: {
      'moment#audio-unpublished': 'Гук тэйзера не апублікаваны',
      'moment#session-unroutable': 'Тэйзер не гучыць у прагулцы — запусціце яго тут яшчэ раз',
      'moment#session-refused': 'Тэйзер зараз не запускаецца — паспрабуйце яшчэ раз',
    },
    playFailed: 'Гук не пачаўся',
    playFailedHint: 'Паспрабуйце запусціць яшчэ раз',
  },
  en: {
    loading: 'Loading…',
    unavailable: 'The place detail is unavailable',
    error: 'Could not open the place',
    noFacts: 'The place is not published in the catalog yet',
    empty: 'No teasers for this place',
    teaserLabel: 'Teaser',
    playLabel: 'Play the teaser',
    stopLabel: 'Stop',
    resumeLabel: 'Resume',
    nowPlaying: 'Now playing',
    paused: 'Paused',
    guideLink: 'Guide preview',
    guideLinkHint: "Opens the guide's preview, never a walk start.",
    playHint: 'Explicit teaser play through the single player.',
    noAudio: 'The teaser audio is not published',
    durationUnit: 'min',
    textLabel: 'Text',
    audioLabel: 'audio',
    refusalText: {
      'moment#audio-unpublished': 'The teaser audio is not published',
      'moment#session-unroutable': 'The teaser cannot sound inside a walk — play it here again',
      'moment#session-refused': 'The teaser cannot start right now — try again',
    },
    playFailed: 'The audio did not start',
    playFailedHint: 'Try starting it again',
  },
};

export function placeDetailStrings(locale: string): PlaceDetailStrings {
  return locale === 'en' ? STRINGS.en : STRINGS.be;
}
