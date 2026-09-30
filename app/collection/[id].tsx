// G15.03 (issue #70) — the Collection card (падборка): the editorial group's
// members with their own cards, the `mixed` badge when any member is paid,
// and the overlap_note when a guide and its start place are both members
// (NAV11). A collection is not a Run, not a purchase and has no audio —
// `audio_locales` is always [] and no listen button exists (21 §3.2, D07).
// Back from a member returns here; Back from here returns to the source
// surface (NAV9). State rendering only — every decision lives in the
// controllers (19 §4.2).
import { Link, useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { CatalogGuideCard } from "../../controllers/catalog/catalogController";
import { useStoreState } from "../../controllers/useControllerStore";
import {
  localizedPick,
  type DiscoveryCollection,
  type DiscoveryOffer,
  type DiscoveryRef,
} from "../../controllers/useDiscoveryController";
import { useServices } from "../_layout";
import {
  AccessBadge,
  cardStyle,
  CityMessage,
  DISPLAY_LOCALES,
  GuideCard,
} from "../../components/guide-card";
import { BackButton } from "../../components/back-button";
import { PressableSurface } from "../../components/pressable-surface";
import { screenStyles } from "../../components/screen-styles";
import { uiStrings } from "../../components/ui-strings";
import { tokens } from "../../components/design-tokens";

const styles = StyleSheet.create({
  description: {
    color: tokens.colorMuted,
    fontSize: tokens.fontBaseSize,
    marginBottom: tokens.spaceM,
  },
  note: {
    color: tokens.colorMuted,
    fontSize: 12,
    marginBottom: tokens.spaceM,
  },
  memberGap: { marginBottom: tokens.spaceM },
});

// Members are guide/place refs (validated on load) — the identity pair is
// the key; a stable id is never derived from the list position (21 §3.1).
const memberKey = (ref: DiscoveryRef): string =>
  ref.kind === "guide"
    ? `${ref.route_id}@${ref.version}`
    : ref.kind === "place"
      ? `${ref.place_id}@${ref.content_version}`
      : `${ref.collection_id}@${ref.content_version}`;

function CollectionBody({
  collection,
  offers,
  strings,
}: {
  collection: DiscoveryCollection;
  offers: readonly DiscoveryOffer[];
  strings: ReturnType<typeof uiStrings>;
}) {
  const byKey = new Map(offers.map((offer) => [memberKey(offer.ref), offer]));
  const resolved: DiscoveryOffer[] = [];
  let unresolved = 0;
  for (const member of collection.members) {
    const offer = byKey.get(memberKey(member));
    if (offer) resolved.push(offer);
    else unresolved += 1;
  }
  const ownOffer = offers.find((offer) => offer.ref.kind === "collection");
  return (
    <View>
      {ownOffer ? <AccessBadge access={ownOffer.access} /> : null}
      <Text style={styles.description}>{localizedPick(collection.localized.description, DISPLAY_LOCALES)}</Text>
      {collection.overlap_note ? (
        <Text style={styles.note} testID="collection-overlap-note">
          {localizedPick(collection.overlap_note, DISPLAY_LOCALES)}
        </Text>
      ) : null}
      {resolved.map((offer) =>
        offer.ref.kind === "guide" ? (
          <View key={offer.offer_id} style={styles.memberGap}>
            <GuideCard
              card={
                {
                  routeId: offer.ref.route_id,
                  version: offer.ref.version,
                  offerId: offer.offer_id,
                  title: localizedPick(offer.localized.title, DISPLAY_LOCALES) ?? offer.offer_id,
                  summary: localizedPick(offer.localized.summary, DISPLAY_LOCALES),
                  textLocales: offer.availability.text_locales,
                  audioLocales: offer.availability.audio_locales,
                  localesKnown: true,
                  access: offer.access,
                  editorialOrder: offer.editorial_order,
                  estimatedDuration: offer.estimated_duration ?? null,
                } satisfies CatalogGuideCard
              }
              from="collection"
            />
          </View>
        ) : offer.ref.kind === "place" ? (
          <View key={offer.offer_id} style={styles.memberGap}>
            <Link href={{ pathname: `/place/${offer.ref.place_id}`, params: { from: "collection" } }} asChild>
              <PressableSurface style={cardStyle} testID={`collection-member-${offer.offer_id}`}>
                <Text style={styles.description}>{localizedPick(offer.localized.title, DISPLAY_LOCALES)}</Text>
                <AccessBadge access={offer.access} />
              </PressableSurface>
            </Link>
          </View>
        ) : null,
      )}
      {unresolved > 0 ? (
        <Text style={styles.note} testID="collection-unresolved">
          {strings.collectionUnresolved}
        </Text>
      ) : null}
    </View>
  );
}

export default function Collection() {
  const params = useLocalSearchParams<{ id: string }>();
  const services = useServices();
  const state = useStoreState(services.discovery?.controller);
  // G06.05 (issue #280, AC1): the shared words in the display locale.
  const strings = uiStrings(services.locale);
  // UX 02 (issue #348): the frame's top inset — the content starts below the
  // status bar and the notch with the native header off (AC4).
  const insets = useSafeAreaInsets();
  const collectionId = typeof params.id === "string" ? params.id : undefined;
  const ready = state !== null && state.surface.kind === "ready" ? state.surface : null;
  const offers = ready?.index.offers ?? [];
  const collection =
    ready !== null && collectionId !== undefined
      ? ready.index.collections.find((candidate) => candidate.collection_id === collectionId) ?? null
      : null;
  // A remount is a new foreground presentation of the surface (21 §7) — the
  // controller restarts its per-presentation shown dedupe with it. The
  // services construct before the first render, so the first state is final.
  useEffect(() => {
    if (state !== null) state.beginPresentation("collection");
    // Runs once per mount by design: the presentation boundary.
  }, []);
  // The member cards' shown events (surface «collection») — the same
  // allowlisted payload, deduped by the controller.
  useEffect(() => {
    if (state === null || ready === null || collection === null) return;
    const byKey = new Map(ready.index.offers.map((offer) => [memberKey(offer.ref), offer]));
    const visible = collection.members
      .map((member) => byKey.get(memberKey(member)))
      .filter((offer): offer is DiscoveryOffer => offer !== undefined);
    state.recordShown(visible, "collection");
  });
  return (
    // The detail surfaces' frame (screen-styles, UX 02) — the paper wrapper
    // stays Explore's and My KUDY's (the allowed-places contract).
    <View style={[screenStyles.screen, { paddingTop: insets.top + tokens.spaceL }]} testID="screen-Collection">
      {/* UX 02: the back sits in the frame above the scroll (AC2); UX 01:
          the member cards scroll — the last one is reachable (issue #347). */}
      <BackButton label={strings.back} testID="btn-collection-back" />
      <ScrollView testID="scroll-collection">
        {collection === null ? (
          <CityMessage text={strings.collectionUnavailable} />
        ) : (
          <View>
            <Text style={screenStyles.title}>{localizedPick(collection.localized.title, DISPLAY_LOCALES)}</Text>
            <CollectionBody collection={collection} offers={offers} strings={strings} />
          </View>
        )}
      </ScrollView>
    </View>
  );
}
