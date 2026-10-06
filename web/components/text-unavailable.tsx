// G21.22 (issue #554, criterion 3): the localized state a direct link to an
// unavailable language renders — a guide (or stop) whose text is not
// published in the URL locale shows this page instead of substituted content.
// It is a defined published state, not an error: the language facts of the
// guide stay visible in the catalog, the switch keeps the visitor on the same
// path (a locale with published text opens the real content), and the route
// pages exclude the state from sitemap/hreflang and mark it noindex, so an
// untranslated guide variant is never advertised.
import { localePath } from '../lib/content/site.ts';
import type { UiLocale, UiStrings } from '../lib/i18n/index.ts';
import { SiteShell } from './site-shell.tsx';

export function TextUnavailablePage({ locale, currentPath, strings }: {
  locale: UiLocale;
  currentPath: string;
  strings: UiStrings;
}) {
  return (
    <SiteShell locale={locale} currentPath={currentPath} strings={strings}>
      <h1>{strings.textUnavailableTitle}</h1>
      <p>{strings.textUnavailableBody}</p>
      <p>
        <a href={localePath(locale, '/')}>{strings.homeLink}</a>
      </p>
    </SiteShell>
  );
}
