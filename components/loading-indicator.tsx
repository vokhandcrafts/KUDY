// UX 07 (issue #353) — the one shared loading row: a small ActivityIndicator
// next to the state text, so a pending surface reads as alive, not frozen.
// Every loading state renders this component instead of a bare Text (the
// issue forbids five copies). Lives in components/, not app/: expo-router
// treats every app/ file as a route (issue #339).
import { ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { tokens } from "./design-tokens";
import { ScaledText } from "./scaled-text";

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
    // G06.05 (AC1): the row is announced with the state text — the spinner
    // itself is decorative and stays silent.
    <View accessible={true} accessibilityLabel={text} style={[styles.row, style]} testID={testID}>
      <ActivityIndicator color={tokens.colorMuted} size="small" testID="loading-indicator" />
      <ScaledText style={styles.text}>{text}</ScaledText>
    </View>
  );
}
