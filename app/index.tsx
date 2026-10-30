import { Redirect, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { useReducedMotion } from "react-native-reanimated";

import { useUiLocale } from "./_layout";
import { uiStrings } from "../components/ui-strings";
import { AnimatedSplash, SPLASH_DURATION_MS, nextSplashSampleMs } from "../components/animated-splash";

// The native splash stays on screen until the JS route is ready. This route
// then plays the approved vector intro before replacing itself with Explore.
// The brand word reads the switchable display locale from the composition
// (components/ui-strings contract), not a pinned locale.
export default function Index() {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const brandName = uiStrings(useUiLocale()).myKudy;
  // Phase-aware sampling follows the fixed splash timeline.
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (reduceMotion) return;
    const startedAt = Date.now();
    let frame: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      const elapsed = Math.min(SPLASH_DURATION_MS, Date.now() - startedAt);
      setElapsedMs(elapsed);
      const next = nextSplashSampleMs(elapsed);
      if (next !== null) {
        frame = setTimeout(tick, Math.max(1, startedAt + next - Date.now()));
      }
    };
    const firstSample = nextSplashSampleMs(0);
    if (firstSample !== null) frame = setTimeout(tick, firstSample);
    const complete = setTimeout(() => router.replace("/explore"), SPLASH_DURATION_MS);
    return () => {
      if (frame !== undefined) clearTimeout(frame);
      clearTimeout(complete);
    };
  }, [reduceMotion, router]);

  if (reduceMotion) return <Redirect href="/explore" />;
  return <AnimatedSplash elapsedMs={elapsedMs} brandName={brandName} />;
}
