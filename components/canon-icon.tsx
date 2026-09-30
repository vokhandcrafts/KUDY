// G06.10.c (issue #403) — the one icon layer over Lucide (founder quiz
// 2026-09-29: one rounded outline set, ISC). The glyph arrives from the usage
// site as a deep per-glyph import (Metro does not tree-shake the barrel —
// G06.10); this file imports nothing from the icon package, not even a type.
// Color and size resolve from the canon tokens at render time — the override
// test in canon-icon.test.tsx pins that (a literal here would freeze it).
// Every rendering carries the screen-reader label (visual-language.md §9:
// подпісы на кожнай icon-only кнопцы) on the wrapper View — the SVG inside
// is decoration — and pointerEvents="none" lets the icon sit inside a
// Pressable without stealing the press. Lives in components/, not app/:
// expo-router treats every app/ file as a route (issue #339).
import type { ComponentType } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";

import { tokens } from "./design-tokens";

// The structural shape of a Lucide glyph; typed locally so the barrel never
// appears in an import of this file.
export type CanonGlyph = ComponentType<{ color?: string; size?: number }>;

export function CanonIcon({
  glyph: Glyph,
  label,
  color = tokens.colorInk,
  size = tokens.fontBaseSize,
  style,
  testID,
}: {
  glyph: CanonGlyph;
  // Canon §9: the screen-reader word — required on every rendering; an empty
  // label is a contract breach, not a silent decorative default.
  label: string;
  color?: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  if (label.trim().length === 0) {
    throw new Error("CanonIcon: the screen-reader label is required (visual-language.md §9)");
  }
  return (
    <View accessible={true} accessibilityLabel={label} pointerEvents="none" style={style} testID={testID}>
      <Glyph color={color} size={size} />
    </View>
  );
}
