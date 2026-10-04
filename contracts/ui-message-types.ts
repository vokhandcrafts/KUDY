// G21.09 (issue #542, criterion 2) — the reusable native message interfaces,
// moved to the shared pure contract zone. The key/parameter contract is the
// TS projection of the G21.24 canonical records
// (contracts/ui-messages/source.json): every key here is anchored to exactly
// one record by the inventory guard (test/ui-messages-inventory.test.mjs) and
// the runtime shape/arity of every record-anchored value is guarded against
// these catalogs by test/ui-message-types.test.mjs — the interfaces and the
// canonical records cannot silently drift apart. This file declares shapes
// only (no runtime code, relative imports only — the contracts zone rule);
// authoring stays in the canonical source/translation data, never here.
//
// Deliberately NOT moved here: RunMapStrings (bound to the engine's StopStatus
// in core/engine/state.ts — the pure contract zone must not import core) and
// PreviewStrings (bound to the controller-owned PreviewReason/PreviewDetail
// vocabulary). Their records are still guarded through the same runtime walk.

import type { CompleteUiLocaleCode } from "./ui-locales.ts";

// G06.05 (issue #280) — the shared UI words of the G06 surfaces, BE/EN per
// the row's first criterion. G14.04.d (issue #305) adds the third catalog:
// uk rides the same mechanism beside be/en (uk-release-scope §3.1 — "тая ж
// сістэма, новы набор"), with the catalog keys kept equivalent by the
// parity guard. The catalogs here are presentation-only chrome
// (back labels, loading, the catalog state words, the KUDY surface sections,
// the preview facts line); domain words with diagnostics stay with their
// controllers (runMapStrings, placeDetailStrings, previewStrings). The
// locale argument is the composition root's display locale — the first
// preference of createServices, switchable through its ui-locale store
// (the L02 selection this row deferred to G14.04.d); an unknown locale
// falls back to Belarusian, the app's first preference (the runMapStrings
// idiom).
export type AccessKind = "free" | "paid" | "mixed";

export interface UiStrings {
  readonly back: string;
  readonly backToCity: string;
  // The unknown deep link's words (issue #427): the honest message and the
  // hint that names where the catalog is — the screen never renders dev text.
  readonly notFoundTitle: string;
  readonly notFoundHint: string;
  readonly loading: string;
  readonly walk: string;
  readonly nearby: string;
  readonly guidesLink: string;
  // The KUDY surface's Explore entry (issue #426): the owner's 2026-10-01
  // decision — the history surface is named «KUDY», not «My KUDY».
  readonly kudyLink: string;
  readonly retry: string;
  readonly catalogUnavailable: string;
  readonly catalogTemporarilyUnavailable: string;
  readonly notPublished: string;
  readonly validCache: string;
  readonly previewUnavailable: string;
  readonly degradedData: string;
  readonly myKudy: string;
  readonly historyUnavailable: string;
  readonly currentWalk: string;
  readonly noCurrentWalk: string;
  readonly pastWalks: string;
  readonly noPastWalks: string;
  readonly stateLabel: Record<"active" | "paused" | "finished", string>;
  readonly heardCount: (count: number) => string;
  // The My KUDY row lines (G06.05, AC1): the state word, the local days and
  // the heard count stay one sentence per locale — no hard-coded preposition.
  readonly liveRowLine: (state: string, day: string, heard: number) => string;
  readonly pastRowLine: (startedDay: string, finishedDay: string | null, heard: number) => string;
  readonly access: Record<AccessKind, string>;
  readonly languagesLine: (textLocales: readonly string[]) => string;
  readonly textAudioLine: (textLocales: readonly string[], audioLocales: readonly string[]) => string;
  readonly stopsCount: (count: number) => string;
  readonly sizeMb: (mb: number) => string;
  readonly freeStopsCount: (count: number) => string;
  readonly stopNumber: (position: number) => string;
  // The metadata-row icon words (G06.10.c, issue #403): the standalone
  // screen-reader label the icon contract requires — the fact line next to
  // the icon carries the value.
  readonly durationLabel: string;
  readonly stopsLabel: string;
  // The locked stop's badge word — the 🔒 never reads alone (AC1: the
  // screen-reader label is a word, the glyph is decoration).
  readonly locked: string;
  readonly durationRange: (minMinutes: number, maxMinutes: number) => string;
  readonly durationMinutes: (minutes: number) => string;
  readonly switchConfirm: (liveTitle: string, candidateTitle: string) => string;
  readonly switchAccept: string;
  readonly cancel: string;
  // G15.03 (issue #70) — the discovery surfaces' chrome words (BE/EN): the
  // Explore entry, the honest states and the labeled facts of the offer
  // cards. The maps' fallback in the screens is the raw contract value — an
  // unknown reason, difference or season renders verbatim, never dropped.
  readonly whatToDo: string;
  readonly discoveryTitle: string;
  readonly discoveryUnavailable: string;
  readonly discoveryTemporarilyUnavailable: string;
  readonly discoveryEmpty: string;
  readonly discoveryAlternatives: string;
  readonly collectionUnavailable: string;
  readonly collectionUnresolved: string;
  readonly timeUnlimited: string;
  readonly timeCap: (minutes: number) => string;
  readonly seasonName: Record<string, string>;
  readonly reasonText: Record<string, string>;
  readonly differenceText: Record<string, string>;
  // G14.04.d (issue #305) — the My KUDY language row (uk-release-scope §4:
  // «Мова прапануецца ў My KUDY»): the row's label and the options' self
  // names, which are the same native words in every catalog — a language is
  // never named through a translation.
  readonly languageLabel: string;
  // The keys are the complete UI locales (contracts/ui-locales.ts): the codes
  // with full catalogues — the picker advertises no others.
  readonly languageSelfNames: Record<CompleteUiLocaleCode, string>;
}

// G06.05 (issue #280, AC4/AC5) — the place detail words. The named moment
// refusals and the play failure's words — a refusal states the reason and the
// way out, a raw diagnostic code never shows alone. An unknown reason renders
// as-is (the placeRefusalText idiom).
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

// The nearby surface's words (the runMapStrings idiom): the honest location
// notes, the offer list states and the labeled card facts.
export interface NearbyStrings {
  readonly title: string;
  readonly proximityHeader: string;
  readonly reviewHeader: string;
  readonly noteDenied: string;
  readonly noteHeldByWalk: string;
  readonly noteAcquiring: string;
  readonly noteUnstable: string;
  readonly empty: string;
  readonly unavailable: string;
  readonly loading: string;
  readonly indexDegraded: string;
  readonly mapNote: string;
  readonly cardHint: string;
  // UX 09 (issue #434) — the offer-kind word the card marker carries for the
  // screen reader (visual-language.md §9: every icon rendering is named).
  readonly guideLabel: string;
  readonly placeLabel: string;
  readonly textLabel: string;
  readonly audioLabel: string;
  readonly durationUnit: string;
}

// The commerce offer card's words (11 §8): the offer, its dismissal, the
// honest post-store state and the failure way out.
export interface OfferStrings {
  readonly offerTitle: string;
  readonly offerBody: string;
  readonly buy: string;
  readonly dismiss: string;
  // `11` §8 verbatim: «Куплена · трэба загрузіць» — the honest state after
  // the store leg, before the verified access.
  readonly purchasedPending: string;
  readonly errorTitle: string;
  readonly errorBody: string;
  readonly tryAgain: string;
  readonly continueFree: string;
}

// UX 09 (issue #434) — the nearby-guide hint card (GuideHintCard.tsx). The
// card's four words: uk renders through the be fallback until the uk
// catalogue of this domain lands with the translation data (G21.25) — the
// interface keeps the domain typed meanwhile.
export interface GuideHintStrings {
  readonly heading: string;
  readonly paid: string;
  readonly openHint: string;
  readonly dismiss: string;
}
