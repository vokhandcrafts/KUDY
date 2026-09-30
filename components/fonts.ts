// G06.10.b (issue #402) — the font-loading module of the root composition:
// the three approved families (visual-language §3 «Ухвалены шрыфтавы пакет»)
// load once at the root, keyed by the token mirror, so a style pointing at
// tokens.fontFamilyUi resolves to the loaded face. Lives in components/, not
// app/: expo-router treats every app/ file as a route (issue #339).
//
// No loading gate: rendering never waits for the fonts. While they load (and
// if loading fails) every surface draws its system-ui fallback and stays
// readable (AC4) — the families swap in when the faces arrive. One family per
// weight is the Android workaround: React Native cannot pick a weight inside
// a single family, so each named weight loads under its own family name and
// the strong styles point at the 600 face (tokens.fontFamilyUiStrong etc.).
import { useFonts } from "expo-font";
import { Alegreya_600SemiBold } from "@expo-google-fonts/alegreya";
import { Caveat_400Regular } from "@expo-google-fonts/caveat";
import { GolosText_400Regular, GolosText_600SemiBold } from "@expo-google-fonts/golos-text";

import { tokens } from "./design-tokens";

export function useAppFonts(): void {
  useFonts({
    [tokens.fontFamilyUi]: GolosText_400Regular,
    [tokens.fontFamilyUiStrong]: GolosText_600SemiBold,
    [tokens.fontFamilyDisplay]: Alegreya_600SemiBold,
    // The dragon voice (canon §3: only the dragon's lines and hints, never
    // interface text) loads now; its first surface is the dragon hint card
    // (G07.04) — not this task.
    [tokens.fontFamilyDragon]: Caveat_400Regular,
  });
}
