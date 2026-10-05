// G07.05 (issue #284) — the quiet guide-hint card of the open app (R07 in
// docs/15: «Побач ёсць гід…» without a session, the small quiet card during
// one; «Яна не запускае аўдыё, не пачынае сесію, не купляе кантэнт»). The
// rows are the public preview facts the hint controller projected — a tap
// opens the guide's preview the usual way (G01.04), nothing else; the paid
// marker rides the row (R07: «Платны гід пазначаецца як платны; адкрыццё
// апісання не дае доступу»). The visual language is the quiet-offer card's
// (G08.05): radius 10, the line border, the token rhythm, one quiet decline.
// Lives in components/, not app/: expo-router treats every app/ file as a
// route (issue #339).
import { useSyncExternalStore } from "react";
import { StyleSheet, View } from "react-native";

// G21.09 (issue #542): the hint card's message shapes live in the shared
// pure contract zone. G21.25 (issue #558): the words are the generated
// projection of the canonical records plus the reviewed translations —
// the base text never lives in this component.
import type { GuideHintStrings } from "../contracts/ui-message-types";
import { GUIDE_HINT_STRINGS } from "./guide-hint-strings.generated";

import { PressableSurface } from "./pressable-surface";
import { ScaledText } from "./scaled-text";
import { tokens } from "./design-tokens";
import type { NearbyHintBinding, NearbyHintState } from "../controllers/useNearbyController";

export function guideHintStrings(locale: string): GuideHintStrings {
  // The words are the generated projection of the canonical records plus the
  // reviewed translations (G21.25, issue #558); uk keeps the documented be
  // fallback (uk-release-scope §6.4) until its words are authored (G21.19),
  // de renders its own catalogue (G21.10, issue #544); es too (G21.11, issue
  // #545); fr too (G21.12, issue #546).
  return locale === "es" ? GUIDE_HINT_STRINGS.es : locale === "fr" ? GUIDE_HINT_STRINGS.fr : locale === "en" ? GUIDE_HINT_STRINGS.en : locale === "de" ? GUIDE_HINT_STRINGS.de : GUIDE_HINT_STRINGS.be;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: tokens.colorCard,
    borderColor: tokens.colorLine,
    borderRadius: tokens.radiusBase,
    borderWidth: 1,
    marginBottom: tokens.spaceM,
    marginTop: tokens.spaceM,
    padding: tokens.spaceM,
  },
  heading: {
    color: tokens.colorInk,
    fontSize: tokens.fontBaseSize,
    fontWeight: tokens.fontWeightStrong,
  },
  row: {
    marginTop: tokens.spaceS,
    padding: tokens.spaceS,
  },
  rowTitle: {
    color: tokens.colorInk,
    fontSize: tokens.fontBaseSize,
  },
  paidMark: {
    color: tokens.colorMuted,
    fontSize: tokens.fontBaseSize,
  },
  dismiss: {
    alignItems: "center",
    marginTop: tokens.spaceS,
    padding: tokens.spaceS,
  },
  dismissLabel: {
    color: tokens.colorMuted,
    fontSize: tokens.fontBaseSize,
  },
});

// The screens' one mount line (map, run): reads the app-wide hint binding's
// store and renders the card only from a ready state. The store hook is the
// react-native useSyncExternalStore over the zustand store the binding
// carries — the component keeps the components-zone rule (no runtime imports
// from controllers; the binding arrives as a prop, only its type is
// imported). The tap opens the preview through the binding's own open
// action, then hands the navigation to the screen.
const passSubscribe = (): (() => void) => () => {};
const passGetState = (): NearbyHintState | null => null;

export function GuideHintMount({
  binding,
  locale,
  onOpen,
}: {
  binding: NearbyHintBinding | null | undefined;
  locale: string;
  onOpen: (routeId: string) => void;
}) {
  const state = useSyncExternalStore(binding?.store.subscribe ?? passSubscribe, binding?.store.getState ?? passGetState);
  if (!binding || state === null || state.kind !== "ready") return null;
  const strings = guideHintStrings(locale);
  return (
    <GuideHintCard
      heading={strings.heading}
      paidLabel={strings.paid}
      openHint={strings.openHint}
      dismissLabel={strings.dismiss}
      guides={state.guides}
      onOpen={(routeId) => {
        binding.openPreview();
        onOpen(routeId);
      }}
      onDismiss={binding.dismiss}
    />
  );
}

export function GuideHintCard({
  heading,
  paidLabel,
  openHint,
  dismissLabel,
  guides,
  onOpen,
  onDismiss,
}: {
  heading: string;
  paidLabel: string;
  openHint: string;
  dismissLabel: string;
  guides: readonly { readonly routeId: string; readonly title: string; readonly paid: boolean }[];
  onOpen: (routeId: string) => void;
  onDismiss: () => void;
}) {
  return (
    <View style={styles.card} testID="guide-hint-card">
      <ScaledText style={styles.heading}>{heading}</ScaledText>
      {guides.map((guide) => (
        <PressableSurface
          key={guide.routeId}
          accessibilityRole="button"
          accessibilityLabel={`${guide.title}${guide.paid ? ` (${paidLabel})` : ""}`}
          accessibilityHint={openHint}
          onPress={() => onOpen(guide.routeId)}
          style={styles.row}
          testID={`guide-hint-row-${guide.routeId}`}
        >
          <ScaledText style={styles.rowTitle}>{guide.title}</ScaledText>
          {guide.paid ? <ScaledText style={styles.paidMark}>{paidLabel}</ScaledText> : null}
        </PressableSurface>
      ))}
      <PressableSurface
        accessibilityRole="button"
        accessibilityLabel={dismissLabel}
        onPress={onDismiss}
        style={styles.dismiss}
        testID="btn-hint-dismiss"
      >
        <ScaledText style={styles.dismissLabel}>{dismissLabel}</ScaledText>
      </PressableSurface>
    </View>
  );
}
