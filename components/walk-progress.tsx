// G06.10.f (issue #406) — the walk progress as a living line: the canon 6px
// strip (visual-language §5 — запаўненне color.accent на трэку color.line)
// eases to each new value on the animation base pinned to the SDK 54 line,
// and the optional figure cross-fades when it changes. The reduce-motion
// rule of canon §9 («reduced-motion без пераходаў») is the base's own
// system-aware mode: useReducedMotion() reads the OS setting and its two
// paths are the only places where «ease» and «land instantly» differ. No
// other animation pattern lives here (G06.10 out of scope).
import { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import type { WithTimingConfig } from "react-native-reanimated";

import { tokens } from "./design-tokens";

// One pace for the whole pattern (founder quiz 2026-09-29): the fill's ease
// and the figure's cross-fade share it — a living line, never a spring.
const PROGRESS_TIMING: WithTimingConfig = {
  duration: 400,
  easing: Easing.inOut(Easing.ease),
};

const styles = StyleSheet.create({
  // The canon strip exactly as UX 04 (issue #350) drew it: 6px accent fill
  // on the line track with the muted 1px edge (≥3:1 on the card) — one home
  // for the strip's visuals now (implementation-rules 2).
  track: {
    backgroundColor: tokens.colorLine,
    borderColor: tokens.colorMuted,
    borderRadius: 999,
    borderWidth: 1,
    height: 6,
  },
  fill: {
    backgroundColor: tokens.colorAccent,
    height: "100%",
  },
  figureRow: {
    marginBottom: 2,
  },
  figure: {
    color: tokens.colorMuted,
    fontSize: 12,
  },
  // The outgoing figure overlays the incoming one — the two layers together
  // are the cross-fade.
  figureLayer: {
    position: "absolute",
  },
});

export type WalkProgressProps = {
  // The audible audio's own line (09 §6.3), 0..1 — clamped, never invented.
  progress: number;
  // The optional figure shown with the fill («паласа 6px + лічба», founder
  // quiz 2026-09-29) — the Run bar carries none today; surfaces that show
  // one get the cross-fade for free.
  figure?: string | null;
  // Layout extras from the consumer's flow (margins) — the strip's canon
  // visuals stay in this component, one home (implementation-rules 2).
  style?: StyleProp<ViewStyle>;
  testID?: string;
  fillTestID?: string;
  figureTestID?: string;
};

export function WalkProgress({
  progress,
  figure = null,
  style,
  testID = "walk-progress",
  fillTestID = "walk-progress-fill",
  figureTestID = "walk-progress-figure",
}: WalkProgressProps) {
  const reduceMotion = useReducedMotion();
  // The percent the strip shows: the same rounding the Run bar used before
  // G06.10.f (the existing run assertions read «25%»), clamped 0..100.
  const target = Math.round(Math.min(1, Math.max(0, progress)) * 100);
  const width = useSharedValue(target);
  // The last target an ease was started for: the mount renders at its own
  // value (nothing animates on mount) and a redundant value never restarts
  // the ease.
  const easedTarget = useRef(target);

  useEffect(() => {
    if (reduceMotion) {
      // Canon §9: with less motion on the value lands instantly — the only
      // write, no transition values anywhere.
      width.value = target;
      easedTarget.current = target;
      return;
    }
    if (easedTarget.current !== target) {
      easedTarget.current = target;
      width.value = withTiming(target, PROGRESS_TIMING);
    }
  }, [reduceMotion, target, width]);

  const fillStyle = useAnimatedStyle(() => ({ width: `${width.value}%` }));

  // The figure's cross-fade: the outgoing word fades out while the incoming
  // one fades in — one pair of layers, re-used for every change; under
  // reduce-motion the swap is instant (canon §9).
  const [figures, setFigures] = useState<{ current: string | null; previous: string | null }>(() => ({
    current: figure,
    previous: null,
  }));
  const shownFigure = useRef(figure);
  const currentOpacity = useSharedValue(1);
  const previousOpacity = useSharedValue(0);

  useEffect(() => {
    const next = figure ?? null;
    if (shownFigure.current === next) return;
    const previous = shownFigure.current;
    shownFigure.current = next;
    if (reduceMotion) {
      setFigures({ current: next, previous: null });
      previousOpacity.value = 0;
      currentOpacity.value = 1;
      return;
    }
    setFigures({ current: next, previous });
    if (previous !== null) {
      previousOpacity.value = 1;
      previousOpacity.value = withTiming(0, PROGRESS_TIMING);
    }
    currentOpacity.value = 0;
    currentOpacity.value = withTiming(1, PROGRESS_TIMING);
  }, [figure, reduceMotion, currentOpacity, previousOpacity]);

  const currentFigureStyle = useAnimatedStyle(() => ({ opacity: currentOpacity.value }));
  const previousFigureStyle = useAnimatedStyle(() => ({ opacity: previousOpacity.value }));

  return (
    <>
      <View style={[styles.track, style]} testID={testID}>
        <Animated.View style={[styles.fill, fillStyle]} testID={fillTestID} />
      </View>
      {figures.current !== null ? (
        <View style={styles.figureRow}>
          {figures.previous !== null ? (
            <Animated.Text
              // The outgoing layer is the cross-fade's memory, not content:
              // it sits at opacity 0 after the swap, so the screen-reader
              // tree must not reach the stale word (the paper-surface idiom).
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={[styles.figure, styles.figureLayer, previousFigureStyle]}
              testID={`${figureTestID}-previous`}
            >
              {figures.previous}
            </Animated.Text>
          ) : null}
          <Animated.Text style={[styles.figure, currentFigureStyle]} testID={figureTestID}>
            {figures.current}
          </Animated.Text>
        </View>
      ) : null}
    </>
  );
}
