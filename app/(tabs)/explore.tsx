// G06.01.a (issue #313) — the Explore city surface: the city name and the
// canonical chain's first rendering of the published guides (one card per
// guide, D02; the same card the rubric shows). State rendering lives in
// CatalogStateView; the surface decides nothing about what exists.
// G07.01 (issue #281) adds the «Побач» entry (Journey 3: Explore / кнопка
// «Побач»; NAV3 — the button works from the empty city too).
import { Link } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

import { useCatalogController } from "../../controllers/catalog/useCatalogController";
import { useServices } from "../_layout";
import { tokens } from "../design-tokens";
import { CatalogStateView, CITY_TITLE } from "../guide-card";

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
  return (
    <View style={{ backgroundColor: tokens.colorPaper, flex: 1, padding: tokens.spaceL }} testID="screen-Explore">
      <Text style={styles.title}>{CITY_TITLE}</Text>
      <Link href="/map" testID="link-nearby">
        <Text style={styles.nearbyLink}>Побач</Text>
      </Link>
      <CatalogStateView state={controller?.surface ?? null} variant="city" />
    </View>
  );
}
