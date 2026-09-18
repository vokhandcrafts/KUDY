// Shared chrome: brand → home, explicit language switch (09 §8 — no automatic
// substitution of close languages; the visitor picks). MyKUDY is excluded on
// the web: the calm block at the end of the page replaces it (plan §2).
import type { ReactNode } from 'react';
import type { UiStrings } from '../lib/i18n/index.ts';

export function SiteShell({ homeHref, langSwitchHref, strings, children }: {
  homeHref: string;
  langSwitchHref: string;
  strings: UiStrings;
  children: ReactNode;
}) {
  return (
    <>
      <header>
        <a href={homeHref}>{strings.brand}</a>
        {' · '}
        <a href={langSwitchHref}>{strings.langSwitchName}</a>
      </header>
      <main>{children}</main>
    </>
  );
}
