// G06.01.a (issue #313) — the Explore city surface: the city name and the
// canonical chain's first rendering of the published guides (one card per
// guide, D02; the same card the rubric shows). State rendering lives in
// CatalogStateView; the surface decides nothing about what exists.
// G07.01 (issue #281) adds the «Побач» entry (Journey 3: Explore / кнопка
// «Побач»; NAV3 — the button works from the empty city too).
import { Link } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useCatalogController } from "../../controllers/catalog/useCatalogController";
import { useServices } from "../_layout";
import { tokens } from "../../components/design-tokens";
import { CatalogStateView, CITY_TITLE } from "../../components/guide-card";
import { PressableSurface } from "../../components/pressable-surface";
import { WalkButton } from "../../components/walk-button";

const styles = StyleSheet.create({
  title: {
    color: tokens.colorInk,
    fontSize: 18,
    fontWeight: tokens.fontWeightStrong,
    marginBottom: tokens.spaceM,
  },
  nearbyLink: {
    color: tokens.colorInk,
    fontSize: tokens.fontBaseSize,
    fontWeight: tokens.fontWeightStrong,
    marginBottom: tokens.spaceM,
  },
});

export default function Explore() {
  const services = useServices();
  const controller = useCatalogController(services.catalog?.controller);
  // UX 02 (issue #348): with the native header off the screen starts below
  // the status bar and the notch — the top safe-area inset is the screen's
  // own (AC4).
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        backgroundColor: tokens.colorPaper,
        flex: 1,
        padding: tokens.spaceL,
        paddingTop: insets.top + tokens.spaceL,
      }}
      testID="screen-Explore"
    >
      <WalkButton walk={services.walk} />
      <Text style={styles.title}>{CITY_TITLE}</Text>
      <Link href="/map" asChild>
        {/* UX 03 (issue #349): the tappable marker and the role of
            criterion 2; hitSlop lifts the target to ≥44dp (criterion 3). */}
        <PressableSurface accessibilityRole="link" hitSlop={12} testID="link-nearby">
          <Text style={styles.nearbyLink}>Побач →</Text>
        </PressableSurface>
      </Link>
      <CatalogStateView state={controller?.surface ?? null} variant="city" />
    </View>
  );
}
