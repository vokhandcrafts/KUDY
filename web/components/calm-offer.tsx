// The single calm offer block (01 «Дзе відаць цана»): one per page, at the
// bottom, no popups or banners, no price. The CTA href is the config's
// fallbackPath; store buttons render through StoreLinks (lib/app-links.ts is
// the single source). G10.01.c reuses this block.
import { appLinks } from '../lib/app-links.ts';
import type { UiStrings } from '../lib/i18n/index.ts';
import { StoreLinks } from './store-links.tsx';

export function CalmOffer({ strings }: { strings: UiStrings }) {
  return (
    <aside>
      <p>{strings.calmOfferText}</p>
      <p>
        <a href={appLinks.fallbackPath}>{strings.calmOfferCta}</a>
        <StoreLinks strings={strings} />
      </p>
    </aside>
  );
}
