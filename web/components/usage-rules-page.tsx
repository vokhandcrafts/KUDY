import type { UiLocale, UiStrings } from '../lib/i18n/index.ts';
import { SiteShell } from './site-shell.tsx';

export function UsageRulesPage({ locale, strings }: { locale: UiLocale; strings: UiStrings }) {
  return (
    <SiteShell locale={locale} currentPath="/usage-rules" strings={strings}>
      <h1>{strings.usageRulesTitle}</h1>
      <p>{strings.usageRulesIntro}</p>
      <p>{strings.usageRulesReuse}</p>
    </SiteShell>
  );
}
