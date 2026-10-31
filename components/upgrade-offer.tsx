// G08.05 (issue #292) — the quiet upgrade offer card of the guide preview
// (11 C26: «Спакойная прапанова ўнізе апісання»; the visual-language card:
// radius 10, the line border, the token rhythm). The card itself buys
// nothing — D06/NAV6: «Націск на платную прапанову… адкрывае прэв'ю; ён
// не купляе», «Пакупка, загрузка і Start — асобныя дзеянні» — the Buy
// press inside is the separate explicit action. The «Не цяпер» press is
// the decline the controller respects (AC4). The onLayout callback is the
// render fact the impression event counts (AC3) — never the mount alone.
// Lives in components/, not app/: expo-router treats every app/ file as a
// route (issue #339).
import { StyleSheet, View } from "react-native";

import { PressableSurface } from "./pressable-surface";
import { ScaledText } from "./scaled-text";
import { darkTokens, tokens, type ThemeTokens } from "./design-tokens";
import { useThemeStyles } from "./theme";

const createStyles = (palette: ThemeTokens) => StyleSheet.create({
  card: {
    backgroundColor: palette.colorCard,
    borderColor: palette.colorLine,
    borderRadius: palette.radiusBase,
    borderWidth: 1,
    marginBottom: palette.spaceM,
    marginTop: palette.spaceM,
    padding: palette.spaceM,
  },
  title: {
    color: palette.colorInk,
    fontSize: palette.fontBaseSize,
    fontWeight: palette.fontWeightStrong,
  },
  body: {
    color: palette.colorMuted,
    fontSize: palette.fontBaseSize,
    marginTop: palette.spaceS,
  },
  buy: {
    alignItems: "center",
    backgroundColor: palette.colorAccent,
    borderRadius: palette.radiusBase,
    marginTop: palette.spaceM,
    padding: palette.spaceM,
  },
  // Issue #430 (варыянт А): the disabled buy reads through the canon ghost
  // pair (canon §5) — the transparent fill shows the card, no opacity
  // substitute.
  buyDisabled: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: palette.colorDisabledLine,
  },
  buyLabel: {
    color: palette.colorAccentInk,
    fontSize: palette.fontBaseSize,
    fontWeight: palette.fontWeightStrong,
  },
  buyLabelDisabled: {
    color: palette.colorDisabledInk,
  },
  // The decline stays quiet: a plain text row, not a second accent button —
  // the card keeps one main action (the visual-language buttons rule).
  dismiss: {
    alignItems: "center",
    marginTop: palette.spaceS,
    padding: palette.spaceS,
  },
  dismissLabel: {
    color: palette.colorMuted,
    fontSize: palette.fontBaseSize,
  },
});
const lightStyles = createStyles(tokens);
const darkStyles = createStyles(darkTokens);

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
  const styles = useThemeStyles(lightStyles, darkStyles);
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
        <ScaledText style={[styles.buyLabel, busy && styles.buyLabelDisabled]}>{buyLabel}</ScaledText>
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
