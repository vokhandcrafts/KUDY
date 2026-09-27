// The public privacy policy (issue #331): one permanent page per UI locale,
// the text matching the real data model of the project — 09 §10 for the event
// log, the G09.02 (#286) consent contract, the G09.03 (#288) deletion and
// retention contract. The contact link resolves through lib/app-links.ts —
// the single external-URL config; the store Privacy Policy fields take the
// page's URL from the G11.04 (#299) checklist.
import { appLinks } from '../lib/app-links.ts';
import { localePath } from '../lib/content/site.ts';
import type { UiLocale, UiStrings } from '../lib/i18n/index.ts';
import { SiteShell } from './site-shell.tsx';

export function PrivacyPage({ locale, strings }: { locale: UiLocale; strings: UiStrings }) {
  const langSwitchHref = localePath(locale === 'be' ? 'en' : 'be', '/privacy');
  return (
    <SiteShell homeHref={localePath(locale, '/')} langSwitchHref={langSwitchHref} strings={strings}>
      <h1>{strings.privacyTitle}</h1>
      <p>{strings.privacyIntro}</p>
      <p>{strings.privacyWeb}</p>
      <p>{strings.privacyAppData}</p>
      <p>{strings.privacyLocation}</p>
      <p>{strings.privacyAnalytics}</p>
      <p>{strings.privacyRetention}</p>
      <p>{strings.privacyDeletion}</p>
      <p>{strings.privacyPurchases}</p>
      <p>
        {strings.privacyContact} <a href={appLinks.supportIssuesUrl}>{appLinks.supportIssuesUrl}</a>
      </p>
    </SiteShell>
  );
}
