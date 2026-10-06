// UI strings for the web channel. The string files are generated projections
// of contracts/ui-messages/source.json (tools/i18n/generate-messages.mjs,
// G21.25): be and en from the first page (09 §8: «ніводнага зашытага радка
// нідзе»), uk beside them (G14.04.d, issue #305), de/es/fr/cs/sv
// (G21.10–G21.14, issues #544–#548). The typed UiStrings interface plus the
// parity test keep the files at the same key set at all times.
import { be } from './be.ts';
import { en } from './en.ts';
import { uk } from './uk.ts';
import { de } from './de.ts';
import { es } from './es.ts';
import { fr } from './fr.ts';
import { cs } from './cs.ts';
import { sv } from './sv.ts';
import {
  isUiLocaleCode,
  uiLocaleNativeName,
  type CompleteUiLocaleCode,
} from '../../../contracts/ui-locales.ts';

// G21.22: the language switch renders every UI locale's self-name straight
// from the one registry (G21.09: a language is never named through a
// translation) — the web channel re-exports the registry call instead of
// copying the words.
export { uiLocaleNativeName };

// The web UI locales with live routes (G21.22, issue #554): all eight
// registered codes — the release no longer waits for narration or translated
// guides. The former uk-first-guide release coupling (uk-release-scope §6.3)
// is overridden by the approved G21.00 decision (specification
// 2026-10-03-completion-and-locales: «Выпуск інтэрфейсу цяпер не чакае
// запісу голасу»); a locale without published guide
// text renders the localized empty/unavailable states instead of content
// fallback. be is the default at the root, every other locale is a URL
// prefix — the one list the QR builder, the language switch and the route
// tree derive from.
export type UiLocale = 'be' | 'en' | 'uk' | 'de' | 'es' | 'fr' | 'cs' | 'sv';

export const uiLocales: UiLocale[] = ['be', 'en', 'uk', 'de', 'es', 'fr', 'cs', 'sv'];

// The locale the URLs without a prefix serve (plan §4): the single default
// mapping point behind localePath and the exported document language
// (G21.01) — the shared 404.html serves unknown URLs of both locales and
// carries this default.
export const defaultUiLocale: UiLocale = 'be';

// The URL prefixes of the non-default locales, in registry order — the
// exported document language scan and the route tree read the same fact.
export const prefixedUiLocales: readonly UiLocale[] = uiLocales.filter((locale) => locale !== defaultUiLocale);

// The [locale] tree's gate (G21.22): only the non-default registered codes
// are prerendered under a URL prefix; be lives at the root, unregistered
// codes never render. The layout answers the boolean, the pages share the
// typed assertion.
export function isPrefixedUiLocale(value: string): value is UiLocale {
  return (prefixedUiLocales as readonly string[]).includes(value);
}

export function toUiLocale(value: string): UiLocale {
  if (!isUiLocaleCode(value)) {
    throw new Error(`ui-locale-unregistered: ${value}`);
  }
  return value;
}

// G21.09 (issue #542, criterion 4): the advertised picker codes must be a
// subset of the registered complete UI catalogues (contracts/ui-locales.ts) —
// the assignment below fails the build if uiLocales ever advertises a code
// without a complete catalogue. Since G21.22 the web route set equals the
// complete set; the guard stays so a future registry change cannot ship a
// half-translated route silently.
const advertisedComplete: readonly CompleteUiLocaleCode[] = uiLocales;
void advertisedComplete;

export interface UiStrings {
  brand: string;
  catalogTitle: string;
  catalogEmpty: string;
  languages: string;
  duration: string;
  distance: string;
  stops: string;
  audioAndText: string;
  textOnly: string;
  stopListHeading: string;
  lockedLabel: string;
  calmOfferText: string;
  calmOfferCta: string;
  storeComingSoon: string;
  appStoreName: string;
  playStoreName: string;
  minutesShort: string;
  kilometersShort: string;
  mapTitle: string;
  mapIntro: string;
  mapRoutesHeading: string;
  mapAttribution: string;
  mapError: string;
  storyTextHeading: string;
  audioHeading: string;
  audioUnavailable: string;
  prevStop: string;
  nextStop: string;
  backToGuide: string;
  versionUnavailable: string;
  homeLink: string;
  appPageTitle: string;
  appBenefitGps: string;
  appBenefitOffline: string;
  appBenefitFullRoutes: string;
  appPageStores: string;
  privacyTitle: string;
  privacyIntro: string;
  privacyWeb: string;
  privacyAppData: string;
  privacyLocation: string;
  privacyAnalytics: string;
  privacyRetention: string;
  privacyDeletion: string;
  privacyPurchases: string;
  privacyContact: string;
  textUnavailableTitle: string;
  textUnavailableBody: string;
}

const STRINGS: Record<UiLocale, UiStrings> = { be, en, uk, de, es, fr, cs, sv };

export function getUiStrings(locale: UiLocale): UiStrings {
  return STRINGS[locale];
}
