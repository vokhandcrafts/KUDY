// The safe state for unknown URLs (task step 4): a static page with the
// defined message and the path home — never a partial render of unknown
// content (16 G10.01: «невядомая версія не рэндэрыцца небяспечна»). The
// static export has a single 404 page, so both UI languages render on it.
import { localePath } from '../lib/content/site.ts';
import { getUiStrings } from '../lib/i18n/index.ts';

export default function NotFound() {
  const be = getUiStrings('be');
  const en = getUiStrings('en');
  return (
    <main>
      <h1>{be.versionUnavailable}</h1>
      <p>{en.versionUnavailable}</p>
      <p>
        <a href={localePath('be', '/')}>{be.homeLink}</a>
      </p>
    </main>
  );
}
