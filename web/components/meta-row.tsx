// Shared meta row for the catalog card and the guide page: every number comes
// from the bundle, every label from the UI strings — no copy at the call site.
import type { LanguageFact } from '../lib/content/site.ts';
import type { UiStrings } from '../lib/i18n/index.ts';

// Deterministic km formatting without ICU: whole km stay integral, otherwise
// one decimal (2500 → 2.5, 3000 → 3).
export function formatDistance(distanceM: number): string {
  return distanceM % 1000 === 0 ? `${distanceM / 1000}` : (distanceM / 1000).toFixed(1);
}

export function MetaRow({ durationMin, distanceM, stopCount, languages, strings }: {
  durationMin: number;
  distanceM: number;
  stopCount: number;
  languages: LanguageFact[];
  strings: UiStrings;
}) {
  const languageList = languages
    .map((fact) => `${fact.locale} (${fact.audio ? strings.audioAndText : strings.textOnly})`)
    .join(', ');
  return (
    <p>
      {strings.duration}: {durationMin} {strings.minutesShort} · {strings.distance}:{' '}
      {formatDistance(distanceM)} {strings.kilometersShort} · {strings.stops}: {stopCount}
      <br />
      {strings.languages}: {languageList}
    </p>
  );
}
