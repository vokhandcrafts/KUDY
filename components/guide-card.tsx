// G06.01.a (issue #313) — the shared City/Guides chrome: the guide card, the
// access badge and the honest-state banner, styled from the canon tokens in
// components/design-tokens.ts (docs/design/visual-language.md, G06.07).
// Screens render state — every decision about what exists lives in the catalog
// controller, nothing is invented here. Lives in components/, not app/:
// expo-router treats every app/ file as a route (issue #339); the controller
// types come in as a type-only import (components takes no runtime imports
// from the other zones).
import { Link } from "expo-router";
import type { ReactNode } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";

import type { CatalogGuideCard, CatalogSurfaceState } from "../controllers/catalog/catalogController.ts";
import type { Services } from "../controllers/createServices.ts";
import { PressableSurface } from "./pressable-surface";
import { tokens } from "./design-tokens";
import { ScaledText } from "./scaled-text";
import { uiStrings } from "./ui-strings";
import { LoadingIndicator } from "./loading-indicator";
import { WalkButton } from "./walk-button";

// MVP active city (21 §3.2: у MVP толькі актыўны Гданьск); the surface shows
// the city name per NAV3, and the rubric route carries the city id.
export const CITY_TITLE = "Гданьск";
export const ACTIVE_CITY_ID = "gdansk";

// G15.03 (issue #70) — the MVP display-locale order for the discovery
// surfaces' label pick (the same order the composition root passes its
// services; one value here so the screens never invent a second order).
export const DISPLAY_LOCALES: readonly string[] = ["be", "en"];

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
  // G06.05 (AC4): the named retry of the failed catalog load — the manual
  // exit styled like the other outlined actions (the walk button's frame).
  retryButton: {
    alignSelf: "flex-start",
    borderColor: tokens.colorAccent,
    borderRadius: tokens.radiusBase,
    borderWidth: 1,
    marginTop: tokens.spaceS,
    paddingHorizontal: tokens.spaceM,
    paddingVertical: tokens.spaceS,
  },
  retryLabel: {
    color: tokens.colorAccent,
    fontSize: tokens.fontBaseSize,
  },
  // The city surfaces' shared title (the two screens' own style was the
  // same object — G06.05 moved the body into CityCatalogBody).
  cityTitle: {
    color: tokens.colorInk,
    fontSize: tokens.fontTitleSize,
    fontWeight: tokens.fontWeightStrong,
    marginBottom: tokens.spaceM,
  },
});

// G15.03 (issue #70) — the ordinary card style of the canon (visual-language
// §5 «card»), exported for the discovery surfaces: the same card kind, never
// a new look (новы выгляд — допіс у канон, не мясцовая стылізацыя).
export const cardStyle = styles.card;

// The city surfaces' shared body (G06.05): the walk-mode button, the city
// title, the caller's middle slot (the «Побач» link on Explore, nothing on
// the Guides rubric) and the catalog state with the named retry — one copy
// for both screens (implementation-rules 8: the sibling clone the copy-paste
// gate caught became this component). `middle` stays a prop, not a flag:
// the surfaces keep deciding their own chains.
export function CityCatalogBody({
  walk,
  catalog,
  onRetry,
  variant,
  locale,
  middle = null,
}: {
  walk?: Services["walk"];
  catalog: CatalogSurfaceState | null;
  onRetry?: () => void;
  variant: "city" | "rubric";
  locale: string;
  middle?: ReactNode;
}) {
  return (
    <>
      <WalkButton walk={walk} locale={locale} />
      <ScaledText style={styles.cityTitle}>{CITY_TITLE}</ScaledText>
      {middle}
      <CatalogStateView state={catalog} variant={variant} locale={locale} onRetry={onRetry} />
    </>
  );
}

// The tariff is a badge on the card, never a separate rubric (11 §16.1, 20
// §6). The contract value stays free|paid|mixed (21 §3.2 — schemas, index and
// the testID are untouched); the label renders it in the interface language
// per the owner consent recorded in issue #355 — G06.05 adds the EN pair.
export function AccessBadge({
  access,
  locale = "be",
}: {
  access: CatalogGuideCard["access"];
  locale?: string;
}) {
  const tone = access === "paid" ? styles.badgePaid : access === "mixed" ? styles.badgeMixed : null;
  const label = uiStrings(locale).access[access];
  return (
    <View
      style={[styles.badge, tone]}
      testID={`badge-access-${access}`}
      accessible={true}
      accessibilityLabel={label}
    >
      <ScaledText style={styles.badgeText}>{label}</ScaledText>
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
  locale = "be",
}: {
  textLocales: readonly string[];
  audioLocales: readonly string[];
  localesKnown: boolean;
  testID?: string;
  locale?: string;
}) {
  const strings = uiStrings(locale);
  if (!localesKnown) {
    return (
      <ScaledText style={styles.locales} testID={testID}>
        {strings.languagesLine(textLocales)}
      </ScaledText>
    );
  }
  return (
    <ScaledText style={styles.locales} testID={testID}>
      {strings.textAudioLine(textLocales, audioLocales)}
    </ScaledText>
  );
}

export function GuideCardLocales({ card, locale = "be" }: { card: CatalogGuideCard; locale?: string }) {
  return (
    <LocalesLine
      textLocales={card.textLocales}
      audioLocales={card.audioLocales}
      localesKnown={card.localesKnown}
      locale={locale}
    />
  );
}

// One guide card (the ordinary card kind of the canon): the same card on the
// city surface and in the rubric leads to the same preview (D02, 11 §16.1).
// `from` records the opening surface for NAV9 (11 §16.2: every preview
// opening has a source surface Back returns to). G06.05: the card is a
// button to the screen reader, its label names the guide and the access —
// the badge alone never carries the tariff. G15.03 widens the source set
// with the discovery surfaces — the same card, the same preview.
export function GuideCard({
  card,
  from,
  locale = "be",
}: {
  card: CatalogGuideCard;
  from?: "city" | "rubric" | "discovery" | "collection";
  locale?: string;
}) {
  const strings = uiStrings(locale);
  return (
    <Link href={{ pathname: `/route/${card.routeId}`, params: from ? { from } : {} }} asChild>
      <PressableSurface
        accessibilityRole="button"
        accessibilityLabel={`${card.title}, ${strings.access[card.access]}`}
        style={styles.card}
        testID={`guide-card-${card.routeId}`}
      >
        <ScaledText style={styles.cardTitle}>{card.title}</ScaledText>
        {card.summary ? <ScaledText style={styles.cardSummary}>{card.summary}</ScaledText> : null}
        <AccessBadge access={card.access} locale={locale} />
        <GuideCardLocales card={card} locale={locale} />
      </PressableSurface>
    </Link>
  );
}

// The honest-state banner (the notice/error pairs of the canon): the named
// state in the primary line, the technical reason (if any) muted below —
// never mascot-only (a11y-плашка screens.md). G06.05: the banner is a live
// region — a state change is announced, not silently repainted (AC5).
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
    <View
      accessibilityLiveRegion="polite"
      style={[styles.banner, tone === "error" ? styles.bannerError : styles.bannerNotice]}
      testID={testID}
    >
      <ScaledText style={styles.bannerText}>{reason}</ScaledText>
      {detail ? <ScaledText style={styles.bannerDetail}>{detail}</ScaledText> : null}
    </View>
  );
}

// The rubric section a surface renders for its guides; empty rubrics never
// render (NAV2) — callers check `guides.length > 0` first. One column below
// 821 px, two above (the scheme's responsive split).
function GuideCardsList({
  guides,
  variant,
  locale,
}: {
  guides: readonly CatalogGuideCard[];
  variant: "city" | "rubric";
  locale: string;
}) {
  const wide = isWide(useWindowDimensions().width);
  // The NAV9 source surface follows the variant: the city card and the
  // rubric are the MVP's two preview sources (11 §16.2).
  const from = variant === "rubric" ? "rubric" : "city";
  const cards = guides.map((card) => (
    <View key={card.routeId} style={wide ? styles.gridColumn : null}>
      <GuideCard card={card} from={from} locale={locale} />
    </View>
  ));
  if (variant === "rubric") {
    return <View style={wide ? styles.grid : null}>{cards}</View>;
  }
  return (
    <View>
      <Link href={`/city/${ACTIVE_CITY_ID}/guides`} asChild>
        <PressableSurface
          accessibilityRole="link"
          accessibilityLabel={uiStrings(locale).guidesLink}
          hitSlop={12}
          testID="link-guides"
        >
          <ScaledText style={styles.cardTitle}>{uiStrings(locale).guidesLink}</ScaledText>
        </PressableSurface>
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
    <ScaledText style={styles.locales} testID="city-message">
      {text}
    </ScaledText>
  );
}

// The state mapping both surfaces share, named after the state coverage
// table of screens-and-transitions.md (Explore row): a null state means the
// build constructed no catalog service (no loader port) — the honest page
// with nothing invented; offline shows the «папярэдні валідны кэш» banner
// (21 §3.3) with the technical reason as a secondary detail; the no-cache
// error is the normal city page without discovery, its reason muted — never
// the primary message; the empty ready city is NAV3's «не апублікавана».
// G06.05 (AC4): the error branch carries the named retry — a failed load is
// not a dead end, the controller's refresh is one press away.
export function CatalogStateView({
  state,
  variant,
  locale = "be",
  onRetry,
}: {
  state: CatalogSurfaceState | null;
  variant: "city" | "rubric";
  locale?: string;
  onRetry?: () => void;
}) {
  const strings = uiStrings(locale);
  if (state === null) return <CityMessage text={strings.catalogUnavailable} />;
  if (state.kind === "loading") return <LoadingIndicator text={strings.loading} testID="city-message" />;
  if (state.kind === "error") {
    return (
      <View testID="catalog-error">
        <CityMessage text={strings.catalogTemporarilyUnavailable} />
        <ScaledText style={styles.locales}>{state.reason}</ScaledText>
        {onRetry ? (
          <PressableSurface
            accessibilityRole="button"
            accessibilityLabel={strings.retry}
            onPress={onRetry}
            style={styles.retryButton}
            testID="catalog-retry"
          >
            <ScaledText style={styles.retryLabel}>{strings.retry}</ScaledText>
          </PressableSurface>
        ) : null}
      </View>
    );
  }
  if (state.kind === "offline") {
    return (
      <View>
        <StateBanner
          tone="notice"
          reason={strings.validCache}
          detail={state.reason}
          testID="catalog-banner"
        />
        <GuideCardsList guides={state.guides} variant={variant} locale={locale} />
      </View>
    );
  }
  if (state.guides.length === 0) return <CityMessage text={strings.notPublished} />;
  return <GuideCardsList guides={state.guides} variant={variant} locale={locale} />;
}
