// G06.01.a (issue #313) — the Explore city surface: the city name and the
// canonical chain's first rendering of the published guides (one card per
// guide, D02; the same card the rubric shows). State rendering lives in
// CatalogStateView; the surface decides nothing about what exists.
// G07.01 (issue #281) adds the «Побач» entry (Journey 3: Explore / кнопка
// «Побач»; NAV3 — the button works from the empty city too).
import { Link } from "expo-router";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useCatalogController } from "../../controllers/catalog/useCatalogController";
import { useServices } from "../_layout";
import { tokens } from "../../components/design-tokens";
import { CityCatalogBody } from "../../components/guide-card";
import { PressableSurface } from "../../components/pressable-surface";
import { ScaledText } from "../../components/scaled-text";
import { uiStrings } from "../../components/ui-strings";

const styles = StyleSheet.create({
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
  // G06.05 (issue #280, AC1): the shared words in the display locale; the
  // failed catalog load gets its named retry (AC4).
  const strings = uiStrings(services.locale);
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
      <CityCatalogBody
        walk={services.walk}
        catalog={controller?.surface ?? null}
        onRetry={controller ? () => void controller.refresh() : undefined}
        variant="city"
        locale={services.locale}
        middle={
          <Link href="/map" asChild>
            {/* UX 03 (issue #349): the tappable marker and the role of
                criterion 2; hitSlop lifts the target to ≥44dp (criterion 3). */}
            <PressableSurface
              accessibilityRole="link"
              accessibilityLabel={strings.nearby}
              hitSlop={12}
              testID="link-nearby"
            >
              <ScaledText style={styles.nearbyLink}>{strings.nearby}</ScaledText>
            </PressableSurface>
          </Link>
        }
      />
    </View>
  );
}
