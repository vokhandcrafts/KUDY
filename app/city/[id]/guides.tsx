// G06.01.a (issue #313) — the «Гіды» rubric surface: the full list of the
// published guides in the canonical order, each exactly once (11 §16.1), Back
// to the city (NAV9). The rubric exists only with published content — the
// empty city renders its honest NAV3 message instead of an empty rubric.
// The [id] route of 19 §2.5 is display-shaped only in the MVP single-city
// catalog: the surface renders the active city and does not echo an
// unvalidated param (21 §3.2 — у MVP толькі актыўны Гданьск).
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useCatalogController } from "../../../controllers/catalog/useCatalogController";
import { useServices } from "../../_layout";
import { BackButton } from "../../../components/back-button";
import { tokens } from "../../../components/design-tokens";
import { CityCatalogBody } from "../../../components/guide-card";
import { uiStrings } from "../../../components/ui-strings";

const styles = StyleSheet.create({
  screen: {
    backgroundColor: tokens.colorPaper,
    flex: 1,
    padding: tokens.spaceL,
  },
});

export default function Guides() {
  const services = useServices();
  const controller = useCatalogController(services.catalog?.controller);
  // UX 02 (issue #348): the frame's top inset — the content starts below the
  // status bar and the notch with the native header off (AC4).
  const insets = useSafeAreaInsets();
  // G06.05 (issue #280, AC1/AC4): the shared words in the display locale and
  // the failed load's named retry.
  const strings = uiStrings(services.locale);
  return (
    <View
      style={[styles.screen, { paddingTop: insets.top + tokens.spaceL }]}
      testID="screen-Guides"
    >
      <BackButton label={strings.backToCity} testID="btn-guides-back" />
      <CityCatalogBody
        walk={services.walk}
        catalog={controller?.surface ?? null}
        onRetry={controller ? () => void controller.refresh() : undefined}
        variant="rubric"
        locale={services.locale}
      />
    </View>
  );
}
