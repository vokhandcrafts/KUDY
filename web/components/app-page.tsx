// G10.02.a step 2: the /app fallback page — 16 G10.02: «неўсталяваны дадатак
// не дае тупік». It explains what the app adds (the three benefits the calm
// offer names, 01) and renders the store buttons from lib/app-links.ts; with
// every store unpublished the page is still a complete answer: what exists
// today is the «хутка» state, not a dead end.
import type { UiLocale, UiStrings } from '../lib/i18n/index.ts';
import { SiteShell } from './site-shell.tsx';
import { StoreLinks } from './store-links.tsx';

export function AppPage({ locale, strings }: { locale: UiLocale; strings: UiStrings }) {
  return (
    <SiteShell locale={locale} currentPath="/app" strings={strings}>
      <h1>{strings.appPageTitle}</h1>
      <ul>
        <li>{strings.appBenefitGps}</li>
        <li>{strings.appBenefitOffline}</li>
        <li>{strings.appBenefitFullRoutes}</li>
      </ul>
      <p>{strings.appPageStores}</p>
      <StoreLinks strings={strings} />
    </SiteShell>
  );
}
