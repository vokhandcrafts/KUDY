// G08.05 (issue #292) — the quiet upgrade offer card of the guide preview
// (11 C26: «Спакойная прапанова ўнізе апісання»; the visual-language card:
// radius 10, the line border, the token rhythm). The card itself buys
// nothing — D06/NAV6: «Націск на платную прапанову… адкрывае прэв'ю; ён не
// купляє», «Пакупка, загрузка і Start — асобныя дзеянні» — the Buy press
// inside is the separate explicit action. The «Не цяпер» press is the
// decline the controller respects (AC4). The onLayout callback is the
// render fact the impression event counts (AC3) — never the mount alone.
// Lives in components/, not app/: expo-router treats every app/ file as a
// route (issue #339).
import { StyleSheet, View } from "react-native";

import { PressableSurface } from "./pressable-surface";
import { ScaledText } from "./scaled-text";
import { tokens } from "./design-tokens";

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
  title: {
    color: tokens.colorInk,
    fontSize: tokens.fontBaseSize,
    fontWeight: tokens.fontWeightStrong,
  },
  body: {
    color: tokens.colorMuted,
    fontSize: tokens.fontBaseSize,
    marginTop: tokens.spaceS,
  },
  buy: {
    alignItems: "center",
    backgroundColor: tokens.colorAccent,
    borderRadius: tokens.radiusBase,
    marginTop: tokens.spaceM,
    padding: tokens.spaceM,
  },
  buyDisabled: {
    opacity: 0.5,
  },
  buyLabel: {
    color: tokens.colorAccentInk,
    fontSize: tokens.fontBaseSize,
    fontWeight: tokens.fontWeightStrong,
  },
  // The decline stays quiet: a plain text row, not a second accent button —
  // the card keeps one main action (the visual-language buttons rule).
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

export function UpgradeOffer({
  title,
  body,
  buyLabel,
  dismissLabel,
  busy,
  onBuy,
  onDismiss,
  onRendered,
}: {
  title: string;
  body: string;
  buyLabel: string;
  dismissLabel: string;
  busy: boolean;
  onBuy: () => void;
  onDismiss: () => void;
  onRendered: () => void;
}) {
  return (
    <View style={styles.card} testID="upgrade-offer" onLayout={onRendered}>
      <ScaledText style={styles.title}>{title}</ScaledText>
      <ScaledText style={styles.body}>{body}</ScaledText>
      <PressableSurface
        accessibilityRole="button"
        accessibilityLabel={buyLabel}
        accessibilityState={{ disabled: busy }}
        onPress={onBuy}
        disabled={busy}
        style={[styles.buy, busy && styles.buyDisabled]}
        testID="btn-upgrade-buy"
      >
        <ScaledText style={styles.buyLabel}>{buyLabel}</ScaledText>
      </PressableSurface>
      <PressableSurface
        accessibilityRole="button"
        accessibilityLabel={dismissLabel}
        onPress={onDismiss}
        style={styles.dismiss}
        testID="btn-upgrade-dismiss"
      >
        <ScaledText style={styles.dismissLabel}>{dismissLabel}</ScaledText>
      </PressableSurface>
    </View>
  );
}
