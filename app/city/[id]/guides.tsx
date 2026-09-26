// G06.01.a (issue #313) — the «Гіды» rubric surface: the full list of the
// published guides in the canonical order, each exactly once (11 §16.1), Back
// to the city (NAV9). The rubric exists only with published content — the
// empty city renders its honest NAV3 message instead of an empty rubric.
import { useLocalSearchParams, useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useCatalogController } from "../../../controllers/catalog/useCatalogController";
import { useServices } from "../../_layout";
import { tokens } from "../../design-tokens";
import { CatalogStateView, CITY_TITLE } from "../../guide-card";

const styles = StyleSheet.create({
  back: {
    color: tokens.colorAccent,
    fontSize: tokens.fontBaseSize,
    marginBottom: tokens.spaceM,
  },
  title: {
    color: tokens.colorInk,
    fontSize: 18,
    fontWeight: tokens.fontWeightStrong,
    marginBottom: tokens.spaceM,
  },
});

export default function Guides() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const services = useServices();
  const controller = useCatalogController(services.catalog?.controller);
  return (
    <View style={{ backgroundColor: tokens.colorPaper, flex: 1, padding: tokens.spaceL }} testID="screen-Guides">
      <Pressable onPress={() => router.back()} style={styles.back} testID="btn-guides-back">
        ← Горад
      </Pressable>
      <Text style={styles.title}>
        {CITY_TITLE} — <Text testID="guides-city">{id}</Text>
      </Text>
      <CatalogStateView state={controller?.surface ?? null} variant="rubric" />
    </View>
  );
}
