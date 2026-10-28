import { Redirect, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { useReducedMotion } from "react-native-reanimated";

import { useUiLocale } from "./_layout";
import { uiStrings } from "../components/ui-strings";
import { AnimatedSplash, SPLASH_DURATION_MS } from "../components/animated-splash";

// The native splash stays on screen until the JS route is ready. This route
// then plays the approved vector intro before replacing itself with Explore.
// The brand word reads the switchable display locale from the composition
// (components/ui-strings contract), not a pinned locale.
export default function Index() {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const brandName = uiStrings(useUiLocale()).myKudy;
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (reduceMotion) return;
    const startedAt = Date.now();
    const frame = setInterval(() => {
      setElapsedMs(Math.min(SPLASH_DURATION_MS, Date.now() - startedAt));
    }, 32);
    const complete = setTimeout(() => router.replace("/explore"), SPLASH_DURATION_MS);
    return () => {
      clearInterval(frame);
      clearTimeout(complete);
    };
  }, [reduceMotion, router]);

  if (reduceMotion) return <Redirect href="/explore" />;
  return <AnimatedSplash elapsedMs={elapsedMs} brandName={brandName} />;
}
