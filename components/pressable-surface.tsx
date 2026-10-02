// UX 03 (issue #349) — the one shared pressed wrapper for the interactive
// elements of the main screens (the design dossier 2026-09-28 finding:
// «Ніякага pressed-стану»). Every press gets a visible reaction: a ≥10%
// dim through opacity on every path, plus the android_ripple on Android
// on top of it. The dim and the ripple color are derived alphas of
// color.ink, not new canon values — visual-language.md §10 keeps new
// colors out of the surface layer. Lives in components/, not app/:
// expo-router treats every app/ file as a route (issue #339).
// G06.10.d (issue #404) — the clay body: a pressable can carry a bottom
// shelf, the darker tension of its fill from the canon shelf tokens
// (visual-language §2) through the token mirror, and on press it dips
// into the shelf — translate plus a reduced shelf, the bottom edge holds.
// The dim and the ripple stay on top of the dip; a disabled pressable
// never dips, and the disabled primary reads through the canon ghost pair
// (canon §5 after the owner's variant А, issue #430:
// color.disabled-ink/line, transparent fill, no shelf) — the old
// opacity 0.5 contract is gone.
import { forwardRef, type ComponentRef } from "react";
import {
  Pressable,
  StyleSheet,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { tokens } from "./design-tokens";

// 10% ink alpha — a derived shade of color.ink (#22262b), see the file head.
const RIPPLE_COLOR = "rgba(34, 38, 43, 0.1)";

// The shelf of the clay button: the 4px bottom shelf of the accepted style
// package (G06.10, founder quiz 2026-09-29). On press the button sinks by
// half the shelf and the shelf halves with it — the bottom edge holds still.
const SHELF_HEIGHT = 4;
const DIP_TRANSLATE = 2;

const styles = StyleSheet.create({
  pressed: {
    // The ≥10% dim of criterion 1 on every path; Android adds the ripple
    // on top of it.
    opacity: 0.9,
  },
  dip: {
    transform: [{ translateY: DIP_TRANSLATE }],
  },
  shelfDip: {
    borderBottomWidth: SHELF_HEIGHT - DIP_TRANSLATE,
  },
});

// The two canon shelf shades (canon §2): accent for the primary actions,
// line for the secondary ones — the token mirror, never literals here.
const SHELF_SHADES = ["accent", "line"] as const;
export type ShelfShade = (typeof SHELF_SHADES)[number];

const shelfStyles = StyleSheet.create({
  accent: {
    borderBottomWidth: SHELF_HEIGHT,
    borderBottomColor: tokens.colorShelfAccent,
  },
  line: {
    borderBottomWidth: SHELF_HEIGHT,
    borderBottomColor: tokens.colorShelfLine,
  },
});

type SurfaceProps = PressableProps & { shelf?: ShelfShade };

export const PressableSurface = forwardRef<ComponentRef<typeof Pressable>, SurfaceProps>(
  function PressableSurface({ style, shelf, disabled, ...rest }: SurfaceProps, ref) {
    return (
      <Pressable
        ref={ref}
        disabled={disabled}
        {...rest}
        android_ripple={{ color: RIPPLE_COLOR }}
        style={(state) => {
          const base = typeof style === "function" ? style(state) : style;
          const layers: StyleProp<ViewStyle>[] = [base];
          if (shelf) layers.push(shelfStyles[shelf]);
          if (state.pressed) layers.push(styles.pressed);
          // The dip is the enabled press's move: a disabled pressable keeps
          // its resting shelf and never translates (canon §5).
          if (state.pressed && shelf && !disabled) layers.push(styles.dip, styles.shelfDip);
          return layers;
        }}
      />
    );
  },
);
