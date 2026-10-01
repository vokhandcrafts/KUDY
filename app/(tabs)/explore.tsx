// G06.01.a (issue #313) — the Explore city surface: the city name and the
// canonical chain's first rendering of the published guides (one card per
// guide, D02; the same card the rubric shows). State rendering lives in
// CatalogStateView; the surface decides nothing about what exists.
// G07.01 (issue #281) adds the «Побач» entry (Journey 3: Explore / кнопка
// «Побач»; NAV3 — the button works from the empty city too).
// G15.03 (issue #70) adds the «Чым заняцца» selector entry — Explore →
// Discovery result; the results never replace the city (20 §3, D04).
// Issue #426 adds the «KUDY» entry — the history surface's one Explore
// access (NAV3), named per the owner's 2026-10-01 decision (no «My»).
import { Link } from "expo-router";
import { StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useCatalogController } from "../../controllers/catalog/useCatalogController";
import { useServices, useUiLocale } from "../_layout";
import { tokens } from "../../components/design-tokens";
import { CityCatalogBody } from "../../components/guide-card";
import { PaperSurface } from "../../components/paper-surface";
import { PressableSurface } from "../../components/pressable-surface";
import { ScaledText } from "../../components/scaled-text";
import { uiStrings } from "../../components/ui-strings";

const styles = StyleSheet.create({
  middleLink: {
    color: tokens.colorInk,
    fontSize: tokens.fontBaseSize,
    fontWeight: tokens.fontWeightStrong,
    marginBottom: tokens.spaceM,
  },
});

// One middle-slot entry (G07.01's «Побач», G15.03's «Чым заняцца»): the
// tappable marker and the role of UX 03 (issue #349) — hitSlop lifts the
// target to ≥44dp; the href and the word stay the surface's own.
function SurfaceLink({ href, label, testID }: { href: string; label: string; testID: string }) {
  return (
    <Link href={href} asChild>
      <PressableSurface accessibilityRole="link" accessibilityLabel={label} hitSlop={12} testID={testID}>
        <ScaledText style={styles.middleLink}>{label}</ScaledText>
      </PressableSurface>
    </Link>
  );
}

export default function Explore() {
  const services = useServices();
  // G14.04.d (issue #305): the words read the switchable display locale —
  // a switch re-renders them in place, no restart.
  const locale = useUiLocale();
  const controller = useCatalogController(services.catalog?.controller);
  // UX 02 (issue #348): with the native header off the screen starts below
  // the status bar and the notch — the top safe-area inset is the screen's
  // own (AC4).
  const insets = useSafeAreaInsets();
  // G06.05 (issue #280, AC1): the shared words in the display locale; the
  // failed catalog load gets its named retry (AC4).
  const strings = uiStrings(locale);
  return (
    // G06.10.e (issue #405): the calm surface's paper — the shared wrapper
    // layers the canon grain over the unchanged paper token.
    <PaperSurface
      style={{
        padding: tokens.spaceL,
        paddingTop: insets.top + tokens.spaceL,
      }}
      testID="screen-Explore"
    >
      <CityCatalogBody
        walk={services.walk}
        catalog={controller?.surface ?? null}
        onRetry={controller ? () => void controller.refresh() : undefined}
        variant="city"
        locale={locale}
        middle={
          <>
            <SurfaceLink href="/map" label={strings.nearby} testID="link-nearby" />
            <SurfaceLink href="/discovery" label={strings.whatToDo} testID="link-discovery" />
            <SurfaceLink href="/my" label={strings.kudyLink} testID="link-kudy" />
          </>
        }
      />
    </PaperSurface>
  );
}
