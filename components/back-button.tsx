// UX 02 (issue #348) — the one back element of the navigation frame: every
// screen except the start surface renders exactly one (AC2). G06.10 (issue
// #432): the one back image is the Lucide arrow beside the word from the one
// dictionary (ui-strings) — no text arrow glyph and no per-screen caption
// copy exists; the arrow renders through CanonIcon so the icon layer's
// token-resolved color/size and the §9 label contract hold. The label lives
// in a <Text> child — a bare string in Pressable renders invisible and
// throws the LogBox «Text strings must be rendered» warning (the #344
// class) — and the touch target is ≥44×44dp, hitSlop adds forgiveness.
// Navigation only (screens-and-transitions: Back — навігацыя, не каманда).
// Lives in components/, not app/: expo-router treats every app/ file as a
// route (issue #339) — the WalkButton precedent.
import { Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";

import ArrowLeftIcon from "lucide-react-native/icons/arrow-left";

import { CanonIcon } from "./canon-icon";
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
  row: {
    alignItems: "center",
    columnGap: tokens.spaceS,
    flexDirection: "row",
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
      <View style={styles.row}>
        <CanonIcon glyph={ArrowLeftIcon} label={label} color={tokens.colorAccent} />
        <ScaledText style={styles.label}>{label}</ScaledText>
      </View>
    </Pressable>
  );
}
