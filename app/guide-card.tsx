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
  bannerDetail: {
    color: tokens.colorMuted,
    fontSize: 12,
    marginTop: tokens.spaceS,
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
// availability facts — L01: text without audio never promises audio);
// route-only cards state the layer locales without claiming a split nothing
// published. Shared by the card and the guide preview.
export function LocalesLine({
  textLocales,
  audioLocales,
  localesKnown,
  testID,
}: {
  textLocales: readonly string[];
  audioLocales: readonly string[];
  localesKnown: boolean;
  testID?: string;
}) {
  if (!localesKnown) {
    return (
      <Text style={styles.locales} testID={testID}>
        {`Мовы: ${textLocales.join(", ")}`}
      </Text>
    );
  }
  const audio = audioLocales.length > 0 ? `; аўдыё: ${audioLocales.join(", ")}` : "";
  return (
    <Text style={styles.locales} testID={testID}>
      {`Тэкст: ${textLocales.join(", ")}${audio}`}
    </Text>
  );
}

export function GuideCardLocales({ card }: { card: CatalogGuideCard }) {
  return (
    <LocalesLine
      textLocales={card.textLocales}
      audioLocales={card.audioLocales}
      localesKnown={card.localesKnown}
    />
  );
}

// One guide card (the ordinary card kind of the canon): the same card on the
// city surface and in the rubric leads to the same preview (D02, 11 §16.1).
// `from` records the opening surface for NAV9 (11 §16.2: every preview
// opening has a source surface Back returns to).
export function GuideCard({ card, from }: { card: CatalogGuideCard; from?: "city" | "rubric" }) {
  return (
    <Link href={{ pathname: `/route/${card.routeId}`, params: from ? { from } : {} }} asChild>
      <Pressable style={styles.card} testID={`guide-card-${card.routeId}`}>
        <Text style={styles.cardTitle}>{card.title}</Text>
        {card.summary ? <Text style={styles.cardSummary}>{card.summary}</Text> : null}
        <AccessBadge access={card.access} />
        <GuideCardLocales card={card} />
      </Pressable>
    </Link>
  );
}

// The honest-state banner (the notice/error pairs of the canon): the named
// state in the primary line, the technical reason (if any) muted below —
// never mascot-only (a11y-плашка screens.md).
export function StateBanner({
  tone,
  reason,
  detail,
  testID,
}: {
  tone: "notice" | "error";
  reason: string;
  detail?: string;
  testID: string;
}) {
  return (
    <View style={[styles.banner, tone === "error" ? styles.bannerError : styles.bannerNotice]} testID={testID}>
      <Text style={styles.bannerText}>{reason}</Text>
      {detail ? <Text style={styles.bannerDetail}>{detail}</Text> : null}
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
  // The NAV9 source surface follows the variant: the city card and the
  // rubric are the MVP's two preview sources (11 §16.2).
  const from = variant === "rubric" ? "rubric" : "city";
  const cards = guides.map((card) => (
    <View key={card.routeId} style={wide ? styles.gridColumn : null}>
      <GuideCard card={card} from={from} />
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

// The state mapping both surfaces share, named after the state coverage
// table of screens-and-transitions.md (Explore row): a null state means the
// build constructed no catalog service (no loader port) — the honest page
// with nothing invented; offline shows the «папярэдні валідны кэш» banner
// (21 §3.3) with the technical reason as a secondary detail; the no-cache
// error is the normal city page without discovery, its reason muted — never
// the primary message; the empty ready city is NAV3's «не апублікавана».
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
    return (
      <View testID="catalog-error">
        <CityMessage text="Каталог часова недаступны" />
        <Text style={styles.locales}>{state.reason}</Text>
      </View>
    );
  }
  if (state.kind === "offline") {
    return (
      <View>
        <StateBanner
          tone="notice"
          reason="Папярэдні валідны кэш"
          detail={state.reason}
          testID="catalog-banner"
        />
        <GuideCardsList guides={state.guides} variant={variant} />
      </View>
    );
  }
  if (state.guides.length === 0) return <CityMessage text="не апублікавана" />;
  return <GuideCardsList guides={state.guides} variant={variant} />;
}
