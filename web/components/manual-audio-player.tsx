// The manual web player (09 §8, plan §2): the standard HTML audio element per
// bundle locale whose base audio file actually exists — controls on,
// preload="none", no auto-start attribute anywhere. Playback starts only from
// the visitor's tap and lives only in the open tab; nothing about it is
// stored (task step 6 — no client JS exists in this component at all). An
// empty availability list renders the explicit failure state — silence is
// never a state (task step 5) — while the transcript above stays readable.
import type { UiStrings } from '../lib/i18n/index.ts';

export interface StopAudio {
  locale: string;
  src: string;
}

export function ManualAudioPlayer({ audio, strings }: { audio: StopAudio[]; strings: UiStrings }) {
  if (audio.length === 0) {
    return (
      <p role="status">
        <strong>{strings.audioHeading}:</strong> {strings.audioUnavailable}
      </p>
    );
  }
  return (
    <section>
      <h2>{strings.audioHeading}</h2>
      {audio.map((track) => (
        <p key={track.locale}>
          {track.locale}
          {': '}
          <audio controls preload="none" src={track.src} />
        </p>
      ))}
    </section>
  );
}
