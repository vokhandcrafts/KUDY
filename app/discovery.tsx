// G15.03 (issue #70) — the Discovery result surface: the «Чым заняцца»
// selector over the controller's selection. Exact results render alone; zero
// exact renders the honest message with labeled alternatives under their own
// heading (NAV4, D04); the stale snapshot shows the «папярэдні валідны кэш»
// banner (21 §3.3). Cards open the member surfaces — never Start, purchase
// or GPS (NAV6, D06, 11 §16.4). Controls render only when they can change
// the available choices (no fake form behind one fitting offer). State
// rendering only — every decision lives in the controllers (19 §4.2).
import { Link } from "expo-router";
import { useEffect, type ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useStoreState } from "../controllers/useControllerStore";
import {
  localizedPick,
  offersById,
  type DiscoveryControllerState,
  type DiscoveryMatch,
  type DiscoveryOffer,
} from "../controllers/useDiscoveryController";
import { useServices, useUiLocale } from "./_layout";
import {
  AccessBadge,
  cardStyle,
  CityMessage,
  LocalesLine,
  StateBanner,
} from "../components/guide-card";
import { BackButton } from "../components/back-button";
import { PressableSurface } from "../components/pressable-surface";
import { useScreenStyles } from "../components/screen-styles";
import { uiStrings } from "../components/ui-strings";
import { darkTokens, tokens, type ThemeTokens } from "../components/design-tokens";
import { useThemeStyles } from "../components/theme";

const createStyles = (palette: ThemeTokens) => StyleSheet.create({
  chip: {
    borderColor: palette.colorLine,
    borderRadius: palette.radiusPill,
    borderWidth: 1,
    paddingHorizontal: palette.spaceS,
    paddingVertical: 4,
    marginRight: palette.spaceS,
    marginBottom: palette.spaceS,
  },
  chipActive: { backgroundColor: palette.colorBadgeFree },
  chipRow: { flexDirection: "row", flexWrap: "wrap", marginBottom: palette.spaceS },
  chipText: { color: palette.colorInk, fontSize: 12 },
  sectionTitle: {
    color: palette.colorMuted,
    fontSize: palette.fontBaseSize,
    fontWeight: palette.fontWeightStrong,
    marginBottom: palette.spaceS,
  },
  facts: { color: palette.colorMuted, fontSize: 12, marginTop: palette.spaceS },
  disclosure: {
    color: palette.colorAccent,
    fontSize: palette.fontBaseSize,
    marginBottom: palette.spaceM,
  },
  gap: { height: palette.spaceM },
});
const lightStyles = createStyles(tokens);
const darkStyles = createStyles(darkTokens);

function Chip({ label, active, onPress, testID }: { label: string; active: boolean; onPress: () => void; testID: string }) {
  const styles = useThemeStyles(lightStyles, darkStyles);
  return (
    <PressableSurface accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: active }} onPress={onPress} style={[styles.chip, active ? styles.chipActive : null]} testID={testID}>
      <Text style={styles.chipText}>{label}</Text>
    </PressableSurface>
  );
}

function OfferCard({
  offer,
  from,
  reasons,
  differences,
  strings,
  locale,
  onOpen,
}: {
  offer: DiscoveryOffer;
  from: "discovery" | "collection";
  reasons: readonly string[];
  differences: readonly string[];
  strings: ReturnType<typeof uiStrings>;
  // G21.17 (issue #551): the picks read the selected UI language first —
  // localizedPick falls back to any published text rather than an untitled
  // card; the offer is shown only when its text covers this locale.
  locale: string;
  onOpen: (offer: DiscoveryOffer) => void;
}) {
  const styles = useThemeStyles(lightStyles, darkStyles);
  const title = localizedPick(offer.localized.title, [locale]);
  const summary = localizedPick(offer.localized.summary, [locale]);
  const href =
    offer.ref.kind === "guide"
      ? { pathname: `/route/${offer.ref.route_id}`, params: { from } }
      : offer.ref.kind === "place"
        ? { pathname: `/place/${offer.ref.place_id}`, params: { from } }
        : { pathname: `/collection/${offer.ref.collection_id}`, params: { from } };
  return (
    <Link href={href} asChild onPress={() => onOpen(offer)}>
      <PressableSurface accessibilityRole="link" accessibilityLabel={title ?? undefined} style={cardStyle} testID={`offer-card-${offer.offer_id}`}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {summary ? <Text style={styles.facts}>{summary}</Text> : null}
        <AccessBadge access={offer.access} locale={locale} />
        <LocalesLine
          textLocales={offer.availability.text_locales}
          audioLocales={offer.availability.audio_locales}
          localesKnown
          locale={locale}
        />
        {reasons.length > 0 ? (
          <Text style={styles.facts}>
            {reasons.map((reason) => strings.reasonText[reason] ?? reason).join(" \u00B7 ")}
          </Text>
        ) : null}
        {differences.length > 0 ? (
          <Text style={styles.facts}>
            {differences.map((difference) => strings.differenceText[difference] ?? difference).join(" \u00B7 ")}
          </Text>
        ) : null}
      </PressableSurface>
    </Link>
  );
}

function DiscoveryBody({
  state,
  strings,
  locale,
}: {
  state: DiscoveryControllerState;
  strings: ReturnType<typeof uiStrings>;
  locale: string;
}) {
  const styles = useThemeStyles(lightStyles, darkStyles);
  if (state.surface.kind === "loading") return <CityMessage text={strings.loading} />;
  if (state.surface.kind === "unavailable") {
    return (
      <View testID="discovery-unavailable">
        <StateBanner tone="error" reason={strings.discoveryTemporarilyUnavailable} detail={state.surface.reason} testID="discovery-unavailable-notice" />
      </View>
    );
  }
  const { index, stale, staleReason, result } = state.surface;
  const byId = offersById(index);
  const resolve = (matches: readonly { offer_id: string }[]): DiscoveryOffer[] =>
    matches.map((match) => byId.get(match.offer_id)).filter((offer): offer is DiscoveryOffer => offer !== undefined);
  // One card per result match, exact and alternatives alike — the two lists
  // differ in nothing but their source (the sibling clone the copy-paste
  // gate caught became this one renderer).
  const renderMatch = (match: DiscoveryMatch): ReactNode => {
    const offer = byId.get(match.offer_id);
    if (offer === undefined) return null;
    return (
      <OfferCard
        key={offer.offer_id}
        offer={offer}
        from="discovery"
        reasons={match.reasons}
        differences={match.differences}
        strings={strings}
        locale={locale}
        onOpen={(opened) => state.recordOpened(opened, "discovery")}
      />
    );
  };
  const alternativesVisible = state.alternativesShown || result.exact.length === 0;
  return (
    <View>
      {stale ? (
        <StateBanner tone="notice" reason={strings.validCache} detail={staleReason ?? undefined} testID="discovery-banner" />
      ) : null}
      {state.controls.timeLimits.length > 0 ? (
        <View style={styles.chipRow} testID="discovery-time">
          <Chip
            label={strings.timeUnlimited}
            active={state.timeLimit === null}
            onPress={() => state.setTimeLimit(null)}
            testID="time-none"
          />
          {state.controls.timeLimits.map((limit) => (
            <Chip
              key={limit}
              label={strings.timeCap(limit)}
              active={state.timeLimit === limit}
              onPress={() => state.setTimeLimit(limit)}
              testID={`time-${limit}`}
            />
          ))}
        </View>
      ) : null}
      {state.controls.themeIds.length > 0 ? (
        <View style={styles.chipRow} testID="discovery-themes">
          {state.controls.themeIds.map((themeId) => {
            const theme = index.themes.find((candidate) => candidate.id === themeId);
            return (
              <Chip
                key={themeId}
                label={localizedPick(theme?.labels, [locale]) ?? themeId}
                active={state.themeIds.includes(themeId)}
                onPress={() => state.toggleTheme(themeId)}
                testID={`theme-${themeId}`}
              />
            );
          })}
        </View>
      ) : null}
      {state.controls.seasons.length > 0 ? (
        <View style={styles.chipRow} testID="discovery-seasons">
          {state.controls.seasons.map((season) => (
            <Chip
              key={season}
              label={strings.seasonName[season] ?? season}
              active={state.season === season}
              onPress={() => state.setSeason(state.season === season ? null : season)}
              testID={`season-${season}`}
            />
          ))}
        </View>
      ) : null}
      <View style={styles.gap} />
      {result.exact.map(renderMatch)}
      {result.exact.length === 0 ? (
        // G21.17 (issue #551): with no alternatives either, the criteria are
        // not the reason — the selected UI language's text absence is the
        // honest explanation (a service failure renders its own state above).
        // A fully empty index answers the same word truthfully: no guides
        // with text in this language exist yet.
        <Text testID="discovery-empty" style={styles.facts}>
          {result.alternatives.length === 0 ? strings.textLocaleEmpty : strings.discoveryEmpty}
        </Text>
      ) : null}
      {resolve(result.alternatives).length > 0 && result.exact.length > 0 && !alternativesVisible ? (
        <PressableSurface accessibilityRole="button" accessibilityLabel={strings.discoveryAlternatives} onPress={() => state.showAlternatives()} testID="btn-alternatives">
          <Text style={styles.disclosure}>{strings.discoveryAlternatives}</Text>
        </PressableSurface>
      ) : null}
      {alternativesVisible && resolve(result.alternatives).length > 0 ? (
        <View testID="discovery-alternatives">
          <Text style={styles.sectionTitle}>{strings.discoveryAlternatives}</Text>
          {result.alternatives.map(renderMatch)}
        </View>
      ) : null}
    </View>
  );
}

export default function Discovery() {
  const screenStyles = useScreenStyles();
  const services = useServices();
  // G14.04.d (issue #305): the words read the switchable display locale —
  // a switch re-renders them in place, no restart.
  const locale = useUiLocale();
  const state = useStoreState(services.discovery?.controller);
  // G06.05 (issue #280, AC1): the shared words in the display locale.
  const strings = uiStrings(locale);
  // UX 02 (issue #348): the top inset clears the status bar and notch with
  // the native header off (AC4). APR-05 (#810): the bottom inset clears the navigation bar.
  const insets = useSafeAreaInsets();
  // A remount is a new foreground presentation of the surface (21 §7) — the
  // controller restarts its per-presentation shown dedupe with it. The
  // services construct before the first render, so the first state is final.
  useEffect(() => {
    if (state !== null) state.beginPresentation("discovery");
    // Runs once per mount by design: the presentation boundary.
  }, []);
  // The shown event fires for the offers actually rendered; the controller
  // dedupes per surface presentation (21 §7: shown once per foreground view).
  useEffect(() => {
    if (state === null || state.surface.kind !== "ready") return;
    const byId = offersById(state.surface.index);
    const visible = [
      ...state.surface.result.exact,
      ...(state.alternativesShown || state.surface.result.exact.length === 0 ? state.surface.result.alternatives : []),
    ]
      .map((match) => byId.get(match.offer_id))
      .filter((offer): offer is DiscoveryOffer => offer !== undefined);
    state.recordShown(visible, "discovery");
  });
  return (
    // The detail surfaces' frame (screen-styles, UX 02) — the paper wrapper
    // stays Explore's and My KUDY's (the allowed-places contract).
    <View style={[screenStyles.screen, { paddingTop: insets.top + tokens.spaceL, paddingBottom: insets.bottom + tokens.spaceL }]} testID="screen-Discovery">
      {/* UX 02: the back sits in the frame above the scroll — reachable while
          the offer cards are scrolled (AC2). UX 01 (issue #347): the result
          scrolls — the last card is reachable beyond the fold. */}
      <BackButton label={strings.backToCity} testID="btn-discovery-back" />
      <ScrollView testID="scroll-discovery">
        <Text style={screenStyles.title}>{strings.discoveryTitle}</Text>
        {state === null ? (
          <CityMessage text={strings.discoveryUnavailable} />
        ) : (
          <DiscoveryBody state={state} strings={strings} locale={locale} />
        )}
      </ScrollView>
    </View>
  );
}
