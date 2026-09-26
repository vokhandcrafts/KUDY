// UI strings for the web channel. The string files exist for be and en from
// the first page (09 §8: «ніводнага зашытага радка нідзе»); content locales
// beyond the UI locales (uk) render their text without their own UI yet.
// The typed UiStrings interface plus the parity test keep both files at the
// same key set at all times.
import { be } from './be.ts';
import { en } from './en.ts';

export type UiLocale = 'be' | 'en';

// The UI locales of the web channel (plan §4): be is the default at the root,
// en is the prefixed fallback — the one list the QR builder and the language
// switch derive from.
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
}

const STRINGS: Record<UiLocale, UiStrings> = { be, en };

export function getUiStrings(locale: UiLocale): UiStrings {
  return STRINGS[locale];
}
