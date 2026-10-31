// UX 07 (issue #353) — the one shared loading row: a small ActivityIndicator
// next to the state text, so a pending surface reads as alive, not frozen.
// Every loading state renders this component instead of a bare Text (the
// issue forbids five copies). Lives in components/, not app/: expo-router
// treats every app/ file as a route (issue #339).
import { ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { darkTokens, tokens, type ThemeTokens } from "./design-tokens";
import { useThemeStyles } from "./theme";
import { ScaledText } from "./scaled-text";

const createStyles = (palette: ThemeTokens) => StyleSheet.create({
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: palette.spaceS,
  },
  text: {
    color: palette.colorMuted,
    flexShrink: 1,
    fontSize: palette.fontBaseSize,
  },
});
const lightStyles = createStyles(tokens);
const darkStyles = createStyles(darkTokens);

export function LoadingIndicator({
  text,
  style,
  testID,
}: {
  text: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const styles = useThemeStyles(lightStyles, darkStyles);
  return (
    // G06.05 (AC1): the row is announced with the state text — the spinner
    // itself is decorative and stays silent.
    <View accessible={true} accessibilityLabel={text} style={[styles.row, style]} testID={testID}>
      <ActivityIndicator color={tokens.colorMuted} size="small" testID="loading-indicator" />
      <ScaledText style={styles.text}>{text}</ScaledText>
    </View>
  );
}
