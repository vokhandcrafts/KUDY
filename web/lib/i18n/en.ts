// English UI strings — the fallback locale (09 §8: fallback_locale = en; the
// visitor picks explicitly, nothing is substituted automatically).
import type { UiStrings } from './index.ts';

export const en: UiStrings = {
  brand: 'KUDY',
  langSwitchName: 'Беларуская',
  catalogTitle: 'City guides',
  languages: 'Languages',
  duration: 'Duration',
  distance: 'Distance',
  stops: 'Stops',
  audioAndText: 'audio and text',
  textOnly: 'text only',
  stopListHeading: 'Route stops',
  lockedLabel: 'locked stop',
  calmOfferText: 'The full version — in the app: GPS autoplay, offline, complete routes.',
  calmOfferCta: 'Open the app',
  storeComingSoon: 'Coming soon',
  appStoreName: 'App Store',
  playStoreName: 'Google Play',
  minutesShort: 'min',
  kilometersShort: 'km',
  mapTitle: 'City map',
  mapIntro: 'An overview of the published routes and stops. The visitor’s position is never detected or used.',
  mapRoutesHeading: 'Routes on the map',
  mapAttribution: 'Map data © OpenStreetMap contributors (ODbL licence)',
  storyTextHeading: 'Story text',
  audioHeading: 'Audio',
  audioUnavailable: 'The audio file is not in the published bundle; the story text below still reads as usual.',
  prevStop: 'Previous stop',
  nextStop: 'Next stop',
  backToGuide: 'Back to the guide page',
  versionUnavailable: 'Version unavailable',
  homeLink: 'Home',
  appPageTitle: 'The full version — in the KUDY app',
  appBenefitGps: 'GPS autoplay of the stories on site',
  appBenefitOffline: 'Offline: the routes at hand without internet',
  appBenefitFullRoutes: 'Complete routes: every stop and all audio',
  appPageStores: 'Find the app:',
  privacyTitle: 'Privacy',
  privacyIntro:
    'KUDY — audio guides for city walks. This page describes which data the project processes: the free web channel and the mobile app.',
  privacyWeb:
    'The free web channel collects no accounts: there is no registration or sign-in, and contact details are never asked for. The catalog, guide and map pages open without entering personal data.',
  privacyAppData:
    'The app works without an account. It keeps an on-device local event log (which stories were opened, which routes were downloaded) and stores content downloads. The log contains no names and no free-form text and is tied to a random device identifier — this is pseudonymised, not anonymous, data.',
  privacyLocation:
    'Location is used only in the app and only during an active walk: background location works while the walk is on and stops with it. Coordinates never leave the device — they are not sent to the server and do not enter the event log. On the web channel the visitor’s position is never detected at all.',
  privacyAnalytics:
    'Analytics only with explicit consent. Events reach the server no earlier than consent is given; refusal means the log stays on the device only, and the app works in full. Coordinates, names and user-entered text are never sent.',
  privacyRetention:
    'Retention: raw sent events are kept for 14 months, then deleted by a scheduled job; aggregated counts per route remain without the device identifier.',
  privacyDeletion:
    'Data deletion: in the app, the My KUDY section has a device-deletion button — it clears the event log on the server and the device record; content downloads stay. No email or request needs to be sent.',
  privacyPurchases:
    'Purchases go through the app stores (App Store, Google Play): payment data is handled by the store, and the app records only the purchase event fact — route, tier, outcome — with no banking details.',
  privacyContact: 'Questions about this privacy policy can be asked in the issues of the project’s public repository:',
};
