// The locked stop row (01: «Кропкі пад замком бачныя да пакупкі»): the padlock
// plus name and announce from previews.json — never a truncated paid text and
// never a per-row CTA; the calm offer block owns the app transition. The row
// links to the stop page (G10.01.c), which renders the same public preview
// plus the calm offer — navigation, not a purchase path.
import type { StopRow } from '../lib/content/site.ts';
import type { UiStrings } from '../lib/i18n/index.ts';

export function LockedStopRow({ stop, strings }: { stop: StopRow; strings: UiStrings }) {
  return (
    <li>
      <a href={stop.href}>
        <span role="img" aria-label={strings.lockedLabel}>
          🔒
        </span>{' '}
        <strong>{stop.name}</strong>
      </a>
      <p>{stop.announce}</p>
    </li>
  );
}
