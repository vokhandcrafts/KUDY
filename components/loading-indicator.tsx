// UX 07 (issue #353) — the one shared loading row: a small ActivityIndicator
// next to the state text, so a pending surface reads as alive, not frozen.
// Every loading state renders this component instead of a bare Text (the
// issue forbids five copies). Lives in components/, not app/: expo-router
// treats every app/ file as a route (issue #339).
import { ActivityIndicator, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { tokens } from "./design-tokens";

const styles = StyleSheet.create({
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: tokens.spaceS,
  },
  text: {
    color: tokens.colorMuted,
    flexShrink: 1,
    fontSize: tokens.fontBaseSize,
  },
});

export function LoadingIndicator({
  text,
  style,
  testID,
}: {
  text: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  return (
    <View style={[styles.row, style]} testID={testID}>
      <ActivityIndicator color={tokens.colorMuted} size="small" testID="loading-indicator" />
      <Text style={styles.text}>{text}</Text>
    </View>
  );
}
