// UI strings for the web channel. The string files exist for be and en from
// the first page (09 §8: «ніводнага зашытага радка нідзе»); content locales
// beyond the UI locales (uk) render their text without their own UI yet.
// The typed UiStrings interface plus the parity test keep both files at the
// same key set at all times.
import { be } from './be.ts';
import { en } from './en.ts';

export type UiLocale = 'be' | 'en';

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
}

const STRINGS: Record<UiLocale, UiStrings> = { be, en };

export function getUiStrings(locale: UiLocale): UiStrings {
  return STRINGS[locale];
}
