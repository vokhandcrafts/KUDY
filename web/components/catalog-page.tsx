// G10.01.b step 1: the city catalog — only real published entries from the
// catalog + discovery index («EXPLORE не імітуе каталог», 15 R08): with one
// fixture guide this renders that guide's card plus the map entry, no
// placeholder cards.
import { localePath } from '../lib/content/site.ts';
import type { CatalogPageData } from '../lib/content/site.ts';
import type { UiLocale, UiStrings } from '../lib/i18n/index.ts';
import { CalmOffer } from './calm-offer.tsx';
import { MetaRow } from './meta-row.tsx';
import { SiteShell } from './site-shell.tsx';

export function CatalogPage({ locale, data, strings }: {
  locale: UiLocale;
  data: CatalogPageData;
  strings: UiStrings;
}) {
  const langSwitchHref = localePath(locale === 'be' ? 'en' : 'be', '/');
  return (
    <SiteShell homeHref={localePath(locale, '/')} langSwitchHref={langSwitchHref} strings={strings}>
      <h1>{strings.catalogTitle}</h1>
      <ul>
        {data.cards.map((card) => (
          <li key={card.route_id}>
            <a href={card.href}>{card.title}</a>
            <p>{card.summary}</p>
            <MetaRow
              durationMin={card.duration_min}
              distanceM={card.distance_m}
              stopCount={card.stop_count}
              languages={card.languages}
              strings={strings}
            />
          </li>
        ))}
      </ul>
      <p>
        <a href={data.mapHref}>{strings.mapEntry}</a>
      </p>
      <CalmOffer strings={strings} />
    </SiteShell>
  );
}
