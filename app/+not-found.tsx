// Issue #427 — the unknown deep link is a styled app screen, not a dead end:
// the paper frame renders the honest message with the hint that names the
// catalog, and the one back element walks to the catalog (/explore). The
// default router.back() is not used — on a cold deep link the stack holds no
// surface to pop, and the issue names the target outright.
// The title is chrome, not a guide or story title — canon §3 keeps the
// display serif for those, so the UI family renders it (G06.10.b).
import { useRouter } from "expo-router";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BackButton } from "../components/back-button";
import { tokens } from "../components/design-tokens";
import { ScaledText } from "../components/scaled-text";
import { screenStyles } from "../components/screen-styles";
import { uiStrings } from "../components/ui-strings";
import { useServices } from "./_layout";

const styles = StyleSheet.create({
  hint: {
    color: tokens.colorInk,
    fontFamily: tokens.fontFamilyUi,
    fontSize: tokens.fontBaseSize,
    marginTop: tokens.spaceS,
  },
  title: {
    color: tokens.colorInk,
    fontFamily: tokens.fontFamilyUiStrong,
    fontSize: tokens.fontTitleSize,
    fontWeight: tokens.fontWeightStrong,
  },
});

export default function NotFound() {
  const services = useServices();
  const router = useRouter();
  // UX 02 (issue #348): the frame's top inset — the content starts below the
  // status bar and the notch with the native header off (AC4). A hook —
  // before any early returns.
  const insets = useSafeAreaInsets();
  // G06.05 (issue #280, AC1): the chrome words in the display locale.
  const strings = uiStrings(services.locale);
  return (
    <View
      style={[screenStyles.screen, { paddingTop: insets.top + tokens.spaceL }]}
      testID="screen-Not found"
    >
      <BackButton
        label={strings.back}
        onPress={() => router.replace("/explore")}
        testID="btn-not-found-back"
      />
      <ScaledText style={styles.title}>{strings.notFoundTitle}</ScaledText>
      <ScaledText style={styles.hint}>{strings.notFoundHint}</ScaledText>
    </View>
  );
}
