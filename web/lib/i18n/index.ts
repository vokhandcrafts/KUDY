// UI strings for the web channel. The string files exist for be and en from
// the first page (09 §8: «ніводнага зашытага радка нідзе»); G14.04.d
// (issue #305) adds the third file, uk, beside them (uk-release-scope §3.1 —
// the same system, a new set); G21.10 (issue #544) adds de the same way;
// G21.12 (issue #546) adds fr the same way. The typed UiStrings interface
// plus the parity test keep the files at the same key set at all times.
import { be } from './be.ts';
import { en } from './en.ts';
import { uk } from './uk.ts';
import { de } from './de.ts';
import { fr } from './fr.ts';
import type { CompleteUiLocaleCode } from '../../../contracts/ui-locales.ts';

// The live web UI locales (plan §4): be is the default at the root, en is the
// prefixed fallback — the one list the QR builder and the language switch
// derive from.
export type UiLocale = 'be' | 'en';

// G14.04.d — the strings-locale union: uk has its strings file and renders
// through getUiStrings, but stays off the live routes/switch until the uk UI
// release ships together with the first translated guide — one release unit
// (uk-release-scope §6.3). de owns its strings file (G21.10, issue #544) and
// joins the routes with G21.22, the same release-unit rule; fr joins the same
// way (G21.12, issue #546).
export type UiStringsLocale = UiLocale | 'uk' | 'de' | 'fr';

// The UI locales of the web channel with live routes (plan §4) — uk joins
// here with the release unit, never before it.
export const uiLocales: UiLocale[] = ['be', 'en'];
// G21.09 (issue #542, criterion 4): the advertised picker codes are a subset
// of the registered complete UI catalogues (contracts/ui-locales.ts) — the
// assignment below fails the build if uiLocales ever advertises a code
// without a complete catalogue. uk owns a complete strings file but stays
// off the live routes until its release unit (uk-release-scope §6.3) — a
// subset, not equality.
const advertisedComplete: readonly CompleteUiLocaleCode[] = uiLocales;
void advertisedComplete;

// The locale the URLs without a prefix serve (plan §4): the single default
// mapping point behind localePath and the exported document language
// (G21.01) — the shared 404.html serves unknown URLs of both locales and
// carries this default.
export const defaultUiLocale: UiLocale = 'be';

export interface UiStrings {
  brand: string;
  langSwitchName: string;
  catalogTitle: string;
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
}

const STRINGS: Record<UiStringsLocale, UiStrings> = { be, en, uk, de, fr };

export function getUiStrings(locale: UiStringsLocale): UiStrings {
  return STRINGS[locale];
}
