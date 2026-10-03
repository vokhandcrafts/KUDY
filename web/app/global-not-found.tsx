// The global 404 of the static export: one file serves unknown URLs of both
// locales, so it carries the site default document language and renders both
// UI languages beside each other — never a partial render of unknown content
// (16 G10.01: «невядомая версія не рэндэрыцца небяспечна»). A
// global-not-found renders the full document itself — no root layout sits
// above it, which is why the lang is declared here and not in a layout
// (experimental.globalNotFound in next.config.ts).
import { defaultUiLocale, getUiStrings } from '../lib/i18n/index.ts';
import { localePath } from '../lib/content/site.ts';

export default function GlobalNotFound() {
  const be = getUiStrings('be');
  const en = getUiStrings('en');
  return (
    <html lang={defaultUiLocale}>
      <body>
        <main>
          <h1>{be.versionUnavailable}</h1>
          <p>{en.versionUnavailable}</p>
          <p>
            <a href={localePath('be', '/')}>{be.homeLink}</a>
          </p>
        </main>
      </body>
    </html>
  );
}
