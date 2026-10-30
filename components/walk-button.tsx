// G06.04 (issue #63) — the city mode button of 11 §1: with a live walk
// (active or paused) every surface of the navigation contract (11 §16)
// shows «Прагулка» and returns to the Run surface of that walk, in the
// panel position the person left it in — the run surface controller is
// cached per route by the composition root, so the re-entry reuses the
// same controller (NAV7). Navigation only: it never stops the audio and
// never changes the session. Without a live walk there is no target — the
// button renders nowhere (no fake destination). Lives in components/, not
// app/: expo-router treats every app/ file as a route (issue #339); the
// screen passes its services walk member in as a prop — components takes
// no runtime imports from the other zones.
import { useCallback, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import { StyleSheet } from "react-native";

import type { Services } from "../controllers/createServices";
import { PressableSurface } from "./pressable-surface";
import { darkTokens, tokens, type ThemeTokens } from "./design-tokens";
import { useThemeStyles } from "./theme";
import { ScaledText } from "./scaled-text";
import { uiStrings } from "./ui-strings";

const createStyles = (palette: ThemeTokens) => StyleSheet.create({
  button: {
    alignSelf: "flex-start",
    backgroundColor: palette.colorAccent,
    borderRadius: palette.radiusBase,
    marginBottom: palette.spaceM,
    padding: palette.spaceM,
  },
  label: {
    color: palette.colorAccentInk,
    fontSize: palette.fontBaseSize,
    fontWeight: palette.fontWeightStrong,
  },
});
const lightStyles = createStyles(tokens);
const darkStyles = createStyles(darkTokens);

export function WalkButton({ walk, locale = "be" }: { walk?: Services["walk"]; locale?: string }) {
  const styles = useThemeStyles(lightStyles, darkStyles);
  const router = useRouter();
  const [live, setLive] = useState(() => walk?.liveSession() ?? null);
  useFocusEffect(
    useCallback(() => {
      // Re-read on every focus: a walk started (or finished) while this
      // surface stayed in the stack is on this read when the surface
      // returns — the button follows the live walk, not the mount time.
      setLive(walk?.liveSession() ?? null);
    }, [walk]),
  );
  if (!live) return null;
  const label = uiStrings(locale).walk;
  return (
    <PressableSurface
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => router.push(`/run/${live.routeId}`)}
      style={styles.button}
      // G06.10.d (issue #404): the walk entry is a primary action — the
      // accent shelf of the clay button.
      shelf="accent"
      testID="btn-walk-mode"
    >
      <ScaledText style={styles.label}>{label}</ScaledText>
    </PressableSurface>
  );
}
