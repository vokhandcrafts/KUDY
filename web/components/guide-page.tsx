// G10.01.b step 2: the guide page — cover, languages/duration/distance/stop
// count from the bundle, the ordered stop list, locked stops as public
// previews only, and one calm offer at the bottom of the description (step 4).
// A preview of the walk, not a second product (shared invariants): no
// download, start or purchase flows exist here.
import { localePath } from '../lib/content/site.ts';
import type { GuidePageData } from '../lib/content/site.ts';
import type { UiLocale, UiStrings } from '../lib/i18n/index.ts';
import { CalmOffer } from './calm-offer.tsx';
import { LockedStopRow } from './locked-stop-row.tsx';
import { MetaRow } from './meta-row.tsx';
import { SiteShell } from './site-shell.tsx';

export function GuidePage({ locale, data, strings }: {
  locale: UiLocale;
  data: GuidePageData;
  strings: UiStrings;
}) {
  const langSwitchHref = localePath(locale === 'be' ? 'en' : 'be', `/guides/${data.route_id}`);
  return (
    <SiteShell homeHref={localePath(locale, '/')} langSwitchHref={langSwitchHref} strings={strings}>
      <h1>{data.title}</h1>
      {data.cover ? <img src={data.cover} alt={data.title} /> : null}
      <p>{data.summary}</p>
      <MetaRow
        durationMin={data.duration_min}
        distanceM={data.distance_m}
        stopCount={data.stop_count}
        languages={data.languages}
        strings={strings}
      />
      <h2>{strings.stopListHeading}</h2>
      <ol>
        {data.stops.map((stop) =>
          stop.locked ? (
            <LockedStopRow key={stop.stop_id} stop={stop} strings={strings} />
          ) : (
            <li key={stop.stop_id}>
              <strong>{stop.name}</strong>
            </li>
          ),
        )}
      </ol>
      <CalmOffer strings={strings} />
    </SiteShell>
  );
}
