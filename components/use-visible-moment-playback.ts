import { useEffect, useState } from "react";

import type { MomentPlayBinding } from "../controllers/moment/momentPlayController";

// The card shows the physical state of the one player, including a launch
// owned by a walk. A covered Place remains mounted in the native Stack.
export type VisibleMoment = { kind: "playing" | "paused"; momentId: string } | null;

function visibleMoment(binding: MomentPlayBinding): VisibleMoment {
  const playback = binding.playback();
  if (playback.kind !== "playing" && playback.kind !== "paused") return null;
  const token = playback.token;
  return token !== null && token.kind === "moment"
    ? { kind: playback.kind, momentId: token.ref }
    : null;
}

export function useVisibleMomentPlayback(
  momentPlay: MomentPlayBinding | null,
  pathname: string,
  placeId: string,
): VisibleMoment {
  const [playback, setPlayback] = useState<VisibleMoment>(null);
  useEffect(() => {
    if (pathname !== `/place/${placeId}`) return;
    if (momentPlay === null) {
      setPlayback(null);
      return;
    }
    const read = () => {
      const next = visibleMoment(momentPlay);
      setPlayback((current) => current?.kind === next?.kind && current?.momentId === next?.momentId
        ? current : next);
    };
    read();
    // The physical start can arrive after Play updates the controller store.
    const timer = setInterval(read, 250);
    return () => clearInterval(timer);
  }, [momentPlay, pathname, placeId]);
  return playback;
}
