// G10.01.c: the stop page — place name, the story transcript server-rendered
// in the page locale (M3: the text is indexable), the manual player, and
// prev/next by RouteStop.position as display order only. A locked stop
// renders the public preview and the calm offer block: no audio element and
// no transcript exist for it at the data layer. One calm offer per page, at
// the bottom (01).
import { localePath } from '../lib/content/site.ts';
import type { StopPageData } from '../lib/content/site.ts';
import type { UiLocale, UiStrings } from '../lib/i18n/index.ts';
import { CalmOffer } from './calm-offer.tsx';
import { ManualAudioPlayer } from './manual-audio-player.tsx';
import { SiteShell } from './site-shell.tsx';

export function StopPage({ locale, data, strings }: {
  locale: UiLocale;
  data: StopPageData;
  strings: UiStrings;
}) {
  const langSwitchHref = localePath(locale === 'be' ? 'en' : 'be', `/guides/${data.route_id}/stops/${data.stop_id}`);
  return (
    <SiteShell homeHref={localePath(locale, '/')} langSwitchHref={langSwitchHref} strings={strings}>
      <h1>{data.name}</h1>
      <nav>
        <p>
          <a href={data.guide_href}>{strings.backToGuide}</a>
          {data.prev ? (
            <>
              {' · '}
              <a href={data.prev.href}>
                {'← '}
                {strings.prevStop}
                {': '}
                {data.prev.name}
              </a>
            </>
          ) : null}
          {data.next ? (
            <>
              {' · '}
              <a href={data.next.href}>
                {strings.nextStop}
                {': '}
                {data.next.name}
                {' →'}
              </a>
            </>
          ) : null}
        </p>
      </nav>
      {data.locked ? (
        <>
          <p>
            <span role="img" aria-label={strings.lockedLabel}>
              🔒
            </span>{' '}
            {data.announce}
          </p>
        </>
      ) : (
        <>
          <ManualAudioPlayer audio={data.audio} strings={strings} />
          <h2>{strings.storyTextHeading}</h2>
          {data.transcript
            .split(/\n{2,}/)
            .map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
        </>
      )}
      <CalmOffer strings={strings} />
    </SiteShell>
  );
}
