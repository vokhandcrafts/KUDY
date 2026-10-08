import { localePath } from '../lib/content/site.ts';
import type { AttributionData } from '../lib/content/attribution.ts';
import type { UiLocale, UiStrings } from '../lib/i18n/index.ts';

export function ContentAttribution({ locale, strings, attribution }: {
  locale: UiLocale;
  strings: UiStrings;
  attribution: AttributionData;
}) {
  return (
    <section data-content-attribution="true" aria-label={strings.attributionHeading}>
      <h2>{strings.attributionHeading}</h2>
      {attribution.sources.length > 0 || attribution.media.length > 0 ? (
        <ul>
          {attribution.sources.map((source) => <li key={`source:${source}`}>{source}</li>)}
          {attribution.media.map((item) => (
            <li key={`media:${item.credit}`}>
              {item.authorPhoto ? `${strings.authorPhoto}: ` : null}{item.credit}
            </li>
          ))}
        </ul>
      ) : null}
      <a href={localePath(locale, '/usage-rules')}>{strings.usageRulesTitle}</a>
    </section>
  );
}
