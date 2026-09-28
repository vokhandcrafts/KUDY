// UX 03 (issue #349) — the one shared pressed wrapper for the interactive
// elements of the main screens (the design dossier 2026-09-28 finding:
// «Ніякага pressed-стану»). Every press gets a visible reaction: a ≥10%
// dim through opacity on every path, plus the android_ripple on Android
// on top of it. The dim and the ripple color are derived alphas of
// color.ink, not new canon values — visual-language.md §10 keeps new
// colors out of the surface layer. Lives in components/, not app/:
// expo-router treats every app/ file as a route (issue #339).
import { forwardRef, type ComponentRef } from "react";
import { Pressable, StyleSheet, type PressableProps } from "react-native";

// 10% ink alpha — a derived shade of color.ink (#22262b), see the file head.
const RIPPLE_COLOR = "rgba(34, 38, 43, 0.1)";

const styles = StyleSheet.create({
  pressed: {
    // The ≥10% dim of criterion 1 on every path; Android adds the ripple
    // on top of it.
    opacity: 0.9,
  },
});

export const PressableSurface = forwardRef<ComponentRef<typeof Pressable>, PressableProps>(
  function PressableSurface({ style, ...rest }: PressableProps, ref) {
    return (
      <Pressable
        ref={ref}
        {...rest}
        android_ripple={{ color: RIPPLE_COLOR }}
        style={(state) => {
          const base = typeof style === "function" ? style(state) : style;
          return [base, state.pressed && styles.pressed];
        }}
      />
    );
  },
);
