// UI strings for the web channel. The string files exist for be and en from
// the first page (09 §8: «ніводнага зашытага радка нідзе»); G14.04.d
// (issue #305) adds the third file, uk, beside them (uk-release-scope §3.1 —
// the same system, a new set). The typed UiStrings interface plus the parity
// test keep all three files at the same key set at all times.
import { be } from './be.ts';
import { en } from './en.ts';
import { uk } from './uk.ts';

// The live web UI locales (plan §4): be is the default at the root, en is the
// prefixed fallback — the one list the QR builder and the language switch
// derive from.
export type UiLocale = 'be' | 'en';

// G14.04.d — the strings-locale union: uk has its strings file and renders
// through getUiStrings, but stays off the live routes/switch until the uk UI
// release ships together with the first translated guide — one release unit
// (uk-release-scope §6.3).
export type UiStringsLocale = UiLocale | 'uk';

// The UI locales of the web channel with live routes (plan §4) — uk joins
// here with the release unit, never before it.
export const uiLocales: UiLocale[] = ['be', 'en'];

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

const STRINGS: Record<UiStringsLocale, UiStrings> = { be, en, uk };

export function getUiStrings(locale: UiStringsLocale): UiStrings {
  return STRINGS[locale];
}
