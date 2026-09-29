// G06.05 (issue #280) — the big-text floor of the a11y plate (screens.md:
// ≥ 1.2× the base size; the canon factor is font.big-text-factor 1.25).
// React Native scales text with the OS font setting by default, and an
// unchecked scale (2×+) breaks the fixed surfaces (the peek bar, the marker
// labels); the canon plate is the contract — text grows up to the factor
// and never past it, so the layouts hold. Every user-facing Text renders
// through this component instead of the raw Text (implementation rule 3:
// one idiom, no per-screen caps).
import { Text, type TextProps } from "react-native";

import { tokens } from "./design-tokens";

export function ScaledText({ style, ...rest }: TextProps) {
  return <Text maxFontSizeMultiplier={tokens.fontBigTextFactor} style={style} {...rest} />;
}
