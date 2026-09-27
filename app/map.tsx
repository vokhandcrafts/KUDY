// G07.01 (issue #281) — the Nearby (Побач) surface: the city's discovery
// offers in the two canon views (G06.08 screens.md «Побач», P02 in 15) —
// proximity with an allowed position, the manual review list without one.
// State rendering only: every decision about what exists lives in the
// controllers (19 §4.2), no audio path exists here at all (R04 — a radius
// entry and a card tap start nothing, the render suite fails if one is
// wired), and the honest map note stands in for the tiles decision (ADR
// G00.02 — the Run surface's precedent, no invented geometry: the index
// publishes no coordinates).
import { Link } from "expo-router";
import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  nearbyOrder,
  nearbyStrings,
  useNearbySurface,
  type NearbyLocationView,
  type NearbyOfferFacts,
} from "../controllers/nearby/nearbySurfaceController";
import { useServices } from "./_layout";
import { AccessBadge, StateBanner } from "../components/guide-card";
import { tokens } from "../components/design-tokens";

const styles = StyleSheet.create({
  title: {
    color: tokens.colorInk,
    fontSize: 18,
    fontWeight: tokens.fontWeightStrong,
    marginBottom: tokens.spaceS,
  },
  mapNote: {
    color: tokens.colorMuted,
    fontSize: tokens.fontBaseSize,
    marginBottom: tokens.spaceM,
  },
  modeHeader: {
    color: tokens.colorInk,
    fontSize: tokens.fontBaseSize,
    fontWeight: tokens.fontWeightStrong,
    marginBottom: tokens.spaceS,
  },
  note: {
    color: tokens.colorMuted,
    fontSize: tokens.fontBaseSize,
    marginBottom: tokens.spaceM,
  },
  message: {
    color: tokens.colorMuted,
    fontSize: tokens.fontBaseSize,
    marginTop: tokens.spaceS,
  },
  reason: {
    color: tokens.colorMuted,
    fontSize: 12,
    marginTop: tokens.spaceS,
  },
  card: {
    backgroundColor: tokens.colorCard,
    borderColor: tokens.colorLine,
    borderRadius: tokens.radiusBase,
    borderWidth: 1,
    padding: tokens.spaceM,
    marginBottom: tokens.spaceM,
  },
  cardTitle: {
    color: tokens.colorInk,
    fontSize: tokens.fontBaseSize,
    fontWeight: tokens.fontWeightStrong,
    marginBottom: tokens.spaceS,
  },
  cardSummary: {
    color: tokens.colorMuted,
    fontSize: tokens.fontBaseSize,
    marginBottom: tokens.spaceS,
  },
  facts: {
    color: tokens.colorMuted,
    fontSize: tokens.fontBaseSize,
    marginTop: tokens.spaceS,
  },
});

// The card's facts line: the availability split (L01: text without audio
// never promises audio) and the authored duration range — every figure
// copied from the published offer, nothing invented; an empty list renders
// the honest «—», never a dangling label.
function cardFacts(offer: NearbyOfferFacts, strings: ReturnType<typeof nearbyStrings>): string {
  const fmt = (label: string, locales: readonly string[]): string =>
    `${label}: ${locales.length > 0 ? locales.join(", ") : "—"}`;
  const locales = `${fmt(strings.textLabel, offer.text_locales)}; ${fmt(strings.audioLabel, offer.audio_locales)}`;
  if (offer.estimated_duration !== null) {
    return `${locales}\n~${offer.estimated_duration.min_minutes}—${offer.estimated_duration.max_minutes} ${strings.durationUnit}`;
  }
  return locales;
}

function NearbyCard({ offer, strings }: { offer: NearbyOfferFacts; strings: ReturnType<typeof nearbyStrings> }) {
  const title = offer.title ?? offer.route_id ?? offer.place_id ?? offer.offer_id;
  const label = `${title}, ${offer.access}`;
  const inner = (
    <>
      <Text style={styles.cardTitle}>{title}</Text>
      {offer.summary ? <Text style={styles.cardSummary}>{offer.summary}</Text> : null}
      <AccessBadge access={offer.access} />
      <Text style={styles.facts}>{cardFacts(offer, strings)}</Text>
    </>
  );
  // Guide offers lead to the guide preview, place offers to the place detail
  // (G07.02 — Journey 3: «месца або Moment → прэв'ю»); the tap starts no
  // audio in either case (criterion 3 of G07.01, R04 — the teaser sounds
  // only through the detail's explicit Play).
  if (offer.kind === "guide" && offer.route_id !== null) {
    return (
      <Link href={`/route/${offer.route_id}`} asChild>
        <Pressable
          style={styles.card}
          testID={`nearby-card-${offer.offer_id}`}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityHint={strings.cardHint}
        >
          {inner}
        </Pressable>
      </Link>
    );
  }
  if (offer.kind === "place" && offer.place_id !== null) {
    return (
      <Link href={`/place/${offer.place_id}`} asChild>
        <Pressable
          style={styles.card}
          testID={`nearby-card-${offer.offer_id}`}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityHint={strings.cardHint}
        >
          {inner}
        </Pressable>
      </Link>
    );
  }
  return (
    <View
      style={styles.card}
      testID={`nearby-card-${offer.offer_id}`}
      accessibilityLabel={label}
      accessibilityHint={strings.cardHint}
    >
      {inner}
    </View>
  );
}

// The location note under the mode header: the named state of the one
// subscription (11 §7 honest degradation — never mascot-only).
function locationNote(view: NearbyLocationView, strings: ReturnType<typeof nearbyStrings>): string | null {
  if (view.state === "absent") return null;
  if (view.state === "denied") return strings.noteDenied;
  if (view.state === "held-by-walk") return strings.noteHeldByWalk;
  if (view.note === null) return null;
  return view.note === "acquiring" ? strings.noteAcquiring : strings.noteUnstable;
}

export default function Map() {
  const services = useServices();
  // One binding per open: the factory resolves the offers store and the
  // location guard (the composition root owns both — 19 §4.2).
  const binding = useMemo(() => services.nearby?.create(), [services.nearby]);
  const { surface, locationView, locale } = useNearbySurface(binding);
  const strings = nearbyStrings(locale);
  const offers =
    surface && (surface.kind === "ready" || surface.kind === "offline") ? surface.offers : [];
  const list = nearbyOrder(offers, locationView);
  const note = locationNote(locationView, strings);
  return (
    <View style={{ backgroundColor: tokens.colorPaper, flex: 1, padding: tokens.spaceL }} testID="screen-Map">
      <Text style={styles.title}>{strings.title}</Text>
      <Text style={styles.mapNote}>{strings.mapNote}</Text>
      {surface === null ? (
        <View testID="nearby-error">
          <Text style={styles.message}>{strings.unavailable}</Text>
        </View>
      ) : surface.kind === "loading" ? (
        <Text style={styles.message} testID="nearby-message">
          {strings.loading}
        </Text>
      ) : surface.kind === "error" ? (
        <View testID="nearby-error">
          <Text style={styles.message}>{strings.unavailable}</Text>
          <Text style={styles.reason}>{surface.reason}</Text>
        </View>
      ) : (
        <>
          <Text style={styles.modeHeader} testID="nearby-mode">
            {locationView.state === "proximity" ? strings.proximityHeader : strings.reviewHeader}
          </Text>
          {note ? (
            <Text style={styles.note} testID="nearby-location-note">
              {note}
            </Text>
          ) : null}
          {surface.kind === "ready" && surface.degraded !== null ? (
            <StateBanner tone="notice" reason={strings.indexDegraded} testID="nearby-degraded" />
          ) : null}
          {list.length === 0 ? (
            <Text style={styles.message} testID="nearby-message">
              {strings.empty}
            </Text>
          ) : (
            list.map((offer) => <NearbyCard key={offer.offer_id} offer={offer} strings={strings} />)
          )}
        </>
      )}
    </View>
  );
}
