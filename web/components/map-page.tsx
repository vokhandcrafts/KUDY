// G10.01.b step 3: the static city map page — markers of the published routes
// and their stops, a manual overview only: no position, no «nearby», no
// personalization. The ODbL attribution is a legal obligation (09 §6.3.1), so
// it renders server-side here — visible and clickable without JavaScript — in
// addition to MapLibre's own attribution control; the URL comes from the
// single map config. The route list repeats the catalog order and links to
// the free guide pages.
import { localePath } from '../lib/content/site.ts';
import type { MapPageData } from '../lib/content/site.ts';
import { mapProvider } from '../lib/map-config.ts';
import type { UiLocale, UiStrings } from '../lib/i18n/index.ts';
import { CityMap } from './city-map.tsx';
import { SiteShell } from './site-shell.tsx';

export function MapPage({ locale, data, strings }: {
  locale: UiLocale;
  data: MapPageData;
  strings: UiStrings;
}) {
  const langSwitchHref = localePath(locale === 'be' ? 'en' : 'be', '/map');
  return (
    <SiteShell homeHref={localePath(locale, '/')} langSwitchHref={langSwitchHref} strings={strings}>
      <h1>{strings.mapTitle}</h1>
      <p>{strings.mapIntro}</p>
      <CityMap markers={data.markers} label={strings.mapTitle} />
      <p>
        <a href={mapProvider.osmCopyrightUrl}>{strings.mapAttribution}</a>
      </p>
      <h2>{strings.mapRoutesHeading}</h2>
      <ul>
        {data.routes.map((route) => (
          <li key={route.route_id}>
            <a href={route.href}>{route.title}</a> · {strings.stops}: {route.stops.length}
          </li>
        ))}
      </ul>
    </SiteShell>
  );
}
