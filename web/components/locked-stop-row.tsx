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
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          width="16"
          height="16"
          role="img"
          aria-label={strings.lockedLabel}
          focusable="false"
        >
          <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>{' '}
        <strong>{stop.name}</strong>
      </a>
      <p>{stop.announce}</p>
    </li>
  );
}
