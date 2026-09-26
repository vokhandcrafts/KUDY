// The one store-buttons renderer: a live store URL is a link, an unpublished
// one renders the explicit «хутка» state — never a broken or fabricated link
// (plan §3.2). Used by the calm offer and the /app page, so the two surfaces
// cannot drift apart.
import { appLinks, type StoreKind } from '../lib/app-links.ts';
import type { UiStrings } from '../lib/i18n/index.ts';

const STORES: { kind: StoreKind; nameKey: 'appStoreName' | 'playStoreName' }[] = [
  { kind: 'appStore', nameKey: 'appStoreName' },
  { kind: 'playStore', nameKey: 'playStoreName' },
];

export function StoreLinks({ strings }: { strings: UiStrings }) {
  return (
    <>
      {STORES.map((store) => {
        const url = appLinks[store.kind];
        return (
          <span key={store.kind}>
            {' · '}
            {url.kind === 'live' ? (
              <a href={url.href}>{strings[store.nameKey]}</a>
            ) : (
              <>
                {strings[store.nameKey]} — {strings.storeComingSoon}
              </>
            )}
          </span>
        );
      })}
    </>
  );
}
