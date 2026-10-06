// Shared chrome: brand → home, the explicit language switch (09 §8 — no
// automatic substitution of close languages; the visitor picks). G21.22
// (issue #554): the switch lists every UI locale's self-name straight from
// the locale registry (G21.09: a language is never named through a
// translation), keeps the visitor on the same page path in the chosen locale
// and marks the current one — a locale whose guide text is not published
// lands on the localized unavailable state, never on substituted content.
// MyKUDY is excluded on the web: the calm block at the end of the page
// replaces it (plan §2).
import type { ReactNode } from 'react';
import { localePath } from '../lib/content/site.ts';
import { uiLocaleNativeName, uiLocales, type UiLocale, type UiStrings } from '../lib/i18n/index.ts';

export function SiteShell({ locale, currentPath, strings, children }: {
  locale: UiLocale;
  currentPath: string;
  strings: UiStrings;
  children: ReactNode;
}) {
  return (
    <>
      <header>
        <a href={localePath(locale, '/')}>{strings.brand}</a>
        {uiLocales.map((code) => (
          <span key={code}>
            {' · '}
            {code === locale ? (
              <strong aria-current="page">{uiLocaleNativeName(code)}</strong>
            ) : (
              <a href={localePath(code, currentPath)}>{uiLocaleNativeName(code)}</a>
            )}
          </span>
        ))}
      </header>
      <main>{children}</main>
    </>
  );
}
