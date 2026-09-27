// G06.04 (issue #63) — the city mode button of 11 §1: with a live walk
// (active or paused) every surface of the navigation contract (11 §16)
// shows «Прагулка» and returns to the Run surface of that walk, in the
// panel position the person left it in — the run surface controller is
// cached per route by the composition root, so the re-entry reuses the
// same controller (NAV7). Navigation only: it never stops the audio and
// never changes the session. Without a live walk there is no target — the
// button renders nowhere (no fake destination).
import { useCallback, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import { Pressable, StyleSheet, Text } from "react-native";

import { useServices } from "./_layout";
import { tokens } from "./design-tokens";

const styles = StyleSheet.create({
  button: {
    alignSelf: "flex-start",
    backgroundColor: tokens.colorAccent,
    borderRadius: tokens.radiusBase,
    marginBottom: tokens.spaceM,
    padding: tokens.spaceM,
  },
  label: {
    color: tokens.colorAccentInk,
    fontSize: tokens.fontBaseSize,
    fontWeight: tokens.fontWeightStrong,
  },
});

export function WalkButton() {
  const router = useRouter();
  const services = useServices();
  const [live, setLive] = useState(() => services.walk?.liveSession() ?? null);
  useFocusEffect(
    useCallback(() => {
      // Re-read on every focus: a walk started (or finished) while this
      // surface stayed in the stack is on this read when the surface
      // returns — the button follows the live walk, not the mount time.
      setLive(services.walk?.liveSession() ?? null);
    }, [services]),
  );
  if (!live) return null;
  return (
    <Pressable
      onPress={() => router.push(`/run/${live.routeId}`)}
      style={styles.button}
      testID="btn-walk-mode"
    >
      <Text style={styles.label}>Прагулка</Text>
    </Pressable>
  );
}
