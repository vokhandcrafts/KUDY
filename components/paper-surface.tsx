// G06.10.e (issue #405) — the paper surface of the calm screens: the canon
// paper color with the generated grain tile tiled over it (canon
// texture.paper-grain, layer opacity from the token mirror). The
// allowed-places rule is the contract: Explore and My KUDY consume this
// wrapper — the Run panel, the map and dense-text surfaces never do (the
// import walk in test/design-tokens.test.mjs is the source-side guard, the
// Run and map suites pin the painted tree). The tile is opaque — the 4–5%
// lives in the layer token, the paper value underneath stays untouched. The
// layer is decorative: hidden from the accessibility tree, and children
// render above it.
import type { PropsWithChildren } from "react";
import { Image, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import grainSource from "../assets/paper-grain.png";
import { tokens } from "./design-tokens";

const styles = StyleSheet.create({
  surface: {
    backgroundColor: tokens.colorPaper,
    flex: 1,
  },
  grain: {
    ...StyleSheet.absoluteFillObject,
    opacity: tokens.texturePaperGrainOpacity,
  },
});

export function PaperSurface({
  children,
  style,
  testID,
}: PropsWithChildren<{
  style?: StyleProp<ViewStyle>;
  testID?: string;
}>) {
  return (
    <View style={[styles.surface, style]} testID={testID}>
      <Image
        source={grainSource}
        resizeMode="repeat"
        style={styles.grain}
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        testID="paper-grain"
      />
      {children}
    </View>
  );
}
