// The locked stop row (01: «Кропкі пад замком бачныя да пакупкі»): the padlock
// plus name and announce from previews.json — never a truncated paid text and
// never a per-row CTA; the calm offer block owns the app transition. G10.01.c
// reuses this row on the stop pages.
import type { StopRow } from '../lib/content/site.ts';
import type { UiStrings } from '../lib/i18n/index.ts';

export function LockedStopRow({ stop, strings }: { stop: StopRow; strings: UiStrings }) {
  return (
    <li>
      <span role="img" aria-label={strings.lockedLabel}>
        🔒
      </span>{' '}
      <strong>{stop.name}</strong>
      <p>{stop.announce}</p>
    </li>
  );
}
