// UX 02 (issue #348) — the one back element of the navigation frame: every
// screen except the start surface renders exactly one (AC2). The label lives
// in a <Text> child — a bare string in Pressable renders invisible and throws
// the LogBox «Text strings must be rendered» warning (the #344 class) — and
// the touch target is ≥44×44dp, hitSlop adds forgiveness. Navigation only
// (screens-and-transitions: Back — навігацыя, не каманда). Lives in
// components/, not app/: expo-router treats every app/ file as a route
// (issue #339) — the WalkButton precedent.
import { Pressable, StyleSheet } from "react-native";
import { useRouter } from "expo-router";

import { tokens } from "./design-tokens";
import { ScaledText } from "./scaled-text";

const styles = StyleSheet.create({
  touch: {
    alignItems: "flex-start",
    justifyContent: "center",
    marginBottom: tokens.spaceM,
    minHeight: 44,
    minWidth: 44,
  },
  label: {
    color: tokens.colorAccent,
    fontSize: tokens.fontBaseSize,
  },
});

export function BackButton({
  label,
  onPress,
  testID,
}: {
  label: string;
  onPress?: () => void;
  testID: string;
}) {
  const router = useRouter();
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      hitSlop={{ bottom: 8, left: 8, right: 8, top: 8 }}
      onPress={onPress ?? (() => router.back())}
      style={styles.touch}
      testID={testID}
    >
      <ScaledText style={styles.label}>{label}</ScaledText>
    </Pressable>
  );
}
