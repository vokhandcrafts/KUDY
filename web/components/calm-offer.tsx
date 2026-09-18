// The single calm offer block (01 «Дзе відаць цана»): one per page, at the
// bottom, no popups or banners, no price. Every href resolves through
// lib/app-links.ts; a missing store URL renders the «хутка» state, never a
// broken or fabricated link (plan §3.2). G10.01.c reuses this block.
import { appLinks } from '../lib/app-links.ts';
import type { UiStrings } from '../lib/i18n/index.ts';

export function CalmOffer({ strings }: { strings: UiStrings }) {
  const stores = [
    { name: strings.appStoreName, url: appLinks.appStoreUrl },
    { name: strings.playStoreName, url: appLinks.playStoreUrl },
  ];
  return (
    <aside>
      <p>{strings.calmOfferText}</p>
      <p>
        <a href={appLinks.fallbackPath}>{strings.calmOfferCta}</a>
        {stores.map((store) => (
          <span key={store.name}>
            {' · '}
            {store.url ? (
              <a href={store.url}>{store.name}</a>
            ) : (
              <>
                {store.name} — {strings.storeComingSoon}
              </>
            )}
          </span>
        ))}
      </p>
    </aside>
  );
}
