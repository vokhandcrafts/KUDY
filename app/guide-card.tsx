// G06.01.a (issue #313) — the shared City/Guides chrome: the guide card, the
// access badge and the honest-state banner, styled from the canon tokens in
// app/design-tokens.ts (docs/design/visual-language.md, G06.07). Screens
// render state — every decision about what exists lives in the catalog
// controller, nothing is invented here.
import { Link } from "expo-router";
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";

import type { CatalogGuideCard, CatalogSurfaceState } from "../controllers/catalog/catalogController.ts";
import { tokens } from "./design-tokens";

// MVP active city (21 §3.2: у MVP толькі актыўны Гданьск); the surface shows
// the city name per NAV3, and the rubric route carries the city id.
export const CITY_TITLE = "Гданьск";
export const ACTIVE_CITY_ID = "gdansk";
export const RUBRIC_TITLE = "Гіды";

// The scheme's responsive split (screens-and-transitions.md, Explore row):
// one column below 821 px, two columns at 821 px and above.
export function isWide(width: number): boolean {
  return width >= 821;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: tokens.colorCard,
    borderColor: tokens.colorLine,
    borderRadius: tokens.radiusBase,
    borderWidth: 1,
    padding: tokens.spaceM,
  },
  cardSummary: {
    color: tokens.colorMuted,
    fontSize: tokens.fontBaseSize,
    marginBottom: tokens.spaceS,
  },
  cardTitle: {
    color: tokens.colorInk,
    fontSize: tokens.fontBaseSize,
    fontWeight: tokens.fontWeightStrong,
    marginBottom: tokens.spaceS,
  },
  locales: {
    color: tokens.colorMuted,
    fontSize: tokens.fontBaseSize,
    marginTop: tokens.spaceS,
  },
  banner: {
    borderRadius: tokens.radiusBase,
    borderWidth: 1,
    marginBottom: tokens.spaceM,
    padding: tokens.spaceM,
  },
  bannerError: {
    backgroundColor: tokens.colorErrorBg,
    borderColor: tokens.colorErrorBorder,
  },
  bannerNotice: {
    backgroundColor: tokens.colorNoticeBg,
    borderColor: tokens.colorNoticeBorder,
  },
  bannerText: {
    color: tokens.colorInk,
    fontSize: tokens.fontBaseSize,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },
  gridColumn: {
    flexBasis: "48.5%",
  },
  badge: {
    alignSelf: "flex-start",
    backgroundColor: tokens.colorBadgeFree,
    borderRadius: tokens.radiusPill,
    overflow: "hidden",
    paddingHorizontal: tokens.spaceS,
    paddingVertical: 2,
  },
  badgeMixed: { backgroundColor: tokens.colorBadgeMixed },
  badgePaid: { backgroundColor: tokens.colorBadgePaid },
  badgeText: {
    color: tokens.colorInk,
    fontSize: 12,
  },
});

// The tariff is a badge on the card, never a separate rubric (11 §16.1, 20
// §6); the label is the contract value verbatim (21 §3.2 access values).
export function AccessBadge({ access }: { access: CatalogGuideCard["access"] }) {
  const tone = access === "paid" ? styles.badgePaid : access === "mixed" ? styles.badgeMixed : null;
  return (
    <View style={[styles.badge, tone]} testID={`badge-access-${access}`}>
      <Text style={styles.badgeText}>{access}</Text>
    </View>
  );
}

// The languages line: offer-backed cards split text from audio (the
// availability facts); route-only cards state the layer locales without
// claiming a split nothing published.
export function GuideCardLocales({ card }: { card: CatalogGuideCard }) {
  if (!card.localesKnown) {
    return <Text style={styles.locales}>{`Мовы: ${card.textLocales.join(", ")}`}</Text>;
  }
  const audio = card.audioLocales.length > 0 ? `; аўдыё: ${card.audioLocales.join(", ")}` : "";
  return <Text style={styles.locales}>{`Тэкст: ${card.textLocales.join(", ")}${audio}`}</Text>;
}

// One guide card (the ordinary card kind of the canon): the same card on the
// city surface and in the rubric leads to the same preview (D02, 11 §16.1).
export function GuideCard({ card }: { card: CatalogGuideCard }) {
  return (
    <Link href={`/route/${card.routeId}`} asChild>
      <Pressable style={styles.card} testID={`guide-card-${card.routeId}`}>
        <Text style={styles.cardTitle}>{card.title}</Text>
        {card.summary ? <Text style={styles.cardSummary}>{card.summary}</Text> : null}
        <AccessBadge access={card.access} />
        <GuideCardLocales card={card} />
      </Pressable>
    </Link>
  );
}

// The honest-state banner (the notice/error pairs of the canon): a named
// state with its reason, never mascot-only (11 §7).
export function StateBanner({
  tone,
  reason,
  testID,
}: {
  tone: "notice" | "error";
  reason: string;
  testID: string;
}) {
  return (
    <View style={[styles.banner, tone === "error" ? styles.bannerError : styles.bannerNotice]} testID={testID}>
      <Text style={styles.bannerText}>{reason}</Text>
    </View>
  );
}

// The rubric section a surface renders for its guides; empty rubrics never
// render (NAV2) — callers check `guides.length > 0` first. One column below
// 821 px, two above (the scheme's responsive split).
function GuideCardsList({
  guides,
  variant,
}: {
  guides: readonly CatalogGuideCard[];
  variant: "city" | "rubric";
}) {
  const wide = isWide(useWindowDimensions().width);
  const cards = guides.map((card) => (
    <View key={card.routeId} style={wide ? styles.gridColumn : null}>
      <GuideCard card={card} />
    </View>
  ));
  if (variant === "rubric") {
    return <View style={wide ? styles.grid : null}>{cards}</View>;
  }
  return (
    <View>
      <Link href={`/city/${ACTIVE_CITY_ID}/guides`} testID="link-guides">
        <Text style={styles.cardTitle}>{RUBRIC_TITLE}</Text>
      </Link>
      <View style={wide ? styles.grid : null}>{cards}</View>
    </View>
  );
}

// The city-page body for the states without a rubric: the NAV3 empty city
// (nothing published) and the no-cache error (21 §3.3 — the normal city page
// without discovery).
export function CityMessage({ text }: { text: string }) {
  return (
    <Text style={styles.locales} testID="city-message">
      {text}
    </Text>
  );
}

// The state mapping both surfaces share (the coverage table of
// screens-and-transitions.md): a null state means the build constructed no
// catalog service (no loader port) — the honest page with nothing invented;
// offline shows the banner over the last valid cache; error shows its named
// reason (11 §7); the empty ready city is NAV3's «не апублікавана».
export function CatalogStateView({
  state,
  variant,
}: {
  state: CatalogSurfaceState | null;
  variant: "city" | "rubric";
}) {
  if (state === null) return <CityMessage text="Каталог недаступны" />;
  if (state.kind === "loading") return <CityMessage text="Загрузка…" />;
  if (state.kind === "error") {
    return <StateBanner tone="error" reason={state.reason} testID="catalog-banner" />;
  }
  if (state.kind === "offline") {
    return (
      <View>
        <StateBanner tone="notice" reason={state.reason} testID="catalog-banner" />
        <GuideCardsList guides={state.guides} variant={variant} />
      </View>
    );
  }
  if (state.guides.length === 0) return <CityMessage text="не апублікавана" />;
  return <GuideCardsList guides={state.guides} variant={variant} />;
}
