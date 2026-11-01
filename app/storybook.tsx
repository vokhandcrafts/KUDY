// DQ-13 (issue #914) — the deep link kudy:///storybook opens the on-device
// Storybook (spec §4.4 B): the guide-card stories from DQ-02, browsable and
// tweakable on the phone. The bundle-level gate sits in metro.config.js:
// withStorybook resolves every @storybook/* request to an empty module and,
// because the import below names root.tsx (not index.*), the entry itself
// falls to the wrapper's {type: "empty"} branch — the production bundle
// keeps zero files of the @storybook packages (criterion 2, guarded by
// tools/metro-config/storybook-gate.test.mjs). The surface gate follows the
// han-probe/dev-specimen idiom: outside __DEV__ the route renders
// nothing even if a stubbed build reached it. There are no hooks here, so
// the early return stands alone. In a dev build without the flag the
// empty branch leaves the import a truthy empty object, so the route checks
// callability and shows the honest notice.
import { StyleSheet, View } from "react-native";

import { tokens } from "../components/design-tokens";
import { ScaledText } from "../components/scaled-text";

import StorybookUIRoot from "../.rnstorybook/root";

export default function Storybook() {
  if (!__DEV__) return null;
  // The wrapper's empty branch leaves the import as an empty exports object
  // (Metro interop: {default: {}}), not undefined — check callability.
  if (typeof StorybookUIRoot !== "function") {
    return (
      <View style={styles.notice} testID="storybook/disabled">
        <ScaledText style={styles.text} testID="storybook/disabled-text">
          Storybook is disabled — start Metro with EXPO_PUBLIC_STORYBOOK=1 and reload.
        </ScaledText>
      </View>
    );
  }
  return <StorybookUIRoot />;
}

const styles = StyleSheet.create({
  notice: {
    flex: 1,
    justifyContent: "center",
    padding: tokens.spaceL,
  },
  text: {
    color: tokens.colorInk,
    fontFamily: tokens.fontFamilyUi,
    fontSize: tokens.fontBaseSize,
  },
});
